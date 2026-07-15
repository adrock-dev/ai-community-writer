import { Inject, Injectable } from "@nestjs/common";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runLlm } from "./llm-runner.js";
import { ACADEMY_MAX_CANDIDATES, ACADEMY_MIN_FOR_BEST, ACADEMY_MIN_GUARANTEE_MAX_KM, ACADEMY_NEARBY_MAX_KM, ACADEMY_USED_PER_POST, AUTO_DESIGN_TEMPLATE_ID, DEFAULT_DRIVING_DESIGN_TEMPLATE, DESIGN_TEMPLATES, DRIVING_ABSOLUTE_PRINCIPLES, DRIVING_ACADEMY_PRINCIPLES, TITLE_RULES, defaultDesignForTemplate, type TitleRule } from "./constants.js";
import { resolveTemplateDirection, safeTemplateOverrides } from "./axis-tags.js";
import { academyMin, academyPool, getArchetype, structureGuideForArchetype, writingGuideForArchetype, type Archetype } from "./archetypes.js";
import { DbService, safeJson } from "./db.service.js";
import { ImageGenerationService } from "./image-generation.service.js";
import { findMatchedExclusionTerms, findSlotExclusionTerms, parseExclusionTerms } from "./exclusions.js";
import { articleQualityIssues, postSurfaceQualityIssues, renderedCandidateCount } from "./quality-gate.js";

type Row = Record<string, any>;

type GenerationFacts = { text: string; images: Record<string, string>; academyCount: number; firstAcademyName: string };
type ArticlePattern = { pattern_type?: string; pattern?: string; count?: number; example_title?: string; article_type?: string };
type ArticlePatternSummary = { average_structure_metrics?: Row; top_title_patterns?: ArticlePattern[]; top_heading_patterns?: ArticlePattern[] };

const PROJECT_DIR = resolve(new URL("../../..", import.meta.url).pathname);

@Injectable()
export class WorkerService {
  private running = false;
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(ImageGenerationService) private readonly imageGeneration: ImageGenerationService,
  ) {}

  startLoop(): void {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  private async loop(): Promise<void> {
    const interval = Number(process.env.WORKER_POLL_INTERVAL || 3) * 1000;
    console.log("Nest worker loop started");
    while (this.running) {
      const job = this.db.claimNextJob();
      if (!job) { await sleep(interval); continue; }
      try {
        const result = await this.process(job);
        if (this.db.isJobCancelRequested(job.id)) this.db.completeJob(job.id, false, result, "취소됨(작업자 요청)");
        else this.db.completeJob(job.id, true, result);
      } catch (error: any) {
        this.db.completeJob(job.id, false, undefined, error?.message || String(error));
      }
    }
  }

  async process(job: Row): Promise<Row> {
    const payload = job.payload_obj || safeJson(job.payload, {});
    if (job.kind === "generate") return this.processGenerate(job.domain, payload, job.id);
    this.db.updateJobProgress(job.id, { step: `${job.kind} 처리 중` });
    if (job.kind === "dedup") return this.processDedup(job.domain, payload);
    if (job.kind === "prune") return this.processPrune(job.domain, payload);
    if (job.kind === "indexing") return this.processIndexing(job.domain, payload);
    throw new Error(`unknown job kind: ${job.kind}`);
  }

  private async processGenerate(domain: string, payload: Row, jobId?: string): Promise<Row> {
    const domainMeta = this.db.getDomain(domain) || {};
    const slotIds = Array.isArray(payload.slot_ids) ? payload.slot_ids : [];
    const exclusionTerms = parseExclusionTerms(domainMeta.excluded_keywords);
    // 일일 한도: 0(또는 미설정)이면 무제한. N>0이면 오늘 발행분 + 이번 실행 생성분이 N에 도달하면 나머지 슬롯은 손대지 않고 다음으로 미룬다.
    const dailyLimit = Math.max(0, Number(domainMeta.daily_limit ?? 0) || 0);
    const alreadyToday = dailyLimit > 0 ? this.db.countPostsToday(domain) : 0;
    let producedThisRun = 0;
    let ok = 0, fail = 0, skipped = 0;
    const per_slot: Row[] = [];
    this.db.updateJobProgress(jobId, { step: "글 생성 준비", processed: 0, failed: 0 });
    for (const [index, sid] of slotIds.entries()) {
      if (jobId && this.db.isJobCancelRequested(jobId)) {
        const remaining = slotIds.length - index;
        skipped += remaining;
        this.db.updateJobProgress(jobId, { step: "취소 요청 확인", slotId: null, processed: ok, failed: fail });
        per_slot.push({ ok: false, skipped: true, error: `취소됨(작업자 요청) — ${remaining} slot(s) skipped` });
        break;
      }
      if (dailyLimit > 0 && alreadyToday + producedThisRun >= dailyLimit) {
        const remaining = slotIds.length - index;
        skipped += remaining;
        this.db.updateJobProgress(jobId, { step: "일일 한도 도달", slotId: null, processed: ok, failed: fail });
        per_slot.push({ ok: false, skipped: true, error: `daily limit reached (${dailyLimit}/day) — ${remaining} slot(s) deferred` });
        break;
      }
      const slot = this.db.getSlot(sid);
      this.db.updateJobProgress(jobId, { step: `${index + 1}/${slotIds.length} 슬롯 확인`, slotId: sid, processed: ok, failed: fail });
      if (!slot || slot.domain !== domain) { fail++; this.db.updateJobProgress(jobId, { step: "슬롯 없음", slotId: sid, processed: ok, failed: fail }); per_slot.push({ slot_id: sid, ok: false, error: "not found" }); continue; }
      const slotMatches = findSlotExclusionTerms(slot, exclusionTerms);
      if (slotMatches.length) {
        const message = `excluded by domain rule: ${slotMatches.join(", ")}`;
        this.db.updateSlotStatus(sid, "pruned", message);
        skipped++; this.db.updateJobProgress(jobId, { step: "제외 규칙으로 건너뜀", slotId: sid, processed: ok, failed: fail }); per_slot.push({ slot_id: sid, ok: false, skipped: true, error: message });
        continue;
      }
      // 글유형 spec(빌트인/커스텀): 디자인 폴백·아키타입·방향성 해석의 공통 소스로 먼저 해석.
      const templateSpec = this.db.getTemplateSpec(domain, String(slot.template_id || ""));
      // 디자인은 슬롯 단위로 결정: 요청 지정 → 도메인 설정 → template_overrides.design → 레거시 → 글유형(spec) 기본.
      const designTemplateId = resolveGenerationDesign(payload.design_template_id, domainMeta, slot.template_id, templateSpec?.default_design);
      this.db.updateSlotStatus(sid, "in_progress");
      try {
        this.db.updateJobProgress(jobId, { step: `${index + 1}/${slotIds.length} 자료 구성 중`, slotId: sid, processed: ok, failed: fail });
        const genEnabled = Boolean(payload.enable_image_generation);
        // 아키타입(spec.kind 참조)·방향성을 프롬프트로 스레딩(buildPrompt 는 자유함수라 this.db 가 없어 메서드에서 넘김).
        const archetype = getArchetype(templateSpec?.kind ?? "");
        const templateDirection = resolveTemplateDirection(templateSpec, safeTemplateOverrides(domainMeta.template_overrides)[String(slot.template_id || "")]);
        // 학원 중심 타입(아키타입 academy_centric: T01/T14/T11)은 학원별로 그 학원 사진을 넣는다(학원당 1장, 최대 5장).
        // 그 외 타입은 학원 사진 최소화(1장) + 내용 기반 생성으로 총 3장.
        const academyImageType = archetype?.academy_centric ?? false;
        // 학원 타입: 글유형 spec.academy_types 가 단일 소스. 선택값 있으면 그 타입 학원만, 비어 있으면 학원정보 미사용.
        const academyTypes = this.resolveAcademyTypes(templateSpec);
        const facts = academyImageType
          ? this.buildFacts(domain, slot, { maxAcademyImages: 5, perAcademyImages: 1 }, academyTypes, archetype)
          : this.buildFacts(domain, slot, { maxAcademyImages: genEnabled ? 1 : 3, perAcademyImages: 1 }, academyTypes, archetype);
        // 제목 규칙(생성 시점 해석): 실제 후보 수로 제목 확정 → 프롬프트 주입. 후보 수 부족(min_generate 미만)이면 생성하지 않는다.
        const titleRule = (templateSpec?.title_rule as TitleRule | undefined) ?? TITLE_RULES[String(slot.template_id || "")];
        const titleResolved = resolveTitleFromRule(titleRule, { region: String(slot.region || ""), count: facts.academyCount, keyword: String(slot.primary_keyword || ""), academyName: facts.firstAcademyName });
        if (titleResolved.skip) {
          const message = `학원 부족: 후보 ${facts.academyCount}곳 < 최소 ${titleRule?.min_generate}곳(제목 규칙)`;
          this.db.updateSlotStatus(sid, "pruned", message);
          skipped++; this.db.updateJobProgress(jobId, { step: "학원 부족으로 건너뜀", slotId: sid, processed: ok, failed: fail }); per_slot.push({ slot_id: sid, ok: false, skipped: true, error: message });
          continue;
        }
        const factsMatches = findMatchedExclusionTerms(facts.text, exclusionTerms);
        if (factsMatches.length) {
          const message = `excluded by domain rule in facts: ${factsMatches.join(", ")}`;
          this.db.updateSlotStatus(sid, "pruned", message);
          skipped++; this.db.updateJobProgress(jobId, { step: "자료 제외 규칙으로 건너뜀", slotId: sid, processed: ok, failed: fail }); per_slot.push({ slot_id: sid, ok: false, skipped: true, error: message });
          continue;
        }
        const IMAGE_TARGET = 3;
        // 생성 슬롯을 미리 예약만 하고(placeholder), 실제 이미지는 글 작성 후 배치된 것만 내용 기반으로 만든다.
        // 학원 중심 타입은 학원 사진을 우선 쓰되, 사진이 3개 미만이면 생성 이미지로 최소 수량을 채운다.
        const existingImageCount = Object.keys(facts.images).length;
        const plannedGenCount = genEnabled ? Math.max(0, IMAGE_TARGET - existingImageCount) : 0;
        const plannedGenKeys = Array.from({ length: plannedGenCount }, (_, i) => `generated_${i + 1}`);
        const images: Record<string, string> = { ...facts.images };
        for (const key of plannedGenKeys) images[key] = "";
        const factsText = appendPlannedImageFacts(facts.text, Object.keys(facts.images), plannedGenKeys);
        const prompt = buildPrompt(domainMeta, slot, factsText, designTemplateId, archetype, templateDirection, academyTypes.length > 0, titleResolved.title);
        const llmOpts = { provider: payload.provider || "codex", model: payload.model || "", timeoutSec: Number(payload.timeout_sec || 600) };
        this.db.updateJobProgress(jobId, { step: `${index + 1}/${slotIds.length} 본문 생성 중`, slotId: sid, processed: ok, failed: fail });
        const result = await runLlm(prompt, llmOpts);
        if (!result.ok || !result.summary.trim()) throw new Error(result.error || "empty summary");
        let markdown = normalizeGeneratedMarkdown(result.summary, images);
        let qualityIssues = articleQualityIssues(markdown, factsText, images);
        let durationSec = result.duration_sec;
        let costUsd = result.cost_usd || 0;
        let inputTokens = result.input_tokens || 0;
        let outputTokens = result.output_tokens || 0;
        let sessionId = result.session_id;
        let model = result.model;
        const maxRepairAttempts = clampInt(payload.max_repair_attempts, 2, 0, 3);
        for (let repairAttempt = 0; qualityIssues.length && repairAttempt < maxRepairAttempts; repairAttempt++) {
          this.db.updateJobProgress(jobId, { step: `${index + 1}/${slotIds.length} 품질 보정 ${repairAttempt + 1}회차`, slotId: sid, processed: ok, failed: fail });
          const repair = await runLlm(buildRepairPrompt(domainMeta, slot, factsText, designTemplateId, markdown, qualityIssues, archetype, templateDirection, titleResolved.title), llmOpts);
          durationSec += repair.duration_sec;
          costUsd += repair.cost_usd || 0;
          inputTokens += repair.input_tokens || 0;
          outputTokens += repair.output_tokens || 0;
          sessionId = repair.session_id || sessionId;
          model = repair.model || model;
          if (repair.ok && repair.summary.trim()) {
            markdown = normalizeGeneratedMarkdown(repair.summary, images);
            qualityIssues = articleQualityIssues(markdown, factsText, images);
          }
        }
        if (qualityIssues.length) throw new Error(`generated article quality gate failed: ${qualityIssues.join(", ")}`);
        // 규칙으로 확정한 제목이 있으면 강제(LLM 즉흥 방지). 없으면 기존대로 본문 H1 추출.
        const title = titleResolved.title || extractTitle(markdown, slot.primary_keyword);
        markdown = rewriteH1Title(markdown, title);
        const generatedMatches = findMatchedExclusionTerms(`${title}\n${markdown}`, exclusionTerms);
        if (generatedMatches.length) {
          const message = `excluded by domain rule in generated article: ${generatedMatches.join(", ")}`;
          this.db.updateSlotStatus(sid, "pruned", message);
          skipped++; this.db.updateJobProgress(jobId, { step: "생성문 제외 규칙으로 건너뜀", slotId: sid, processed: ok, failed: fail }); per_slot.push({ slot_id: sid, ok: false, skipped: true, error: message });
          continue;
        }
        const finalIssues = postSurfaceQualityIssues({ title, body_markdown: markdown, images: Object.keys(images).length ? JSON.stringify(images) : null, design_template_id: designTemplateId }, 3500, renderedCandidateCount(markdown, factsText));
        if (finalIssues.length) throw new Error(`generated article final surface gate failed: ${finalIssues.join(", ")}`);
        // 내용 기반 이미지 생성: LLM이 실제 배치한 생성 슬롯만, 그 슬롯이 놓인 섹션 내용에 맞춰 만든다.
        const imageWarnings: string[] = [];
        if (genEnabled) {
          this.db.updateJobProgress(jobId, { step: `${index + 1}/${slotIds.length} 이미지 준비 중`, slotId: sid, processed: ok, failed: fail });
          const usedKeys = new Set(Array.from(markdown.matchAll(/\[IMAGE:([A-Za-z0-9_-]+)\]/g)).map((m) => m[1]!));
          let genIndex = 0;
          for (const key of plannedGenKeys) {
            if (!usedKeys.has(key)) { delete images[key]; continue; }
            const res = await this.imageGeneration.generateContextual(domain, slot, key, nearestHeadingForImage(markdown, key), {
              size: String(payload.image_size || "1024x1024"),
              provider: String(payload.image_provider || "").trim() || undefined,
              required: Boolean(payload.image_generation_required),
              index: genIndex++,
              sectionText: sectionExcerptForImage(markdown, key),
            });
            if (res.url) images[key] = res.url;
            else { markdown = stripImageTag(markdown, key); delete images[key]; if (res.warning) imageWarnings.push(res.warning); }
          }
        }
        // 배치되지 않아 빈 채로 남은 생성 슬롯 placeholder 제거
        for (const key of Object.keys(images)) if (!images[key]) delete images[key];
        const slug = this.db.uniqueSlug(domain, slugify(title), sid);
        // 이미지 계측: 실제 생성한(=비용이 드는) 이미지 장수와 추정 비용을 기록한다.
        // SEO_IMAGE_PRICE_USD(장당 단가)로 추정한다. Codex 구독 경로는 0, OpenAI API 경로면 실단가를 넣는다.
        const generatedCount = Object.keys(images).filter((key) => key.startsWith("generated_")).length;
        const imageCostUsd = generatedCount * Number(process.env.SEO_IMAGE_PRICE_USD || 0);
        this.db.updateJobProgress(jobId, { step: `${index + 1}/${slotIds.length} 글 저장 중`, slotId: sid, processed: ok, failed: fail });
        this.db.insertPost({
          domain, slot_id: sid, slug, title, body_markdown: markdown,
          meta_description: metaDescription(markdown), images: Object.keys(images).length ? JSON.stringify(images) : null, design_template_id: designTemplateId,
          provider: result.provider, model, session_id: sessionId, cost_usd: costUsd,
          duration_sec: durationSec, input_tokens: inputTokens, output_tokens: outputTokens,
          job_id: jobId, image_count: generatedCount, image_cost_usd: imageCostUsd, academy_count: renderedCandidateCount(markdown, factsText)
        });
        this.db.updateSlotStatus(sid, "published");
        publishMarkdownArtifact(slug, markdown);
        ok++; producedThisRun++; this.db.updateJobProgress(jobId, { step: `${index + 1}/${slotIds.length} 완료`, slotId: sid, processed: ok, failed: fail }); per_slot.push({ slot_id: sid, ok: true, duration_sec: durationSec, chars: markdown.length, model, design_template_id: designTemplateId, generated_image_count: Object.keys(images).filter((key) => key.startsWith("generated_")).length, image_warnings: imageWarnings });
      } catch (error: any) {
        const message = error?.message || String(error);
        this.db.updateSlotStatus(sid, "failed", message);
        fail++; this.db.updateJobProgress(jobId, { step: `${index + 1}/${slotIds.length} 실패`, slotId: sid, processed: ok, failed: fail }); per_slot.push({ slot_id: sid, ok: false, error: message });
      }
      if (index < slotIds.length - 1) {
        this.db.updateJobProgress(jobId, { step: "다음 글 작성 전 대기 중", slotId: null, processed: ok, failed: fail });
        await sleep(Number(payload.cooldown_sec || 60) * 1000);
      }
    }
    return { ok, fail, skipped, generation_gate_version: "adrock-domain-surface-v1", per_slot };
  }

  private buildFacts(domain: string, slot: Row, opts: { maxAcademyImages?: number; perAcademyImages?: number } = {}, academyTypes?: string[], archetype?: Archetype): GenerationFacts {
    if (!slot.region) return { text: "", images: {}, academyCount: 0, firstAcademyName: "" };
    const region = String(slot.region);
    // 후보 풀 크기·최소 개수·글에 쓰는 개수는 아키타입이 정한다(비교형 7/2/5, 단독형 1/1/1).
    const poolSize = academyPool(archetype);
    const minReq = academyMin(archetype);
    const used = Math.min(poolSize, ACADEMY_USED_PER_POST);
    // 풀(가까운 순)에서 슬롯별 시드 랜덤으로 used 곳을 뽑는다. 같은 슬롯은 항상 같은 조합(재현), 다른 슬롯은 다른 조합.
    const pool = this.pickAcademiesForRegion(domain, region, poolSize, academyTypes, minReq);
    const seed = String(slot.slot_id ?? slot.id ?? `${region}|${slot.primary_keyword ?? ""}`);
    const academies = seededSample(pool, used, seed);
    const maxAcademyImages = opts.maxAcademyImages ?? Infinity;
    const perAcademyImages = opts.perAcademyImages ?? 2;
    const images: Record<string, string> = {};
    const body = academies.map((a, i) => {
      const remaining = Math.max(0, maxAcademyImages - Object.keys(images).length);
      const imageKeys = remaining > 0 ? firstImageKeys(a, i + 1, Math.min(perAcademyImages, remaining)) : [];
      for (const imageKey of imageKeys) images[imageKey.key] = imageKey.url;
      const parts = [`[${i + 1}] ${a.name}`];
      for (const [label, key] of [["주소", "address"], ["수강료", "price"], ["셔틀", "shuttle"], ["영업시간", "hours"], ["합격률", "pass_rate"], ["전화", "phone"], ["대표전화", "vphone"], ["SEO 설명", "seo_description"], ["SEO 키워드", "seo_keywords"], ["지역 중심 기준 거리", "distance_km"]] as const) if (a[key]) parts.push(`${label}: ${key === "distance_km" ? `약 ${a[key]}km` : a[key]}`);
      parts.push(...reviewFactsForAcademy(a));
      const academyType = humanAcademyType(a.academy_type);
      if (academyType) parts.push(`운영 형태: ${academyType}`);
      if (a.latitude && a.longitude) parts.push(`좌표: ${a.latitude}, ${a.longitude}`);
      if (imageKeys.length) parts.push(`사진 슬롯: ${imageKeys.map((imageKey) => `[IMAGE:${imageKey.key}]`).join(", ")}`);
      return parts.join(" / ");
    }).join("\n");
    const related = this.relatedPostsForSlot(domain, slot);
    const relatedText = related.length
      ? ["관련 글 후보(실제 내부 링크, 필요 시 2~4개만 자연스럽게 연결):", ...related.map((post) => `- ${post.title}: https://${domain}/community/${post.slug}`)].join("\n")
      : "";
    const header = [
      `작성 주제 지역: ${region}`,
      `소개 가능한 후보 수: ${academies.length}곳`,
      `사용 가능한 사진: ${Object.keys(images).length ? Object.keys(images).map((key) => `[IMAGE:${key}]`).join(", ") : "없음"}`,
      `후기 문구 보유 후보: ${academies.filter((a) => a.review).length}곳`,
      `작성 범위: 아래 항목에 없는 학원명·가격·합격률·셔틀·후기는 만들지 않는다`,
      `노출 방식: 이 입력 묶음 자체를 출처나 참고자료로 쓰지 않는다`,
    ].join("\n");
    return { text: [header, body, relatedText].filter(Boolean).join("\n\n"), images, academyCount: academies.length, firstAcademyName: String(academies[0]?.name || "") };
  }

  private imagesForSlot(domain: string, slot: Row): Record<string, string> {
    if (!slot.region) return {};
    const images: Record<string, string> = {};
    for (const [i, academy] of this.pickAcademiesForRegion(domain, String(slot.region), ACADEMY_MAX_CANDIDATES).entries()) {
      for (const imageKey of firstImageKeys(academy, i + 1, 2)) images[imageKey.key] = imageKey.url;
    }
    return images;
  }

  private relatedPostsForSlot(domain: string, slot: Row): Row[] {
    const region = String(slot.region || "").trim();
    const keyword = String(slot.primary_keyword || "").replace(region, "").trim();
    const terms = [region, keyword].filter((term) => term.length >= 2).slice(0, 2);
    if (!terms.length) return this.db.all("SELECT title, slug FROM posts WHERE domain=? AND status='published' ORDER BY generated_at DESC LIMIT 5", [domain]);
    const rows = this.db.all("SELECT title, slug FROM posts WHERE domain=? AND status='published' ORDER BY generated_at DESC LIMIT 80", [domain]);
    return rows
      .map((post) => ({ ...post, score: terms.reduce((sum, term) => sum + (String(post.title || "").includes(term) ? 2 : 0) + (String(post.slug || "").includes(term.replace(/\s+/g, "-")) ? 1 : 0), 0) }))
      .sort((a, b) => b.score - a.score)
      .filter((post) => post.score > 0)
      .slice(0, 5);
  }

  // 학원 타입은 글유형(spec.academy_types)이 단일 소스다. 선택값이 있으면 그 타입만, 비어 있으면 학원정보를 쓰지 않는다(빈 배열).
  private resolveAcademyTypes(spec: { academy_types?: string[] } | undefined): string[] {
    const preset = spec?.academy_types;
    return Array.isArray(preset) && preset.length ? preset : [];
  }

  // 선택된 학원 타입이 없으면 학원정보 미사용(후보 0). 있으면 그 타입 후보만 지역 기준으로 모은다.
  // 직접(region 컬럼) 매칭이 목표(limit) 이상이면 그대로. 부족하면 문자열(주소/행정구역 접두) 및
  // 위경도 반경(<= ACADEMY_NEARBY_MAX_KM) 내 인근 후보로 limit 까지 보강한다(인근은 distance_km 표기 → 프롬프트에서 '인근 후보'로 구분).
  private pickAcademiesForRegion(domain: string, region: string, limit: number, academyTypes: string[] = [], minRequired: number = ACADEMY_MIN_FOR_BEST): Row[] {
    if (!academyTypes.length) return [];
    const typeFilter = { academy_types: academyTypes };
    const direct = this.db.listAcademies(domain, { region, ...typeFilter, limit: Math.max(limit * 3, 20) }).filter(isUsableAcademy);
    // 직접 매칭만으로 목표 개수를 채우면 인근 보강 없이 그대로 반환.
    if (direct.length >= limit) return direct.slice(0, limit);
    // 부족분을 전체(타입) 풀에서 보강 — 직접 매칭과 중복 제거.
    const all = this.db.listAcademies(domain, { ...typeFilter, limit: 5000 }).filter(isUsableAcademy);
    const targetRegion = this.db.getSeoRegion(domain, region);
    const targetLat = finiteNumber(targetRegion?.latitude);
    const targetLng = finiteNumber(targetRegion?.longitude);
    const keyOf = (a: Row) => String(a.external_id || a.id || a.name);
    const directKeys = new Set(direct.map(keyOf));
    const withDist = (r: { academy: Row; distanceKm: number | null }) => r.distanceKm === null ? r.academy : { ...r.academy, distance_km: Math.round((r.distanceKm ?? 0) * 10) / 10 };
    const scored = all
      .filter((a) => !directKeys.has(keyOf(a)))
      .map((a) => {
        const addr = String(a.address || "");
        const rowRegion = String(a.region || "");
        const distanceKm = academyDistanceKm(a, targetLat, targetLng);
        let score = Number.POSITIVE_INFINITY;
        if (rowRegion === region) score = 0;                       // region 완전 일치
        else if (addr.includes(region)) score = 1;                 // 주소에 지역 포함
        else if (sameAdministrativePrefix(rowRegion, region) || sameAdministrativePrefix(addr, region)) score = 3; // 같은 행정구역
        else if (distanceKm !== null && distanceKm <= ACADEMY_NEARBY_MAX_KM) score = 2; // 반경 내 인근(거리 게이트)
        return { academy: a, score, distanceKm };
      });
    const supplements = scored
      .filter((r) => Number.isFinite(r.score))
      .sort((a, b) => a.score - b.score || (a.distanceKm ?? Number.POSITIVE_INFINITY) - (b.distanceKm ?? Number.POSITIVE_INFINITY) || String(a.academy.name).localeCompare(String(b.academy.name), "ko"))
      .map(withDist);
    const result = [...direct, ...supplements].slice(0, limit);
    // 최소 보장(B안): 직접+인근이 minRequired(아키타입별) 미만이면, 반경 밖이라도 좌표 기준 '가장 가까운 순'으로
    // ACADEMY_MIN_GUARANTEE_MAX_KM 안에서 최소 개수까지 채운다. 그 안에도 없으면 부족한 대로 둔다(가이드형).
    if (result.length < minRequired) {
      const usedKeys = new Set(result.map(keyOf));
      const far = scored
        .filter((r) => r.distanceKm !== null && r.distanceKm <= ACADEMY_MIN_GUARANTEE_MAX_KM && !usedKeys.has(keyOf(r.academy)))
        .sort((a, b) => (a.distanceKm ?? Number.POSITIVE_INFINITY) - (b.distanceKm ?? Number.POSITIVE_INFINITY))
        .slice(0, minRequired - result.length)
        .map(withDist);
      result.push(...far);
    }
    return result;
  }

  private processDedup(domain: string, payload: Row): Row {
    const threshold = Number(payload.threshold ?? 0.75);
    const dryRun = Boolean(payload.dry_run);
    const posts = this.db.listPostsForDedup(domain, false);
    const pairs: Row[] = [];
    for (let i = 0; i < posts.length; i++) for (let j = i + 1; j < posts.length; j++) {
      const left = posts[i]!;
      const right = posts[j]!;
      const sim = jaccard(left.body_markdown || "", right.body_markdown || "");
      if (sim >= threshold) {
        const loser = Number(left.priority_score || 0) <= Number(right.priority_score || 0) ? left : right;
        pairs.push({ a: left.id, b: right.id, similarity: Math.round(sim * 1000) / 1000, noindex: loser.id });
        if (!dryRun) this.db.updatePostStatus(loser.id, "noindex");
      }
    }
    return { threshold, dry_run: dryRun, pairs, changed: dryRun ? 0 : new Set(pairs.map((p) => p.noindex)).size };
  }

  private processPrune(domain: string, payload: Row): Row {
    const minChars = Number(payload.min_body_chars ?? 2600);
    const dryRun = Boolean(payload.dry_run);
    const rows = this.db.all("SELECT id, slot_id, title, body_markdown, images, length(body_markdown) AS chars FROM posts WHERE domain=? AND status='published'", [domain]);
    const targets: Row[] = [];
    for (const r of rows) {
      const slot = r.slot_id ? this.db.getSlot(String(r.slot_id)) : null;
      // 후보 수 재평가도 생성과 동일한 글유형별 학원 타입으로 맞춘다(academy_types 없으면 학원정보 미사용 → 후보 0).
      const pruneSpec = slot ? this.db.getTemplateSpec(domain, String(slot.template_id || "")) : undefined;
      const candidateCount = slot?.region ? this.pickAcademiesForRegion(domain, String(slot.region), ACADEMY_MAX_CANDIDATES, this.resolveAcademyTypes(pruneSpec)).length : 0;
      const issues = postSurfaceQualityIssues(r, minChars, candidateCount);
      if (issues.length) targets.push({ id: r.id, title: r.title, chars: r.chars, issues });
    }
    if (!dryRun) for (const r of targets) this.db.updatePostStatus(r.id, "noindex");
    return { min_body_chars: minChars, quality_gate: true, dry_run: dryRun, candidates: targets, changed: dryRun ? 0 : targets.length };
  }

  private processIndexing(domain: string, payload: Row): Row {
    const max = Number(payload.max ?? 200);
    const tpl = this.db.getSetting("indexing_url_template") || "https://{domain}/community/{slug}";
    const posts = this.db.listPosts(domain, { status: "published", limit: max });
    const urls = posts.map((p) => tpl.replace("{domain}", domain).replace("{slug}", p.slug));
    return { configured: Boolean(this.db.getSetting("google_sa_json")), submitted: 0, urls, note: "Nest worker collected URLs. Google Indexing submission is intentionally skipped unless a service account integration is added." };
  }
}

export async function runWorkerOnceForCli(): Promise<void> {
  const db = new DbService(); db.init();
  const worker = new WorkerService(db, new ImageGenerationService());
  const job = db.claimNextJob();
  if (!job) { console.log("no queued job"); return; }
  try { db.completeJob(job.id, true, await worker.process(job)); }
  catch (error: any) { db.completeJob(job.id, false, undefined, error?.message || String(error)); process.exitCode = 1; }
}

function firstImageKey(row: Row, index: number): { key: string; url: string } {
  return firstImageKeys(row, index, 1)[0] || { key: `academy_${index}`, url: "" };
}

function firstImageKeys(row: Row, index: number, max = 2): Array<{ key: string; url: string }> {
  const photos = safeJson(row.photos, []);
  const urls = Array.isArray(photos) ? photos.map((v) => String(v || "").trim()).filter(Boolean) : [];
  const thumb = String(row.thumb_url || "").trim();
  if (thumb) urls.unshift(thumb);
  return Array.from(new Set(urls)).slice(0, max).map((url, photoIndex) => ({ key: photoIndex === 0 ? `academy_${index}` : `academy_${index}_${photoIndex + 1}`, url }));
}

function isUsableAcademy(row: Row): boolean {
  const name = String(row.name || "").trim();
  if (!name || /^(?:test|테스트|sample|dummy|asdf|qwer|123|없음|null|undefined)/i.test(name)) return false;
  if (/(?:테스트|샘플|더미|dummy|sample|placeholder)/i.test(name)) return false;
  const usableFields = ["address", "price", "shuttle", "hours", "pass_rate", "phone", "vphone", "review", "seo_description", "seo_keywords", "thumb_url", "photos"];
  return usableFields.some((key) => String(row[key] || "").trim().length >= 8);
}

function reviewFactsForAcademy(row: Row): string[] {
  const facts: string[] = [];
  const reviews = safeJson(row.review_json, []);
  const reviewText = String(row.review || "").trim();
  if (Array.isArray(reviews) && reviews.length) {
    const summary = reviewEvidenceSummary(reviews.map((review) => review?.content), reviews.map((review) => review?.point));
    if (summary) facts.push(`긍정 수강생 리뷰 보충자료: ${summary}`);
  } else if (reviewText) {
    const summary = reviewEvidenceSummary(reviewText.split(/\n+/), []);
    if (summary) facts.push(`긍정 수강생 리뷰 보충자료: ${summary}`);
  }
  const blogReviews = safeJson(row.blog_reviews, []);
  if (Array.isArray(blogReviews) && blogReviews.length) {
    const themes = reviewThemesFromTexts(blogReviews.flatMap((review) => [review?.title, review?.content]));
    const links = blogReviews
      .map((review) => {
        const title = cleanFactText(review?.title).slice(0, 120);
        const link = String(review?.link || "").trim();
        if (!title || !link) return "";
        return `"${title}" ${link}`;
      })
      .filter(Boolean)
      .slice(0, 2);
    if (themes.length || links.length) facts.push(`긍정 블로그 리뷰글 보충자료: ${themes.length ? `후기 흐름 ${themes.join(", ")}` : "후기 흐름 확인"}${links.length ? ` / 참고 글 ${links.join(" | ")}` : ""}`);
  }
  return facts;
}

function reviewEvidenceSummary(values: unknown[], points: unknown[]): string {
  const texts = values.map(cleanFactText).filter(Boolean);
  const themes = reviewThemesFromTexts(texts);
  const pointCount = points.filter((value) => Number(value) >= 4).length;
  const parts: string[] = [];
  if (themes.length) parts.push(`후기 요약 ${themes.join(", ")}`);
  if (pointCount) parts.push(`4점 이상 리뷰 ${pointCount}개`);
  return parts.join(" / ");
}

function reviewThemesFromTexts(values: unknown[]): string[] {
  const text = values.map(cleanFactText).join(" ");
  const themes: Array<[string, RegExp]> = [
    ["친절한 상담·응대", /친절|상담|카운터|직원/u],
    ["강사의 꼼꼼한 설명", /강사|선생|쌤|설명|잘\s*알려|꼼꼼|세심/u],
    ["초보자도 긴장 덜한 분위기", /초보|겁|긴장|안심|분위기|편하/u],
    ["셔틀·방문 동선 만족", /셔틀|동선|가까|위치|방문|편했/u],
    ["시설·차량 관리 만족", /시설|차량|깨끗|청결|쾌적/u],
    ["주변 추천 의향", /추천|강추|지인/u],
  ];
  return themes.filter(([, pattern]) => pattern.test(text)).map(([label]) => label).slice(0, 4);
}

function cleanFactText(value: unknown): string {
  return String(value ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/#[0-9A-Za-z_가-힣]+/g, " ")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function humanAcademyType(value: unknown): string {
  const raw = String(value || "").trim();
  const map: Record<string, string> = {
    academy: "운전학원",
    exam_academy: "자동차운전전문학원",
    test_center: "운전면허시험장",
  };
  return map[raw] || raw.replace(/_/g, " ").trim();
}

// 슬롯 시드로 결정되는(재현 가능한) 랜덤 표본. count 개를 뽑되 원래 순서(가까운 순)를 유지해 제시한다.
function seededSample<T>(items: T[], count: number, seed: string): T[] {
  if (items.length <= count) return items;
  const idx = items.map((_, i) => i);
  const rng = mulberry32(fnv1a(seed));
  for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = idx[i]!; idx[i] = idx[j]!; idx[j] = t; }
  return idx.slice(0, count).sort((a, b) => a - b).map((i) => items[i]!);
}
function fnv1a(s: string): number { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
function mulberry32(a: number): () => number {
  return function () { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function academyDistanceKm(row: Row, targetLat: number | null, targetLng: number | null): number | null {
  const lat = finiteNumber(row.latitude);
  const lng = finiteNumber(row.longitude);
  if (targetLat === null || targetLng === null || lat === null || lng === null) return null;
  return haversineKm(targetLat, targetLng, lat, lng);
}

function finiteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const radiusKm = 6371;
  const dLat = degreesToRadians(lat2 - lat1);
  const dLng = degreesToRadians(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(degreesToRadians(lat1)) * Math.cos(degreesToRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  return radiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function degreesToRadians(value: number): number {
  return value * Math.PI / 180;
}

function sameAdministrativePrefix(left: string, right: string): boolean {
  const l = administrativeTokens(left);
  const r = administrativeTokens(right);
  if (!l.length || !r.length || l[0] !== r[0]) return false;
  return Boolean((l[1] && r[1] && l[1] === r[1]) || (l[2] && r[2] && l[2] === r[2]));
}

function administrativeTokens(value: string): string[] {
  return String(value || "").split(/\s+/).filter((token) => /(?:특별시|광역시|특별자치시|특별자치도|도|시|군|구)$/u.test(token));
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(n) ? Math.trunc(n) : fallback));
}

function appendPlannedImageFacts(facts: string, academyKeys: string[], genKeys: string[]): string {
  const lines: string[] = [];
  if (academyKeys.length) {
    lines.push(`학원 사진 슬롯: ${academyKeys.map((key) => `[IMAGE:${key}]`).join(", ")} / 각 사진(academy_N)은 그 N번째 후보(학원/시험장)를 소개하는 카드 안에 배치한다. 특정 대상을 소개하지 않는 일반 문단에는 넣지 않는다.`);
  }
  if (genKeys.length) {
    lines.push(`생성 이미지 슬롯: ${genKeys.map((key) => `[IMAGE:${key}]`).join(", ")} / 각 슬롯은 배치한 섹션 내용에 맞는 이미지로 생성된다. 서로 다른 섹션에 하나씩 배치한다.`);
  }
  lines.push("제공된 이미지 슬롯만 어울리는 위치에 배치하고, 없는 키나 임의 플레이스홀더는 만들지 않는다.");
  return [facts, lines.join("\n")].filter(Boolean).join("\n\n");
}

// 이미지 태그가 놓인 위치 직전의 가장 가까운 제목(H1~H3)을 섹션 문맥으로 반환한다.
function nearestHeadingForImage(md: string, key: string): string {
  const idx = md.indexOf(`[IMAGE:${key}]`);
  const before = idx >= 0 ? md.slice(0, idx) : md;
  const headings = Array.from(before.matchAll(/^#{1,3}\s+(.+)$/gm));
  return headings.length ? String(headings[headings.length - 1]![1] || "").trim() : "";
}

// 이미지 태그가 놓인 섹션(가장 가까운 제목 ~ 다음 제목)의 본문을 평문으로 발췌한다.
// 제목만으로는 부족한 문단 세부 내용을 이미지 프롬프트에 전달해 정합성을 높인다.
function sectionExcerptForImage(md: string, key: string): string {
  const tag = `[IMAGE:${key}]`;
  const idx = md.indexOf(tag);
  if (idx < 0) return "";
  const before = md.slice(0, idx);
  const headingMatches = Array.from(before.matchAll(/^#{1,3}\s+.+$/gm));
  const last = headingMatches[headingMatches.length - 1];
  const sectionStart = headingMatches.length && last?.index != null ? last.index : 0;
  const after = md.slice(idx + tag.length);
  const nextHeading = after.search(/\n#{1,3}\s+/);
  const sectionEnd = nextHeading >= 0 ? idx + tag.length + nextHeading : md.length;
  return plainTextExcerpt(md.slice(sectionStart, sectionEnd), 400);
}

// 마크다운을 이미지 프롬프트용 평문으로 정리한다(제목/이미지 태그/표/인용 제거, 길이 제한).
function plainTextExcerpt(md: string, maxChars: number): string {
  const text = md
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) =>
      line &&
      !/^#{1,3}\s+/.test(line) &&
      !/^\[IMAGE:[A-Za-z0-9_-]+\]$/.test(line) &&
      !line.startsWith("|") &&
      !line.startsWith(">"),
    )
    .join(" ")
    .replace(/\[IMAGE:[A-Za-z0-9_-]+\]/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#*_`>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxChars ? `${text.slice(0, maxChars).trim()}…` : text;
}

// 특정 이미지 슬롯 태그를 본문에서 제거한다(생성 실패 시).
function stripImageTag(md: string, key: string): string {
  return md
    .split(/\r?\n/)
    .filter((line) => line.trim() !== `[IMAGE:${key}]`)
    .join("\n")
    .split(`[IMAGE:${key}]`)
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeGeneratedMarkdown(summary: string, images: Record<string, string>): string {
  return ensureImageSlots(
    ensureHeadingBodies(
      removeInternalLeakage(
        normalizeKoreanSpacing(
          stripPseudoSlots(
            stripPreamble(summary)
              .replace(/^```(?:markdown|md)?\s*/i, "")
              .replace(/```\s*$/i, "")
              .replace(/\[(\d+)\]/g, "")
              .replace(/\n{3,}/g, "\n\n")
              .trim()
          )
        )
      )
    ),
    images
  );
}

function ensureHeadingBodies(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] || "";
    out.push(line);
    if (!/^#{2,3}\s+/.test(line.trim())) continue;
    const next = lines.slice(i + 1).find((candidate) => candidate.trim());
    if (next && /^#{2,3}\s+/.test(next.trim())) {
      out.push("아래에서는 확인된 후보 정보와 상담 전 체크포인트를 기준으로, 실제로 비교할 때 도움이 되는 내용만 간단히 정리합니다.");
      out.push("");
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function removeInternalLeakage(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let droppingReferenceSection = false;
  for (const line of lines) {
    if (/^#{2,4}\s+.*(?:참고자료|출처|레퍼런스|References)/i.test(line)) {
      droppingReferenceSection = true;
      continue;
    }
    if (droppingReferenceSection && /^#{1,4}\s+/.test(line)) droppingReferenceSection = false;
    if (droppingReferenceSection) continue;
    if (/(api-dev\.drivingplus\.me|get-all-academy|zipcode\/search-seo|내부\s*(?:API|데이터|자료)|검증된 자료|확인된 콘텐츠 재료|작성 범위|소개 가능한 후보 수|본문에 사용할 수 있는 후보|본문에 사용할 수 있는 사진 슬롯|작성자 주의|API 자료|제공된 자료|후기 필드|긍정 수강생 리뷰 보충자료|긍정 블로그 리뷰글 보충자료|직접 매칭 후보 수|사용 가능한 이미지 슬롯|내부자료ID|DrivingPlus|firebasestorage\.googleapis\.com|storage\.googleapis\.com)/i.test(line)) continue;
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function stripMarkdownEmphasis(md: string): string {
  return normalizeKoreanSpacing(md)
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/__([^_\n]+)__/g, "$1")
    .replace(/(^|[\s(])\*([^*\n]+)\*($|[\s).,!?])/g, "$1$2$3")
    .replace(/(^|[\s(])_([^_\n]+)_($|[\s).,!?])/g, "$1$2$3");
}

function normalizeKoreanSpacing(text: string): string {
  return text
    .replace(/([가-힣]+(?:시|군|구|읍|면|동))(운전면허학원)/g, "$1 $2")
    .replace(/상담전확인/g, "상담 전 확인")
    .replace(/동선확인/g, "동선 확인")
    .replace(/비용절약/g, "비용 절약")
    .replace(/셔틀편리/g, "셔틀 편리")
    .replace(/비교추천/g, "비교 추천");
}

function buildRepairPrompt(domain: Row, slot: Row, facts: string, designTemplateId: string, markdown: string, issues: string[], archetype: Archetype | undefined, direction: string, forcedTitle?: string | null): string {
  const brand = publicBrandName(domain);
  const customDesignGuide = designTemplateId === "custom" ? String(domain.custom_design_templates || "").trim() : "";
  return `아래 Markdown 글은 품질 게이트를 통과하지 못했다. 확인된 콘텐츠 재료만 사용해서 같은 주제의 완성형 글로 다시 작성하라.

브랜드: ${brand}
디자인 템플릿: ${designTemplateId}
디자인 작성 지침: ${designWritingGuide(designTemplateId)}
${customDesignGuide ? `사용자 지정 디자인 메모:\n${customDesignGuide}\n` : ""}지침 우선순위:
- 글 유형/검색 의도/검증된 콘텐츠 재료가 상위 계약이다.
- 디자인 지침은 섹션 배치, 강조 방식, CTA 톤을 정하는 보조 지침이며 글 유형의 필수 정보와 충돌하면 글 유형을 우선한다.
템플릿 필수 구조:
${structureGuideForArchetype(archetype)}
원본 엑셀 기반 템플릿 작성법:
${writingGuideForArchetype(archetype, Boolean(slot.region))}
원본 전체 글 패턴 기반 작성법:
${originalArticlePatternGuide(slot)}
주 키워드: ${slot.primary_keyword}
지역: ${slot.region || ""}
페르소나: ${slot.persona || ""}
의도: ${slot.intent || ""}
수식어: ${[slot.modifier_1, slot.modifier_2].filter(Boolean).join(", ")}
공통원칙: ${domain.common_principles || "없음"}
글유형 방향성: ${direction || "없음"}

실패 사유:
${issues.map((issue) => `- ${issue}`).join("\n")}

확인된 콘텐츠 재료:
${facts || "없음"}

재작성 규칙:
- 제목/지역/후보 학원/이미지는 확인된 콘텐츠 재료와 반드시 일치시킨다.
- 소개 가능한 후보가 1곳 이상이면 본문과 표에 실제 후보명 최소 1개를 반드시 넣는다. 후보명이 빠진 일반 가이드 글은 실패다.
- 후보별 설명은 원본 블로그처럼 작은 카드형으로 쓰되, 각 후보 시작은 반드시 '### 후보명' H3 소제목으로 둔다: '### 후보명' → 위치/생활권 → 추천 대상 → 상담 때 확인할 질문 → 사진 순서.
- 긍정 수강생 리뷰/블로그 리뷰글 보충자료가 있으면 리뷰 원문을 길게 인용하지 말고 후보 설명을 보강하는 용도로만 1~2문장 짧게 요약한다.
- 좋은 리뷰라도 합격 보장·과장된 효능은 만들지 말고, “실제 수강후기에서는 친절/동선/설명 방식이 언급된다”처럼 보충 근거로만 쓴다.
- 후보 수보다 큰 숫자, 다른 지역 후보, 없는 가격·합격률·셔틀·후기·3일 합격·당일 합격·합격 보장 주장을 만들지 않는다.
- 구체 금액은 수강료 자료가 있을 때만 쓴다. 자료가 없으면 “비용은 상담 때 확인”과 확인 질문으로 처리한다.
- 주소가 주제 지역과 다르지만 "지역 중심 기준 거리"가 있는 후보는 해당 지역 안의 학원이 아니라 "인근 후보"로만 구분해 설명한다.
${forcedTitle ? `- 첫 줄 H1 제목은 반드시 정확히 "# ${forcedTitle}" 로 쓴다(글자 하나도 바꾸지 말 것). 본문을 이 제목에 맞춘다.` : "- 첫 줄은 '# ' 제목,"} H2 4~6개 중심, 많아도 10개를 넘기지 말고 3,500~5,600자 이내로 쓴다.
- 후보 수와 관계없이 Markdown 표 1개를 반드시 포함한다. 후보가 1곳이면 비교표 대신 주소/연락처/과정/상담 확인점을 담은 요약표로 작성한다.
- 체크리스트는 포함하되 FAQ는 주제가 실제 질문형일 때만 2~4개로 짧게 둔다. 원본처럼 FAQ가 억지로 붙은 느낌이면 만들지 않는다.
- 사용 가능한 이미지 슬롯이 있으면 실제 키만 [IMAGE:academy_1] 형식으로 본문 흐름에 3~4개까지 배치한다.
- 학원명·가격·셔틀·면허종류·준비물처럼 독자가 스캔해야 하는 핵심어는 Markdown bold를 적당히 사용한다.
- 관련 글 후보가 있으면 실제 링크만 2~4개 연결한다. 후보가 없으면 링크를 꾸며내지 않는다.
- [1], [2] 같은 출처번호와 입력 묶음 표현(확인된 콘텐츠 재료, 작성 범위, 소개 가능한 후보 수, API 자료, 후보 수, 참고자료, 내부 API URL 등)은 노출하지 않는다.
- 출처/참고자료는 도로교통공단처럼 실제 외부 공신력 자료를 별도로 인용했을 때만 작성한다. 이번 입력의 학원 API는 출처가 아니라 내부 데이터다.
- 원문보다 더 자연스럽고 풍성한 ${brand} 블로그 톤으로 작성하되, 원본 레퍼런스처럼 구체적인 지역 생활권·비용 확인점·사진·내부링크·CTA가 보이게 만든다.
- 문단은 눈으로 훑기 좋게 짧고 리듬 있게 쓴다. 한 문단은 2~3문장, 가능하면 300자 안팎으로 끊고 420자를 넘기지 않는다.
- H2/H3 제목만 연속으로 붙이지 말고, 제목 아래에는 최소 한 문단·표·리스트·이미지 중 하나를 둔다.
- 긴 설명만 이어가지 말고 표, ✅ 체크리스트, 후보별 소제목, 후기 요약/주의문을 섞는다.
- 출력은 수정된 Markdown 본문만 제공한다.

기존 Markdown:
${markdown}`;
}

// 디자인 결정 우선순위: 작성 요청 지정 → 도메인 설정 → 기본 디자인. auto면 슬롯 글 유형의 기본 디자인으로 치환한다.
// auto 치환 시 통합 경로(template_overrides[tid].design)를 우선 보고, 없으면 레거시 design_template_overrides,
// 그래도 없으면 글유형 기본. (PR3 groundwork: 신규 경로가 비면 레거시가 이겨 동작 보존. 마이그레이션은 P4c에서 UI와 함께.)
// export 이유: load-bearing(모든 발행글 디자인 결정)이라 격리 테스트로 회귀 방어한다.
export function resolveGenerationDesign(payloadDesign: unknown, domain: Row, templateId: unknown, fallbackDesign?: string): string {
  const requested = String(payloadDesign || "").trim() || String(domain.design_template_id || "").trim() || DEFAULT_DRIVING_DESIGN_TEMPLATE;
  if (requested !== AUTO_DESIGN_TEMPLATE_ID) return requested;
  const templateKey = String(templateId || "");
  const unified = safeTemplateOverrides(domain.template_overrides)[templateKey]?.design;
  if (unified && isSelectableDesign(unified)) return unified;
  const overrides = safeDesignOverrides(domain.design_template_overrides);
  if (overrides[templateKey]) return overrides[templateKey]!;
  // 글유형 기본 디자인: spec.default_design(빌트인/커스텀 공통) — 커스텀 id 는 defaultDesignForTemplate 이 못 찾으므로 이걸로 폴백.
  const fallback = String(fallbackDesign || "").trim();
  if (fallback && isSelectableDesign(fallback)) return fallback;
  return defaultDesignForTemplate(templateKey);
}

// 선택 가능한 디자인 id 인가(빌트인 DESIGN_TEMPLATES). safeDesignOverrides 필터와 동일 규칙.
function isSelectableDesign(id: string): boolean {
  const value = String(id || "").trim();
  return DESIGN_TEMPLATES.some((template) => template.id === value);
}

function buildPrompt(domain: Row, slot: Row, facts: string, designTemplateId: string, archetype: Archetype | undefined, direction: string, hasAcademy: boolean, forcedTitle?: string | null): string {
  const brand = publicBrandName(domain);
  const customDesignGuide = designTemplateId === "custom" ? String(domain.custom_design_templates || "").trim() : "";
  return `너는 ${brand} 블로그를 쓰는 한국어 SEO 에디터다. 아래 슬롯과 검증된 자료만 사용해, 회사 콘텐츠 상세 페이지와 HTML 다운로드에서 바로 읽히는 완성형 Markdown 글을 작성하라.

브랜드: ${brand}
업종: ${domain.vertical || "driving"}
디자인 템플릿: ${designTemplateId}
디자인 작성 지침: ${designWritingGuide(designTemplateId)}
${customDesignGuide ? `사용자 지정 디자인 메모:\n${customDesignGuide}\n` : ""}지침 우선순위:
- 글 유형/검색 의도/검증된 콘텐츠 재료가 상위 계약이다.
- 디자인 지침은 섹션 배치, 강조 방식, CTA 톤을 정하는 보조 지침이며 글 유형의 필수 정보와 충돌하면 글 유형을 우선한다.
템플릿 필수 구조:
${structureGuideForArchetype(archetype)}
원본 엑셀 기반 템플릿 작성법:
${writingGuideForArchetype(archetype, Boolean(slot.region))}
템플릿: ${slot.template_id}
원본 전체 글 패턴 기반 작성법:
${originalArticlePatternGuide(slot)}
주 키워드: ${slot.primary_keyword}
지역: ${slot.region || ""}
페르소나: ${slot.persona || ""}
의도: ${slot.intent || ""}
수식어: ${[slot.modifier_1, slot.modifier_2].filter(Boolean).join(", ")}
공통원칙: ${domain.common_principles || "없음"}
글유형 방향성: ${direction || "없음"}

확인된 콘텐츠 재료:
${facts || "없음"}

절대 원칙:
${DRIVING_ABSOLUTE_PRINCIPLES}${hasAcademy ? `\n${DRIVING_ACADEMY_PRINCIPLES}` : ""}

원본 레퍼런스 품질 기준:
- 원본 엑셀의 평균 형태에 맞춘다: 4,000~5,200자대, H2는 4~6개 중심, 표 1개 이상, 리스트 1개 이상, 이미지 3~4개 권장, 관련 내부링크 2~4개 권장, FAQ는 필수 아님.
- 딱딱한 데이터 나열이 아니라 ${brand} 블로그처럼 자연스럽게 시작한다. 예: 지역 생활권, 면허 준비 상황, 비용/동선 고민을 먼저 짚고 후보로 연결한다.
- 원본처럼 "왜 이 후보가 이 지역/상황에 맞는지"를 구체화한다. 주소만 쓰지 말고 생활권, 셔틀 확인 포인트, 면허 종류, 상담 질문, 사진을 같이 엮는다.
- 후보 소개는 원본 블로그의 카드형 리듬을 따른다. 후보마다 반드시 '### 후보명' H3 소제목을 먼저 쓰고, 위치/동선, 추천 대상, 상담 질문, 사진을 짧은 문단과 불릿으로 섞어 보여준다.
- 후보가 적은 지역은 억지로 BEST 숫자를 키우지 말고 “직접 확인 가능한 후보와 인근 선택지”처럼 정직하게 풀되, 실제 후보명이 보이게 쓴다.
- 가격·셔틀·합격률·후기는 검증된 자료에 있을 때만 단정한다. 없으면 "상담 때 확인"으로 처리하되, 무엇을 물어봐야 하는지 구체적인 질문으로 써서 빈말처럼 보이지 않게 한다.
- 수강료 자료가 없으면 60만원대, 70만원대, 709,600원 같은 구체 금액을 추정하지 않는다. 비용 문단은 “상담 시 확인할 항목” 중심으로 쓴다.
- 관련 글 후보가 있으면 실제 URL만 Markdown 링크로 자연스럽게 넣는다. 관련 글 후보가 없으면 내부링크를 만들지 않는다.
- 긍정 수강생 리뷰 보충자료가 있으면 후보 설명 안에서 친절·설명·동선 같은 확인된 후기 포인트를 요약 1문장으로만 사용한다. 단, “운전선생 출처”라는 표현은 쓰지 않는다. 리뷰가 없으면 실제 후기처럼 꾸며 쓰지 말고 상담 확인 팁으로 대체한다.
- 긍정 블로그 리뷰글 보충자료가 있으면 공식 근거처럼 단정하지 말고 “블로그 후기 흐름에서는 이런 점을 확인할 수 있다” 정도로 자연스럽게 녹인다. 링크를 넣을 때는 제공된 실제 URL만 사용한다.

필수 출력 구조:
${forcedTitle ? `- 첫 줄 H1 제목은 반드시 정확히 "# ${forcedTitle}" 로 쓴다(글자 하나도 바꾸지 말 것). 본문 도입·소제목·후보 수 서술을 이 제목에 맞춰 일관되게 쓴다.` : "- 첫 줄은 '# ' H1 제목. 제목은 주 키워드/지역/직접 매칭 후보 수와 모순되면 안 된다."}
- H2 섹션은 4~6개를 기본으로 사용한다. 너무 잘게 쪼개 원본과 다르게 보이지 않게 하고, 많아도 10개를 넘기지 않는다.
- 권장 흐름은 템플릿 필수 구조를 우선 따른다. 공통적으로 도입 → 기준 → 후보/절차 → 비교/요약 → 체크리스트 → 상담/예약 CTA가 자연스럽게 이어져야 한다.
- 제공된 학원 수와 관계없이 Markdown 표 1개를 반드시 포함한다. 후보가 1곳이면 주소/연락처/과정/추천 대상/상담 확인점을 담은 요약표로 작성한다.
- 표는 정상 Markdown 표로 작성한다. 예: | 비교 항목 | 후보 A | 후보 B | 형태. 실제 후보가 있으면 표 안에도 실제 후보명을 넣는다.
- 후보별 설명에는 가능한 경우 학원명, 주소, 대표전화(vphone 우선), 운영 과정/유형, 추천 대상, 상담 시 확인할 점을 포함한다.
- 본문에는 제공된 이미지 슬롯만 사용한다. 학원/시험장 사진 슬롯([IMAGE:academy_*])은 각각 그 학원(또는 시험장)을 소개하는 카드 안에 배치한다(카드별 1장). 특정 대상을 소개하지 않는 일반 설명 문단이나 필기·앱처럼 학원과 무관한 글에는 넣지 않는다.
- 생성 이미지 슬롯([IMAGE:generated_*])이 제공되면 서로 다른 섹션에 하나씩 배치한다. 학원 사진만 제공되면 생성 슬롯 없이 학원 사진만 배치한다.
- 허용된 이미지 슬롯은 자료에 제시된 키만 사용한다. 없는 키나 임의 플레이스홀더는 만들지 않는다.
- [IMAGE_SLOT: ...], [TABLE_SLOT: ...], [CTA_SLOT: ...], [QUOTE_SLOT: ...] 같은 임의 플레이스홀더는 절대 쓰지 말 것.
- 체크리스트 섹션은 ✅ 불릿 목록으로 작성한다.
- FAQ는 필수 아님. 필기시험/접수/준비물처럼 질문형 검색 의도일 때만 2~4개로 짧게 작성한다.
- 마지막 H2 섹션은 ${brand}에서 비교·상담·예약으로 이어지는 자연스러운 CTA로 마무리하고, 브랜드명을 3~7회 정도 자연스럽게 언급한다.

문체/분량:
- 4,000~5,200자를 우선 목표로 하고, 최소 3,500자 이상 5,600자 이내로 작성한다. 원본처럼 구체적인 설명과 표/이미지/링크가 있는 풍성한 글을 목표로 한다.
- 문단 하나는 2~3문장 안에서 끊고, 가능하면 300자 안팎으로 유지한다. 긴 설명 뒤에는 표/불릿/짧은 확인 질문을 넣어 읽기 좋게 만든다.
- 제목만 이어지는 구조는 피한다. 각 H2 아래에는 독자가 바로 이해할 수 있는 짧은 설명, 표, 리스트, 이미지 중 하나가 반드시 따라와야 한다.
- 독자가 바로 도움받을 수 있게 구체적으로 쓰되, 확인되지 않은 장점은 "상담 때 확인"으로 표현한다.
- SEO 키워드는 참고용으로만 사용하고 부자연스럽게 반복하지 말 것.
- 주 키워드와 맞지 않는 내용으로 글 방향을 틀지 말 것.
- 출력은 Markdown 본문만 제공하고 설명/주석은 쓰지 말 것.
- 마지막에 참고자료/출처 목록을 붙이지 말 것. 단, 도로교통공단 등 외부 공신력 자료를 실제로 인용한 경우에만 간단히 남긴다.`;
}
// 디자인의 프롬프트 역할은 '톤/보이스/CTA 강조'만 담당한다. 섹션 배치·구조는 글유형(structureGuideForArchetype)이
// 소유하고, 시각 레이아웃(CSS/컬러)은 공개 렌더 키트가 담당한다. 여기서 구조 문구를 다시 쓰면 글유형 구조와 이중 지시가 된다.
function designWritingGuide(designTemplateId: string): string {
  const guides: Record<string, string> = {
    editorial: "매거진/블로그 톤. 부드럽고 정보성 있는 서술과 자연스러운 브랜드 CTA로 이어간다.",
    comparison: "비교·선택을 돕는 톤. 군더더기 없이 기준을 명확히 제시하는 어조로 쓴다.",
    "local-guide": "동네를 잘 아는 로컬 큐레이터 톤. 생활권·동선을 챙기는 친근한 어조로 쓴다.",
    checklist: "따라 하기 쉬운 안내 톤. 단계별로 명확하고 간결하게 쓴다.",
    conversion: "상담·예약으로 이어지는 전환 톤. 과장 없이 지금 할 행동을 권하는 어조로 쓴다.",
    custom: "사용자 지정 톤. 저장된 디자인 메모의 의도를 우선 반영한다.",
  };
  return guides[designTemplateId] || guides["local-guide"] || guides.editorial!;
}

function safeDesignOverrides(value: unknown): Record<string, string> {
  const raw = typeof value === "string" ? parseJsonObject(value) : value;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const allowed = new Set<string>(DESIGN_TEMPLATES.map((template) => template.id));
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>)
    .map(([templateId, designId]) => [templateId, String(designId || "")])
    .filter((entry) => allowed.has(entry[1] ?? "")));
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function originalArticlePatternGuide(slot: Row): string {
  const summary = loadArticlePatternSummary();
  const articleType = articleTypeForSlot(slot);
  const titlePatterns = selectPatterns(summary.top_title_patterns, articleType, 4);
  const headingPatterns = selectPatterns(summary.top_heading_patterns, articleType, 3);
  const metrics = summary.average_structure_metrics || {};
  const metricLine = [
    `H2 평균 ${formatMetric(metrics.heading_count, "5~6")}`,
    `이미지 평균 ${formatMetric(metrics.image_count, "2~3")}`,
    `표 평균 ${formatMetric(metrics.table_count, "1~2")}`,
    `리스트 평균 ${formatMetric(metrics.bullet_count, "7~8")}`,
    `CTA 표현 평균 ${formatMetric(metrics.cta_term_count, "20+")}`,
  ].join(" / ");
  const lines = [
    `- 이 글은 원본 전체 21,275개 글에서 추출한 '${articleType}' 패턴을 우선 따른다.`,
    `- 평균 구조 기준: ${metricLine}. 단, 검증된 후보/이미지/자료가 부족하면 과장하지 말고 안전하게 축소한다.`,
  ];
  if (titlePatterns.length) {
    lines.push("- 제목 패턴 후보(그대로 복붙하지 말고 슬롯 지역/키워드/후보 수에 맞게 자연화):");
    for (const pattern of titlePatterns) lines.push(`  - ${pattern.pattern} (예: ${pattern.example_title || ""})`);
  }
  if (headingPatterns.length) {
    lines.push("- 헤딩 흐름 후보(H2 순서 참고, 실제 후보 수/자료에 맞게 조정):");
    for (const pattern of headingPatterns) lines.push(`  - ${pattern.pattern}`);
  }
  lines.push("- 패턴보다 사실 검증이 우선이다. 후보 수, 가격, 셔틀, 합격률, 후기, 이미지가 자료와 모순되면 패턴을 버리고 검증된 사실 기준으로 쓴다.");
  return lines.join("\n");
}

function loadArticlePatternSummary(): ArticlePatternSummary {
  const cached = (loadArticlePatternSummary as any).cache as ArticlePatternSummary | undefined;
  if (cached) return cached;
  const file = resolve(PROJECT_DIR, "data/article-patterns/summary.json");
  try {
    const parsed = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
    const summary = parsed && typeof parsed === "object" ? parsed as ArticlePatternSummary : {};
    (loadArticlePatternSummary as any).cache = summary;
    return summary;
  } catch {
    const summary: ArticlePatternSummary = {};
    (loadArticlePatternSummary as any).cache = summary;
    return summary;
  }
}

function articleTypeForSlot(slot: Row): string {
  const templateId = String(slot.template_id || "");
  const text = [slot.primary_keyword, slot.intent, slot.modifier_1, slot.modifier_2].filter(Boolean).join(" ");
  if (/T06|T08|T09|T10|T11|T15/u.test(templateId) || /필기|학과시험|기능시험|도로주행|시험장|접수|문제|앱|어플/u.test(text)) return "exam_best";
  if (/T05|T04/u.test(templateId) || /비용|가격|수강료|절약|1종|2종|보통/u.test(text)) return "cost_comparison";
  if (/T01/u.test(templateId) || /BEST|추천|비교|합격률/u.test(text)) return "local_best_comparison";
  if (/T07|T14/u.test(templateId) || /셔틀|동선|주변|근처|지역/u.test(text)) return "local_access";
  return "general_best";
}

function selectPatterns(patterns: ArticlePattern[] | undefined, articleType: string, limit: number): ArticlePattern[] {
  const rows = Array.isArray(patterns) ? patterns : [];
  const exact = rows.filter((row) => row.article_type === articleType && row.pattern);
  const fallback = rows.filter((row) => row.pattern);
  return (exact.length ? exact : fallback).slice(0, limit);
}

function formatMetric(value: any, fallback: string): string {
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : fallback;
}


function publicBrandName(domain: Row): string {
  return String(domain.display_name || domain.domain || "서비스").replace(/\s*(?:샘플|데모)\s*$/u, "").trim() || "서비스";
}
function extractTitle(md: string, fallback: string) {
  return cleanGeneratedTitle(md.split(/\r?\n/).map((l) => l.trim()).find((l) => l.startsWith("# "))?.slice(2).trim() || fallback);
}

// 제목 규칙 해석: 실제 후보 수로 티어 매칭 + 플레이스홀더 치환. 규칙 없으면 title=null(=LLM 이 H1 결정).
// skip=true 는 후보 수가 min_generate 미만이라 생성하지 않음을 뜻한다(부족 지역 차단).
function resolveTitleFromRule(rule: TitleRule | undefined, ctx: { region: string; count: number; keyword: string; academyName: string }): { title: string | null; skip: boolean } {
  if (!rule) return { title: null, skip: false };
  if (ctx.count < (rule.min_generate ?? 0)) return { title: null, skip: true };
  const tier = [...rule.tiers].sort((a, b) => b.min_count - a.min_count).find((t) => ctx.count >= t.min_count);
  const template = tier?.template ?? rule.fallback;
  if (!template) return { title: null, skip: false };
  const title = template
    .replace(/\{지역\}/g, ctx.region)
    .replace(/\{개수\}/g, String(ctx.count))
    .replace(/\{키워드\}/g, ctx.keyword)
    .replace(/\{학원명\}/g, ctx.academyName)
    .replace(/\s+/g, " ").trim();
  return { title: title || null, skip: false };
}
function rewriteH1Title(md: string, title: string): string {
  const h1 = `# ${cleanGeneratedTitle(title)}`;
  return /^#\s+.+$/m.test(md) ? md.replace(/^#\s+.+$/m, h1) : `${h1}\n\n${md.trim()}`;
}
function cleanGeneratedTitle(title: string): string {
  return normalizeKoreanSpacing(stripMarkdownEmphasis(title))
    .replace(/\s{2,}/g, " ")
    .trim();
}
function slugify(text: string) { return (text || "post").trim().replace(/[^\w가-힣\s-]/g, "").replace(/[\s_]+/g, "-").replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "post"; }
function stripPreamble(md: string) { const lines = md.split(/\r?\n/); const i = lines.findIndex((l) => l.trim().startsWith("# ")); return (i >= 0 ? lines.slice(i).join("\n") : md).trim(); }
function stripPseudoSlots(md: string) {
  return md
    .split(/\r?\n/)
    .filter((line) => !/^\[(?:IMAGE|TABLE|CTA|FAQ|QUOTE|INTERNAL_LINK)_SLOT:[^\]]+\]$/i.test(line.trim()))
    .join("\n")
    .replace(/\[(?:IMAGE|TABLE|CTA|FAQ|QUOTE|INTERNAL_LINK)_SLOT:[^\]]+\]/gi, "")
    .replace(/\[INTERNAL_LINK:[^\]]+\]/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
function ensureImageSlots(md: string, images: Record<string, string>) {
  const keys = Object.keys(images).sort((a, b) => a.localeCompare(b));
  if (!keys.length || /\[IMAGE:[A-Za-z0-9_-]+\]/.test(md)) return md;
  const insertions = keys.slice(0, Math.min(3, keys.length)).map((key) => `[IMAGE:${key}]`);
  const blocks = md.split(/\n{2,}/);
  if (blocks.length <= 2) return `${md}\n\n${insertions.join("\n\n")}`.trim();
  blocks.splice(Math.min(3, blocks.length), 0, insertions[0]!);
  if (insertions[1]) blocks.splice(Math.max(5, Math.floor(blocks.length * 0.55)), 0, insertions[1]);
  if (insertions[2]) blocks.splice(Math.max(7, Math.floor(blocks.length * 0.75)), 0, insertions[2]);
  if (insertions[3]) blocks.splice(Math.max(9, Math.floor(blocks.length * 0.88)), 0, insertions[3]);
  return blocks.join("\n\n").trim();
}
function metaDescription(md: string) { for (const raw of md.split(/\r?\n/)) { const s = raw.trim(); if (s && !s.startsWith("#") && !s.startsWith(">") && !s.startsWith("|") && !/^\[IMAGE:[A-Za-z0-9_-]+\]$/.test(s)) return s.replace(/[\*_`#]/g, "").slice(0, 155); } return ""; }
function publishMarkdownArtifact(slug: string, md: string) { const dir = resolve(PROJECT_DIR, "output"); mkdirSync(dir, { recursive: true }); const staleHtml = resolve(dir, `${slug}.html`); if (existsSync(staleHtml)) unlinkSync(staleHtml); writeFileSync(resolve(dir, `${slug}.md`), md, "utf8"); }
function jaccard(a: string, b: string) { const A = new Set(tokens(a)), B = new Set(tokens(b)); if (!A.size || !B.size) return 0; let inter = 0; for (const t of A) if (B.has(t)) inter++; return inter / (A.size + B.size - inter); }
function tokens(s: string) { return s.toLowerCase().replace(/[^\w가-힣\s]/g, " ").split(/\s+/).filter((t) => t.length > 1); }
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
