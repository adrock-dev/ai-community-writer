import { Inject, Injectable } from "@nestjs/common";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runLlm } from "./llm-runner.js";
import { ACADEMY_MAX_CANDIDATES, ACADEMY_MIN_FOR_BEST, ACADEMY_MIN_GUARANTEE_MAX_KM, ACADEMY_NEARBY_MAX_KM, ACADEMY_USED_PER_POST, AUTO_DESIGN_TEMPLATE_ID, DEFAULT_DRIVING_DESIGN_TEMPLATE, DESIGN_TEMPLATES, DRIVING_ABSOLUTE_PRINCIPLES, DRIVING_ACADEMY_PRINCIPLES, DRIVING_AUTHORITATIVE_SOURCES_GUIDE, TITLE_RULES, defaultDesignForTemplate, type TitleRule } from "./constants.js";
import { resolveTemplateDirection, safeTemplateOverrides } from "./axis-tags.js";
import { publicBrandName } from "./brand.js";
import { buildT16AxisPlan, normalizeT16ReviewAttribution, t16FactsForPrompt, t16PromptContract, t16StructureGuide, t16ToneFromDirection, t16WritingGuide, T16_TEMPLATE_ID, type T16AxisPlan } from "./t16-axis-comparison.js";
import { academyMin, academyPool, getArchetype, structureGuideForArchetype, writingGuideForArchetype, type Archetype } from "./archetypes.js";
import { DbService, safeJson } from "./db.service.js";
import { ImageGenerationService } from "./image-generation.service.js";
import { findMatchedExclusionTerms, findSlotExclusionTerms, parseExclusionTerms, parseMonitoredPhrases } from "./exclusions.js";
import { articleQualityIssues, distanceClaimIssues, titleAxisEvidenceIssues, postSurfaceQualityIssues, renderedCandidateCount, candidateNamesFromFacts, internalLinkIssues, stripUnofferedInternalLinks, normalizeAcademyTerm, REVIEW_SUPPLEMENT_LEAK_PATTERN, stripPublicReviewAttribution } from "./quality-gate.js";
import { seededCandidateSample, selectAcademiesByDistance, selectAcademiesForRegion } from "./academy-candidate-selection.js";
import { buildT01DataGatedContext, type T01DataGatedContext } from "./t01-data-gated.js";
import { buildT01LegacyPlusContext, finalizeLegacyPlusMarkdown, isLockedLegacyPlusReviewOnlyClicheIssue, isT01LegacyPlusMode, isT01TemplateFamily, legacyPlusAcademyPrinciples, legacyPlusArticlePatternGuide, legacyPlusDesignGuide, legacyPlusFactsForPrompt, legacyPlusFaqPromptInstruction, legacyPlusReviewPromptInstruction, legacyPlusStructureGuide, legacyPlusTemplateDirection, legacyPlusWritingGuide, resolveT01GenerationMode, shouldUseT01LegacyPlusMode, T01_LEGACY_PLUS_MODE, t01LegacyPlusPromptContract, t01LegacyPlusQualityIssues, type T01LegacyPlusContext } from "./t01-legacy-plus.js";
import { studentReviewFactLines } from "./academy-review-evidence.js";
import { courseFactText } from "./academy-course-evidence.js";
import { normalizeImageSlotMarkup } from "./post-rendering.js";
import { blockingClass, classifyIssues } from "./quality-gate-severity.js";

type Row = Record<string, any>;

// 품질 게이트 실패를 격리(draft_posts) 저장까지 이어주는 오류.
// 기존 실패 처리(슬롯 failed·잡 카운트)는 그대로 두고, catch 에서 초안을 보존하는 데
// 필요한 정보만 함께 실어 나른다. message 는 기존 문자열 포맷을 그대로 유지한다.
export class QualityGateError extends Error {
  constructor(
    readonly stage: "article" | "final_surface",
    readonly issues: string[],
    readonly draft: Row,
  ) {
    super(`generated article ${stage === "article" ? "quality" : "final surface"} gate failed: ${issues.join(", ")}`);
    this.name = "QualityGateError";
  }
}

// 게이트 실패 시점의 생성물을 격리 초안 레코드로 변환한다.
// facts_text 까지 보관해야 관리자 재검증이 워커 게이트를 그대로 재현할 수 있다.
function draftFromGeneration(domain: string, slot: Row, input: {
  title: string; markdown: string; images: Record<string, string>; factsText: string;
  designTemplateId: string; provider?: string | null; model?: string | null;
}): Row {
  const academyNames = candidateNamesFromFacts(input.factsText).filter((name) => input.markdown.includes(name));
  return {
    domain,
    title: input.title,
    body_markdown: input.markdown,
    meta_description: metaDescription(input.markdown),
    images: Object.keys(input.images).length ? JSON.stringify(input.images) : null,
    design_template_id: input.designTemplateId,
    region: String(slot.region || "") || null,
    primary_keyword: String(slot.primary_keyword || "") || null,
    academy_names: academyNames.length ? JSON.stringify(academyNames) : null,
    facts_text: input.factsText,
    provider: input.provider ?? null,
    model: input.model ?? null,
  };
}

type GenerationFacts = { text: string; images: Record<string, string>; academyCount: number; firstAcademyName: string; academies: Row[] };
type ArticlePattern = { pattern_type?: string; pattern?: string; count?: number; example_title?: string; article_type?: string };
type ArticlePatternSummary = { average_structure_metrics?: Row; top_title_patterns?: ArticlePattern[]; top_heading_patterns?: ArticlePattern[] };
export type GenerationPromptOptions = {
  structureGuide?: string;
  writingGuide?: string;
  articlePatternGuide?: string;
  designGuide?: string;
  modifierLabels?: string[];
  reviewInstruction?: string;
  faqInstruction?: string;
  academyPrinciples?: string;
  /** Opt-in only: keeps T01 Legacy Plus focused on licence/course differences,
   * rather than turning retrieval-only location evidence into the article's
   * main composition. */
  readerFlow?: boolean;
  /** T01 built-in or T01-origin custom template. Keeps comparison-only safety
   * guidance available even when an explicit legacy override is used. */
  t01Comparison?: boolean;
};

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
    const requestedGenerationMode = String(payload.generation_mode ?? "legacy");
    if (["t01_data_gated_v2", "t01_hybrid_v1"].includes(requestedGenerationMode)) {
      throw new Error(`retired generation mode: ${requestedGenerationMode}; use legacy or ${T01_LEGACY_PLUS_MODE}`);
    }
    if (!["auto", "legacy", T01_LEGACY_PLUS_MODE].includes(requestedGenerationMode)) {
      throw new Error(`unknown generation mode: ${requestedGenerationMode}`);
    }
    const domainMeta = this.db.getDomain(domain) || {};
    const slotIds = Array.isArray(payload.slot_ids) ? payload.slot_ids : [];
    const exclusionTerms = parseExclusionTerms(domainMeta.excluded_keywords);
    const monitoredPhrases = parseMonitoredPhrases(domainMeta.monitored_phrases);
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
        this.db.updateSlotStatus(sid, "skipped", message);
        skipped++; this.db.updateJobProgress(jobId, { step: "제외 규칙으로 건너뜀", slotId: sid, processed: ok, failed: fail }); per_slot.push({ slot_id: sid, ok: false, skipped: true, error: message });
        continue;
      }
      // 글유형 spec(빌트인/커스텀): 디자인 폴백·아키타입·방향성 해석의 공통 소스로 먼저 해석.
      const templateSpec = this.db.getTemplateSpec(domain, String(slot.template_id || ""));
      const isT01Family = isT01TemplateFamily(slot.template_id, templateSpec?.origin_template_id);
      if (isT01LegacyPlusMode(requestedGenerationMode) && !isT01Family) {
        throw new Error(`${requestedGenerationMode} is only supported for T01 slots`);
      }
      const effectiveGenerationMode = resolveT01GenerationMode(requestedGenerationMode, slot.template_id, templateSpec?.origin_template_id);
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
        // Legacy Plus만 동일 최종 후보의 typed facts를 내부 검수·리뷰 선택에 사용한다.
        const t01Context = shouldUseT01LegacyPlusMode(slot.template_id, effectiveGenerationMode, templateSpec?.origin_template_id)
          ? this.buildT01DataGatedContext(domain, slot, academyTypes, archetype)
          : null;
        const t01LegacyPlusContext = t01Context && shouldUseT01LegacyPlusMode(slot.template_id, effectiveGenerationMode, templateSpec?.origin_template_id)
          ? buildT01LegacyPlusContext(t01Context, structureSeed(slot))
          : null;
        // 제목 규칙(생성 시점 해석): 실제 후보 수로 제목 확정 → 프롬프트 주입. 후보 수 부족(min_generate 미만)이면 생성하지 않는다.
        const titleRule = (templateSpec?.title_rule as TitleRule | undefined) ?? TITLE_RULES[String(slot.template_id || "")];
        // T16: 슬롯 축(modifier/intent)을 facts 근거로 검증·강등해 이 글의 비교 기준·필수 응답·제목 부제를 확정한다.
        const t16Plan: T16AxisPlan | null = isT16Slot(slot, archetype) ? buildT16AxisPlan(slot, facts.academies) : null;
        const titleCtx = { region: String(slot.region || ""), count: facts.academyCount, keyword: String(slot.primary_keyword || ""), academyName: facts.firstAcademyName, subtitle: t16Plan?.subtitle };
        const titleResolved = resolveTitleFromRule(titleRule, titleCtx);
        // 슬롯 수동 제목이 있으면 규칙 제목보다 우선(생성 시점 치환). 스킵 판정은 규칙(min_generate)이 유지한다.
        const forcedTitle = effectiveGenerationTitle(slot.title, titleResolved.title, titleCtx);
        if (titleResolved.skip) {
          const message = `학원 부족: 후보 ${facts.academyCount}곳 < 최소 ${titleRule?.min_generate}곳(제목 규칙)`;
          this.db.updateSlotStatus(sid, "skipped", message);
          skipped++; this.db.updateJobProgress(jobId, { step: "학원 부족으로 건너뜀", slotId: sid, processed: ok, failed: fail }); per_slot.push({ slot_id: sid, ok: false, skipped: true, error: message });
          continue;
        }
        const factsMatches = findMatchedExclusionTerms(facts.text, exclusionTerms);
        if (factsMatches.length) {
          const message = `excluded by domain rule in facts: ${factsMatches.join(", ")}`;
          this.db.updateSlotStatus(sid, "skipped", message);
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
        const promptFactsText = t01LegacyPlusContext ? legacyPlusFactsForPrompt(factsText) : t16Plan ? t16FactsForPrompt(factsText) : factsText;
        const t01PromptOptions: GenerationPromptOptions | undefined = t01LegacyPlusContext ? {
          structureGuide: legacyPlusStructureGuide(t01LegacyPlusContext),
          writingGuide: legacyPlusWritingGuide(t01LegacyPlusContext),
          articlePatternGuide: legacyPlusArticlePatternGuide(t01LegacyPlusContext),
          designGuide: legacyPlusDesignGuide(),
          academyPrinciples: legacyPlusAcademyPrinciples(),
          modifierLabels: readerFacingModifierLabels(slot),
          reviewInstruction: legacyPlusReviewPromptInstruction(t01LegacyPlusContext),
          faqInstruction: legacyPlusFaqPromptInstruction(),
          readerFlow: true,
          t01Comparison: true,
        } : t16Plan ? {
          // T16: facts 가공·글 뼈대·톤은 Legacy Plus 의 범용 헬퍼를 재사용하고(SEO 설명·키워드·좌표·리뷰 제거,
          // 원본 패턴 블록의 도메인 이탈 노이즈 차단), 구조는 축이 정한 열·주제·질문으로,
          // 문체는 T16 전용 스토리텔링 지침(t16WritingGuide)으로 확장한다. 격식 수준(대화체/전문가)은
          // 글유형 방향성이 정한다 — 기본 T16=대화체, 복제한 전문가판 커스텀 유형=전문가.
          structureGuide: t16StructureGuide(structureGuideForArchetype(archetype, structureSeed(slot)), t16Plan),
          writingGuide: t16WritingGuide(slot, t16ToneFromDirection(templateDirection)),
          articlePatternGuide: legacyPlusArticlePatternGuide(),
          designGuide: legacyPlusDesignGuide(),
          readerFlow: true,
          t01Comparison: true,
          // "가까운/근처"는 선택 힌트일 뿐 독자용 관점이 아니라 라벨에서 뺀다(helper 주석 참조).
          modifierLabels: readerFacingModifierLabels(slot),
        } : (isT01Family ? { t01Comparison: true } : undefined);
        const effectiveDirection = t01LegacyPlusContext ? legacyPlusTemplateDirection(t01LegacyPlusContext) : templateDirection;
        const legacyPrompt = buildPrompt(domainMeta, slot, promptFactsText, designTemplateId, archetype, effectiveDirection, academyTypes.length > 0, forcedTitle, t01PromptOptions);
        const t01Contract = t01LegacyPlusContext ? t01LegacyPlusPromptContract(t01LegacyPlusContext) : t16Plan ? t16PromptContract(t16Plan, slot, facts.academyCount) : "";
        const prompt = t01Contract ? `${legacyPrompt}\n\n${t01Contract}` : legacyPrompt;
        const llmOpts = { provider: payload.provider || "codex", model: payload.model || "", timeoutSec: Number(payload.timeout_sec || 600) };
        this.db.updateJobProgress(jobId, { step: `${index + 1}/${slotIds.length} 본문 생성 중`, slotId: sid, processed: ok, failed: fail });
        const result = await runLlm(prompt, llmOpts);
        if (!result.ok || !result.summary.trim()) throw new Error(result.error || "empty summary");
        let markdown = normalizeGeneratedMarkdown(result.summary, images, domain);
        if (t01LegacyPlusContext) markdown = finalizeLegacyPlusMarkdown(markdown, t01LegacyPlusContext);
        if (t16Plan) markdown = normalizeT16ReviewAttribution(markdown);
        // 제공한 '관련 글 후보' 밖의 지어낸 /community/ 내부링크(미생성 글) 해제 — 발행 글의 죽은 링크 방지.
        markdown = stripUnofferedInternalLinks(markdown, factsText);
        // 학원형 글: 내부 용어 '후보'가 본문·소제목에 새면 독자용 '학원'으로 보정(비학원형은 '정답 후보' 등 정상 용례라 제외).
        if (academyTypes.length > 0) markdown = normalizeAcademyTerm(markdown);
        let t01Issues = t01LegacyPlusContext ? t01LegacyPlusQualityIssues(markdown, t01LegacyPlusContext) : [];
        let qualityIssues = [...articleQualityIssues(markdown, factsText, images, monitoredPhrases, domain).filter((issue) => !t01LegacyPlusContext || !isLockedLegacyPlusReviewOnlyClicheIssue(issue, markdown, t01LegacyPlusContext)), ...t01ComparisonScopeIssues(markdown, isT01Family), ...(t16Plan ? [...distanceClaimIssues(markdown), ...titleAxisEvidenceIssues(forcedTitle || "", promptFactsText)] : []), ...t01Issues.filter((issue) => issue.severity === "hard_failure").map((issue) => `t01_${issue.code}`)];
        let durationSec = result.duration_sec;
        let costUsd = result.cost_usd || 0;
        let inputTokens = result.input_tokens || 0;
        let outputTokens = result.output_tokens || 0;
        let sessionId = result.session_id;
        let model = result.model;
        const maxRepairAttempts = clampInt(payload.max_repair_attempts, 2, 0, 3);
        const t01RepairFailureHistory: string[][] = [];
        let t01RepairStopReason: string | null = null;
        const seenT01FailureSignatures = new Set<string>();
        for (let repairAttempt = 0; qualityIssues.length && repairAttempt < maxRepairAttempts; repairAttempt++) {
          if (t01Context) {
            const signature = qualityIssues.slice().sort().join("|");
            if (seenT01FailureSignatures.has(signature)) { t01RepairStopReason = "repeated_failure_signature"; break; }
            seenT01FailureSignatures.add(signature);
            t01RepairFailureHistory.push([...qualityIssues]);
          }
          this.db.updateJobProgress(jobId, { step: `${index + 1}/${slotIds.length} 품질 보정 ${repairAttempt + 1}회차`, slotId: sid, processed: ok, failed: fail });
          const legacyRepairPrompt = buildRepairPrompt(domainMeta, slot, promptFactsText, designTemplateId, markdown, qualityIssues, archetype, effectiveDirection, forcedTitle, t01PromptOptions);
          const repair = await runLlm(t01Contract ? `${legacyRepairPrompt}\n\n${t01Contract}` : legacyRepairPrompt, llmOpts);
          durationSec += repair.duration_sec;
          costUsd += repair.cost_usd || 0;
          inputTokens += repair.input_tokens || 0;
          outputTokens += repair.output_tokens || 0;
          sessionId = repair.session_id || sessionId;
          model = repair.model || model;
          if (repair.ok && repair.summary.trim()) {
            markdown = normalizeGeneratedMarkdown(repair.summary, images, domain);
            if (t01LegacyPlusContext) markdown = finalizeLegacyPlusMarkdown(markdown, t01LegacyPlusContext);
            markdown = stripUnofferedInternalLinks(markdown, factsText);
            if (academyTypes.length > 0) markdown = normalizeAcademyTerm(markdown);
            t01Issues = t01LegacyPlusContext ? t01LegacyPlusQualityIssues(markdown, t01LegacyPlusContext) : [];
            qualityIssues = [...articleQualityIssues(markdown, factsText, images, monitoredPhrases, domain).filter((issue) => !t01LegacyPlusContext || !isLockedLegacyPlusReviewOnlyClicheIssue(issue, markdown, t01LegacyPlusContext)), ...t01ComparisonScopeIssues(markdown, isT01Family), ...t01Issues.filter((issue) => issue.severity === "hard_failure").map((issue) => `t01_${issue.code}`)];
          }
        }
        if (qualityIssues.length) throw new QualityGateError("article", qualityIssues, draftFromGeneration(domain, slot, {
          title: forcedTitle || extractTitle(markdown, slot.primary_keyword),
          markdown, images, factsText, designTemplateId, provider: result.provider, model,
        }));
        // 규칙으로 확정한 제목이 있으면 강제(LLM 즉흥 방지). 없으면 기존대로 본문 H1 추출.
        const title = forcedTitle || extractTitle(markdown, slot.primary_keyword);
        markdown = rewriteH1Title(markdown, title);
        const generatedMatches = findMatchedExclusionTerms(`${title}\n${markdown}`, exclusionTerms);
        if (generatedMatches.length) {
          const message = `excluded by domain rule in generated article: ${generatedMatches.join(", ")}`;
          this.db.updateSlotStatus(sid, "skipped", message);
          skipped++; this.db.updateJobProgress(jobId, { step: "생성문 제외 규칙으로 건너뜀", slotId: sid, processed: ok, failed: fail }); per_slot.push({ slot_id: sid, ok: false, skipped: true, error: message });
          continue;
        }
        t01Issues = t01LegacyPlusContext ? t01LegacyPlusQualityIssues(markdown, t01LegacyPlusContext) : [];
        const finalIssues = [...postSurfaceQualityIssues({ title, body_markdown: markdown, images: Object.keys(images).length ? JSON.stringify(images) : null, design_template_id: designTemplateId }, 3500, renderedCandidateCount(markdown, factsText), monitoredPhrases, domain).filter((issue) => !t01LegacyPlusContext || !isLockedLegacyPlusReviewOnlyClicheIssue(issue, markdown, t01LegacyPlusContext)), ...t01Issues.filter((issue) => issue.severity === "hard_failure").map((issue) => `t01_${issue.code}`)];
        if (finalIssues.length) throw new QualityGateError("final_surface", finalIssues, draftFromGeneration(domain, slot, {
          title, markdown, images, factsText, designTemplateId, provider: result.provider, model,
        }));
        // 내부링크(P3)는 비차단 신호다: 관련 후보가 주어졌는데 링크가 없으면 실패시키지 않고 경고로만 남긴다(대량 실패 방지).
        const qualityWarnings = [...internalLinkIssues(markdown, factsText), ...t01Issues.filter((issue) => issue.severity !== "hard_failure").map((issue) => `t01_${issue.severity}_${issue.code}`)];
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
        // 본문에 실제 등장한 후보 학원명만 저장 → academy_count 와 동일 집합(정합성). 렌더 시점 JSON-LD/ALT 파생의 원천.
        const renderedAcademyNames = candidateNamesFromFacts(factsText).filter((name) => markdown.includes(name));
        this.db.insertPost({
          domain, slot_id: sid, slug, title, body_markdown: markdown,
          meta_description: metaDescription(markdown), images: Object.keys(images).length ? JSON.stringify(images) : null, design_template_id: designTemplateId,
          provider: result.provider, model, session_id: sessionId, cost_usd: costUsd,
          duration_sec: durationSec, input_tokens: inputTokens, output_tokens: outputTokens,
          job_id: jobId, image_count: generatedCount, image_cost_usd: imageCostUsd, academy_count: renderedAcademyNames.length,
          region: String(slot.region || "") || null, primary_keyword: String(slot.primary_keyword || "") || null,
          academy_names: renderedAcademyNames.length ? JSON.stringify(renderedAcademyNames) : null
        });
        this.db.updateSlotStatus(sid, "published");
        publishMarkdownArtifact(slug, markdown);
        ok++; producedThisRun++; this.db.updateJobProgress(jobId, { step: `${index + 1}/${slotIds.length} 완료`, slotId: sid, processed: ok, failed: fail }); per_slot.push({ slot_id: sid, ok: true, duration_sec: durationSec, chars: markdown.length, model, design_template_id: designTemplateId, generated_image_count: Object.keys(images).filter((key) => key.startsWith("generated_")).length, image_warnings: imageWarnings, quality_warnings: qualityWarnings, effective_generation_mode: effectiveGenerationMode, ...(t01LegacyPlusContext ? { t01_generation_mode: t01LegacyPlusContext.mode, t01_quality_issues: t01Issues, t01_repair_failure_history: t01RepairFailureHistory, t01_repair_stop_reason: t01RepairStopReason } : {}) });
      } catch (error: any) {
        const message = error?.message || String(error);
        // 게이트 실패로 버려지던 본문을 격리 보관한다(관리자 검수용). 공개 경로와 분리된 draft_posts 로만 들어간다.
        // 격리 저장이 실패해도 기존 실패 처리(슬롯 failed·잡 카운트)는 그대로 진행한다.
        let draftId: string | null = null;
        if (error instanceof QualityGateError) {
          try {
            draftId = this.db.insertDraftPost({
              ...error.draft,
              domain, slot_id: sid, job_id: jobId,
              gate_stage: error.stage,
              quality_issues: JSON.stringify(classifyIssues(error.issues)),
              blocking_class: blockingClass(error.issues),
            });
          } catch { draftId = null; }
        }
        this.db.updateSlotStatus(sid, "failed", message);
        fail++; this.db.updateJobProgress(jobId, { step: `${index + 1}/${slotIds.length} 실패`, slotId: sid, processed: ok, failed: fail }); per_slot.push({ slot_id: sid, ok: false, error: message, ...(draftId ? { draft_id: draftId } : {}) });
      }
      if (index < slotIds.length - 1) {
        this.db.updateJobProgress(jobId, { step: "다음 글 작성 전 대기 중", slotId: null, processed: ok, failed: fail });
        await sleep(Number(payload.cooldown_sec || 60) * 1000);
      }
    }
    return { ok, fail, skipped, generation_gate_version: "adrock-domain-surface-v1", per_slot };
  }

  private buildFacts(domain: string, slot: Row, opts: { maxAcademyImages?: number; perAcademyImages?: number } = {}, academyTypes?: string[], archetype?: Archetype): GenerationFacts {
    if (!slot.region) return { text: "", images: {}, academyCount: 0, firstAcademyName: "", academies: [] };
    const region = String(slot.region);
    // 후보 풀 크기·최소 개수·글에 쓰는 개수는 아키타입이 정한다(비교형 7/2/5, 단독형 1/1/1).
    const poolSize = academyPool(archetype);
    const minReq = academyMin(archetype);
    const used = Math.min(poolSize, ACADEMY_USED_PER_POST);
    // T16 은 거리 단일 기준으로 뽑는다(지역 문자열 매칭을 거리보다 우선하지 않는다).
    const isT16 = isT16Slot(slot, archetype);
    const pool = isT16
      ? selectAcademiesByDistance(this.db, domain, region, poolSize, academyTypes ?? [], minReq).candidates
      : this.pickAcademiesForRegion(domain, region, poolSize, academyTypes, minReq);
    const seed = String(slot.slot_id ?? slot.id ?? `${region}|${slot.primary_keyword ?? ""}`);
    // T16 은 "다닐 수 있는 범위"가 전제라 가장 가까운 후보를 버리면 안 된다. 무작위 표본(다양성 장치)
    // 대신 거리순 상위 used 곳을 결정적으로 쓴다(pool 이 이미 거리순). 다양성은 축이 담당한다.
    // 그 외 유형은 기존대로 슬롯 시드 랜덤 — 같은 슬롯은 같은 조합(재현), 다른 슬롯은 다른 조합.
    const academies = isT16 ? pool.slice(0, used) : seededCandidateSample(pool, used, seed);
    const maxAcademyImages = opts.maxAcademyImages ?? Infinity;
    const perAcademyImages = opts.perAcademyImages ?? 2;
    const images: Record<string, string> = {};
    const body = academies.map((a, i) => {
      const remaining = Math.max(0, maxAcademyImages - Object.keys(images).length);
      const imageKeys = remaining > 0 ? firstImageKeys(a, i + 1, Math.min(perAcademyImages, remaining)) : [];
      for (const imageKey of imageKeys) images[imageKey.key] = imageKey.url;
      const parts = [`[${i + 1}] ${a.name}`];
      for (const [label, key] of [["주소", "address"], ["수강료", "price"], ["셔틀", "shuttle"], ["영업시간", "hours"], ["합격률", "pass_rate"], ["SEO 설명", "seo_description"], ["SEO 키워드", "seo_keywords"]] as const) if (a[key]) parts.push(`${label}: ${a[key]}`);
      // 공개 글에 노출할 연락처는 안심번호(vphone) 하나뿐이다. 실번호(phone)는 facts 에 아예
      // 넣지 않는다. 두 번호를 다 보내면 프롬프트로 "우선"을 지시해도 모델이 둘을 병기했다
      // (발행 글 20편 중 9편). 노출 여부는 프롬프트가 아니라 입력에서 끊는다.
      const contactPhone = String(a.vphone || "").trim();
      if (contactPhone) parts.push(`전화: ${contactPhone}`);
      // 운영 과정은 원천의 구조화 필드에서 온다. facts 에 명시해 두면 하위 경로가 SEO 설명을
      // 다시 파싱하지 않아도 되고(단일 출처), 자동·수동 구분이 그대로 살아 있다.
      const courses = courseFactText(a);
      if (courses) parts.push(`운영 과정: ${courses}`);
      parts.push(...reviewFactsForAcademy(a, seed));
      const academyType = humanAcademyType(a.academy_type);
      if (academyType) parts.push(`운영 형태: ${academyType}`);
      if (a.latitude && a.longitude) parts.push(`좌표: ${a.latitude}, ${a.longitude}`);
      if (imageKeys.length) parts.push(`사진 슬롯: ${imageKeys.map((imageKey) => `[IMAGE:${imageKey.key}]`).join(", ")}`);
      return parts.join(" / ");
    }).join("\n");
    const related = this.relatedPostsForSlot(domain, slot);
    const relatedText = related.length
      ? ["관련 글 후보(아래 실제 URL 중 최소 1개는 반드시 본문에 Markdown 링크로 자연스럽게 연결한다. 2~4개까지 가능):", ...related.map((post) => `- ${post.title}: https://${domain}/community/${post.slug}`)].join("\n")
      : "";
    const header = [
      `작성 주제 지역: ${region}`,
      `소개 가능한 후보 수: ${academies.length}곳`,
      `사용 가능한 사진: ${Object.keys(images).length ? Object.keys(images).map((key) => `[IMAGE:${key}]`).join(", ") : "없음"}`,
      `후기 문구 보유 후보: ${academies.filter((a) => a.review).length}곳`,
      academyTypeGlossary(academies),
      `작성 범위: 아래 항목에 없는 학원명·가격·합격률·셔틀·후기는 만들지 않는다`,
      `노출 방식: 이 입력 묶음 자체를 출처나 참고자료로 쓰지 않는다`,
    ].filter(Boolean).join("\n");
    return { text: [header, body, relatedText].filter(Boolean).join("\n\n"), images, academyCount: academies.length, firstAcademyName: String(academies[0]?.name || ""), academies };
  }

  private imagesForSlot(domain: string, slot: Row): Record<string, string> {
    if (!slot.region) return {};
    const images: Record<string, string> = {};
    for (const [i, academy] of this.pickAcademiesForRegion(domain, String(slot.region), ACADEMY_MAX_CANDIDATES).entries()) {
      for (const imageKey of firstImageKeys(academy, i + 1, 2)) images[imageKey.key] = imageKey.url;
    }
    return images;
  }

  private relatedPostsForSlot(_domain: string, _slot: Row): Row[] {
    // 내부(자사) 글 링크 비활성화. 공개 사이트가 링크 대상 글을 아직 안정적으로 서빙하지 못해
    // (생성 예정/미발행 포함) 죽은 링크가 발행 글에 남아 신뢰도를 떨어뜨렸다. 후보를 아예 제공하지
    // 않으므로 facts 에 '관련 글 후보'가 없고 → buildPrompt/repair 가 내부 링크를 '금지'로 전환하며
    // → stripUnofferedInternalLinks 가 모델이 그래도 만든 /community/ 링크를 전부 해제한다.
    //
    // 재개하려면 아래 published 조회를 복원한다(프롬프트·스트립은 facts 유무로 자동 전환됨):
    //   const region = String(slot.region || "").trim();
    //   const keyword = String(slot.primary_keyword || "").replace(region, "").trim();
    //   const terms = [region, keyword].filter((t) => t.length >= 2).slice(0, 2);
    //   if (!terms.length) return this.db.all("SELECT title, slug FROM posts WHERE domain=? AND status='published' ORDER BY generated_at DESC LIMIT 5", [domain]);
    //   const rows = this.db.all("SELECT title, slug FROM posts WHERE domain=? AND status='published' ORDER BY generated_at DESC LIMIT 80", [domain]);
    //   return rows.map((p) => ({ ...p, score: terms.reduce((s, t) => s + (String(p.title||"").includes(t)?2:0) + (String(p.slug||"").includes(t.replace(/\s+/g,"-"))?1:0), 0) }))
    //     .sort((a, b) => b.score - a.score).filter((p) => p.score > 0).slice(0, 5);
    return [];
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
    return this.selectAcademiesForRegion(domain, region, limit, academyTypes, minRequired).candidates;
  }

  private selectAcademiesForRegion(domain: string, region: string, limit: number, academyTypes: string[] = [], minRequired: number = ACADEMY_MIN_FOR_BEST) {
    return selectAcademiesForRegion(this.db, domain, region, limit, academyTypes, minRequired);
  }

  private buildT01DataGatedContext(domain: string, slot: Row, academyTypes: string[], archetype: Archetype | undefined): T01DataGatedContext | null {
    if (!slot.region || !academyTypes.length) return null;
    const poolSize = academyPool(archetype);
    const minRequired = academyMin(archetype);
    const selection = this.selectAcademiesForRegion(domain, String(slot.region), poolSize, academyTypes, minRequired);
    const seed = String(slot.slot_id ?? slot.id ?? `${slot.region}|${slot.primary_keyword ?? ""}`);
    const candidates = seededCandidateSample(selection.candidates, Math.min(poolSize, ACADEMY_USED_PER_POST), seed);
    return buildT01DataGatedContext(String(slot.region), candidates, selection.trace, seed, [slot.modifier_1, slot.modifier_2]);
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
    const monitoredPhrases = parseMonitoredPhrases(this.db.getDomain(domain)?.monitored_phrases);
    const rows = this.db.all("SELECT id, slot_id, title, body_markdown, images, length(body_markdown) AS chars FROM posts WHERE domain=? AND status='published'", [domain]);
    const targets: Row[] = [];
    for (const r of rows) {
      const slot = r.slot_id ? this.db.getSlot(String(r.slot_id)) : null;
      // 후보 수 재평가도 생성과 동일한 글유형별 학원 타입으로 맞춘다(academy_types 없으면 학원정보 미사용 → 후보 0).
      const pruneSpec = slot ? this.db.getTemplateSpec(domain, String(slot.template_id || "")) : undefined;
      const candidateCount = slot?.region ? this.pickAcademiesForRegion(domain, String(slot.region), ACADEMY_MAX_CANDIDATES, this.resolveAcademyTypes(pruneSpec)).length : 0;
      const issues = postSurfaceQualityIssues(r, minChars, candidateCount, monitoredPhrases, domain);
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


function reviewFactsForAcademy(row: Row, seed: string): string[] {
  const facts: string[] = [];
  facts.push(...studentReviewFactLines(row, seed));
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

/**
 * 후보에 등장하는 운영 형태의 의미를 한 번만 설명한다(academy vs exam_academy 차이).
 *
 * facts 에는 `운영 형태: 자동차운전전문학원` 처럼 라벨만 들어가는데, 모델은 이 유형이 실제로
 * 무엇이 다른지 모른다. 이건 특정 intent 전용 지식이 아니라, 학원을 소개하는 모든 글유형이
 * 글 전반에서 배경으로 알고 있어야 하는 도메인 상식이라 buildFacts 공통 헤더에 항상 넣는다.
 * '치른다'로 서술한다 — 비교글 out-of-scope 게이트가 막는 '시험 접수·응시' 표현을 피하면서
 * "시험을 어디서 보는가"라는 차이를 전달한다. 등장하지 않는 유형은 넣지 않는다.
 */
export function academyTypeGlossary(academies: Row[]): string {
  const types = new Set(academies.map((academy) => String(academy.academy_type || "").trim()));
  const lines: string[] = [];
  if (types.has("exam_academy")) lines.push("자동차운전전문학원: 학원 안에 시험 코스가 있어 기능·도로주행까지 학원에서 치르는 유형");
  if (types.has("academy")) lines.push("운전학원: 차량 연습 중심으로, 기능·도로주행은 관할 운전면허시험장에서 치르는 유형");
  // "참고"로 명시한다 — 글이 반드시 이 차이를 설명해야 하는 건 아니다. 유형을 정확히 이해하고 쓰되,
  // 주제와 맞을 때만 자연스럽게 활용하라는 배경 지식이다.
  return lines.length ? `운영 형태 참고(배경 지식일 뿐 반드시 본문에 설명할 필요는 없음): ${lines.join(" / ")}` : "";
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

export function normalizeGeneratedMarkdown(summary: string, images: Record<string, string>, siteHost?: string): string {
  return ensureImageSlots(
    ensureHeadingBodies(
      removeInternalLeakage(
        normalizeKoreanSpacing(
          stripPseudoSlots(
            stripPreamble(normalizeImageSlotMarkup(summary))
              .replace(/^```(?:markdown|md)?\s*/i, "")
              .replace(/```\s*$/i, "")
              .replace(/\[(\d+)\]/g, "")
              .replace(/\n{3,}/g, "\n\n")
              .trim()
          )
        ),
        siteHost
      )
    ),
    images
  );
}

// 인접 헤딩 사이 빈 본문 보강. 채워 넣는 문장은 정보량이 0이라 최소 범위에서만 쓴다.
//
// H2 바로 뒤에 H3 가 오는 것(`## 후보별 차이` → `### 학원명`)은 큰 주제 아래 개별 항목을 두는
// 정상 구조이고, 어떤 게이트도 이를 결함으로 보지 않는다(실측: 최근 6편에서 이 문장을 빼도
// thin_sections·h2 관련 이슈 0건). 그런데도 채우고 있어서 모든 글에 제목을 되풀이하는
// 무의미한 문장이 하나씩 실렸다. 이제 같은 깊이의 헤딩이 연달아 나올 때만 채운다
// (`### 학원A` → `### 학원B` 는 실제로 내용이 빠진 것이다).
function ensureHeadingBodies(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  const frame = (heading: string, n: number): string =>
    n % 2 === 0
      ? `${heading}에서 확인할 내용을 아래에 이어서 정리했습니다.`
      : `${heading} 관련 정보는 아래 내용을 참고하세요.`;
  let filled = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] || "";
    out.push(line);
    if (!/^#{2,3}\s+/.test(line.trim())) continue;
    const next = lines.slice(i + 1).find((candidate) => candidate.trim());
    const depth = (value: string) => (value.trim().match(/^#+/) || [""])[0].length;
    if (next && /^#{2,3}\s+/.test(next.trim()) && depth(next) <= depth(line)) {
      const heading = line.trim().replace(/^#{2,3}\s+/, "").replace(/[*_`#]/g, "").trim();
      out.push(heading ? frame(heading, filled++) : "아래에 이어서 관련 내용을 정리했습니다.");
      out.push("");
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// 내부 자료 언어·내부 host·브랜드명이 공개 본문에 남지 않게 하는 줄 단위 필터.
// 리뷰 보충자료 조각만 quality-gate 의 공유 패턴을 쓴다(qa-posts.mjs 와 동일해야 하는 부분).
const INTERNAL_LEAK_RE = new RegExp(
  `(api-dev\\.drivingplus\\.me|get-all-academy|zipcode/search-seo|내부\\s*(?:API|데이터|자료)|검증된 자료|확인된 콘텐츠 재료|작성 범위|소개 가능한 후보 수|본문에 사용할 수 있는 후보|본문에 사용할 수 있는 사진 슬롯|작성자 주의|API 자료|제공된 자료|후기 필드|${REVIEW_SUPPLEMENT_LEAK_PATTERN}|직접 매칭 후보 수|사용 가능한 이미지 슬롯|내부자료ID|DrivingPlus|firebasestorage\\.googleapis\\.com|storage\\.googleapis\\.com)`,
  "i",
);

export function removeInternalLeakage(md: string, siteHost?: string): string {
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
    // 사이트 자기 공개 도메인(정상 내부링크 host)은 누출이 아니므로 검사 전에 제거한다. 내부 API host·브랜드명은 남아 계속 걸린다.
    // A rendered student-review attribution is public article content, not an
    // internal implementation reference. Keep all other DrivingPlus mentions
    // subject to the existing leakage guard.
    const scanned = stripPublicReviewAttribution(siteHost ? line.split(siteHost).join("") : line);
    if (INTERNAL_LEAK_RE.test(scanned)) continue;
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

function buildRepairPrompt(domain: Row, slot: Row, facts: string, designTemplateId: string, markdown: string, issues: string[], archetype: Archetype | undefined, direction: string, forcedTitle?: string | null, options?: GenerationPromptOptions): string {
  const brand = publicBrandName(domain);
  const isT01AcademyComparison = isT01AcademyComparisonPrompt(slot, true, options);
  // buildPrompt 와 동일: T16(local_axis)은 '소개·안내' 글이라 '비교글' 프레이밍을 쓰지 않는다.
  const isAcademyProfile = isT01AcademyComparison && archetype?.id === "local_axis";
  const tableNoun = isAcademyProfile ? "요약표" : "비교표";
  const authoritativeSourceGuide = authoritativeSourceGuideForPrompt(slot, true, options);
  const academyScopeGuide = !isT01AcademyComparison
    ? ""
    : isAcademyProfile
      ? "이 글은 학원을 하나씩 소개·안내하는 글이다. 시험 접수·응시·면허 발급·준비 서류 같은 일반 제도 안내나 외부 공식 절차 링크는 본문·FAQ·체크리스트·CTA에 넣지 않는다. 학원별로 확인된 사실과 선택에 필요한 질문만 남긴다."
      : "이 글은 학원 비교글이다. 시험 접수·응시·면허 발급·준비 서류 같은 일반 제도 안내나 외부 공식 절차 링크는 본문·FAQ·체크리스트·CTA에 넣지 않는다. 학원별로 확인된 사실과 선택에 필요한 질문만 남긴다.";
  const customDesignGuide = designTemplateId === "custom" ? String(domain.custom_design_templates || "").trim() : "";
  const personaHasMobilityConstraint = /(?:출퇴근|통학|직장|학교|생활권|이동s*제약|대중교통|교통)/u.test(String(slot.persona || ""));
  const personaMobilityGuide = personaHasMobilityConstraint
    ? "페르소나의 이동 조건을 확인된 셔틀 운행 지역과 연결해 자연스럽게 쓸 수 있다. 확인된 셔틀 운행 지역·경유지·이용 조건은 그 학원의 사실이므로 그대로 쓴다. 다만 셔틀 자료가 없는 학원의 운행 범위를 추측하거나, 주소만으로 통학 편의·접근성·가까움을 단정하지 않는다."
    : "확인된 셔틀 운행 지역·경유지·이용 조건은 그 학원의 사실이므로 그대로 쓴다. 다만 셔틀 자료가 없는 학원의 운행 범위를 추측하거나, 주소만으로 통학 편의·접근성·가까움을 단정하지 않는다.";
  const candidateRepairGuide = options?.readerFlow
    ? `학원별 설명은 원본 블로그처럼 작은 카드형으로 쓰되, 각 학원 시작은 반드시 '### 학원명' H3 소제목으로 둔다. H3 뒤에는 한두 문장의 자연스러운 소개를 쓰고, 확인된 면허 과정·운영 형태·자체시험·수강생 리뷰 중 실제 차이가 있을 때만 선택 상황과 연결한다. 모든 학원을 같은 과정·확인 문장으로 시작하지 않는다. 실제 지역은 짧은 사실로만 적고 주소를 소개 중심으로 쓰지 않는다. ${personaMobilityGuide}`
    : "학원별 설명은 원본 블로그처럼 작은 카드형으로 쓰되, 각 학원 시작은 반드시 '### 학원명' H3 소제목으로 둔다: '### 학원명' → 위치/생활권 → 추천 대상 → 상담 때 확인할 질문 → 사진 순서.";
  const nonPrimaryRepairGuide = options?.readerFlow
    ? `실제 소재지가 대상 지역과 다른 학원도 별도 그룹이나 H2 섹션으로 나누지 말고, ${tableNoun} 또는 해당 학원 소개에서 실제 지역만 정확히 적는다. 학원 추출용 거리 수치·km·직선거리·도로거리·이동시간은 본문에 쓰지 않는다.`
    : "주소가 주제 지역과 다른 학원은 해당 지역 안의 학원이 아니라 \"인근 학원\"으로만 구분해 설명한다. 학원 추출용 거리 수치·km·직선거리·도로거리·이동시간은 본문에 쓰지 않는다.";
  const repairNaturalToneGuide = options?.readerFlow
    // buildPrompt 와 같은 이유로 브랜드명을 톤 지시에서 뺀다(모델이 모르는 대상은 톤 앵커가 못 된다).
    ? `원문보다 더 자연스럽고 풍성한 블로그 톤으로 작성하되, 면허 과정·운영 형태·실제 수강생 경험은 실제 차이가 있을 때만 보이게 한다. 주소를 ${tableNoun}의 중심이나 장점으로 만들지 않고, 표·기본 정보·체크리스트가 같은 사실을 반복하지 않게 한다. ${personaMobilityGuide}`
    : "원문보다 더 자연스럽고 풍성한 블로그 톤으로 작성하되, 원본 레퍼런스처럼 구체적인 지역 생활권·비용 확인점·사진·내부링크·CTA가 보이게 만든다.";
  return `아래 Markdown 글은 품질 게이트를 통과하지 못했다. 확인된 콘텐츠 재료만 사용해서 같은 주제의 완성형 글로 다시 작성하라.

브랜드: ${brand}
디자인 템플릿: ${designTemplateId}
디자인 작성 지침: ${options?.designGuide ?? designWritingGuide(designTemplateId)}
${customDesignGuide ? `사용자 지정 디자인 메모:\n${customDesignGuide}\n` : ""}지침 우선순위:
- 글 유형/검색 의도/검증된 콘텐츠 재료가 상위 계약이다.
- 디자인 지침은 섹션 배치, 강조 방식, CTA 톤을 정하는 보조 지침이며 글 유형의 필수 정보와 충돌하면 글 유형을 우선한다.
템플릿 필수 구조:
${options?.structureGuide || structureGuideForArchetype(archetype, structureSeed(slot))}
원본 엑셀 기반 템플릿 작성법:
${options?.writingGuide ?? writingGuideForArchetype(archetype, Boolean(slot.region))}
원본 전체 글 패턴 기반 작성법:
${options?.articlePatternGuide ?? originalArticlePatternGuide(slot)}
주 키워드: ${slot.primary_keyword}
지역: ${slot.region || ""}
페르소나: ${slot.persona || ""}
의도: ${slot.intent || ""}
수식어: ${options?.modifierLabels?.join(", ") ?? [slot.modifier_1, slot.modifier_2].filter(Boolean).join(", ")}
공통원칙: ${domain.common_principles || "없음"}
글유형 방향성: ${direction || "없음"}

실패 사유:
${issues.map((issue) => `- ${issue}`).join("\n")}

확인된 콘텐츠 재료:
${facts || "없음"}

재작성 규칙:
- 제목/지역/후보 학원/이미지는 확인된 콘텐츠 재료와 반드시 일치시킨다.
- 소개 가능한 후보가 1곳 이상이면 본문과 표에 실제 후보명 최소 1개를 반드시 넣는다. 후보명이 빠진 일반 가이드 글은 실패다.
- ${candidateRepairGuide}
- ${options?.reviewInstruction || "제공된 수강생 리뷰는 테마로 바꾸거나 지어내지 말고, 제공된 원문 1건만 후보 소개 안에 > “리뷰 원문” — 출처: 운전면허PLUS 실제 수강생 리뷰 형식으로 그대로 포함한다. 작성자·작성일·평점은 쓰거나 만들지 않는다."}
- 좋은 리뷰라도 합격 보장·과장된 효능은 만들지 말고, 리뷰 원문에 없는 장점은 추가하지 않는다.
- 후보 수보다 큰 숫자, 다른 지역 후보, 없는 가격·합격률·셔틀·후기·3일 합격·당일 합격·합격 보장 주장을 만들지 않는다.
- 구체 금액은 수강료 자료가 있을 때만 쓴다. 자료가 없으면 “비용은 상담 때 확인”과 확인 질문으로 처리한다.
${academyScopeGuide ? `- ${academyScopeGuide}` : ""}
- ${nonPrimaryRepairGuide}
${forcedTitle ? `- 첫 줄 H1 제목은 반드시 정확히 "# ${forcedTitle}" 로 쓴다(글자 하나도 바꾸지 말 것). 본문을 이 제목에 맞춘다.` : "- 첫 줄은 '# ' 제목,"} H2 4~6개 중심, 많아도 10개를 넘기지 말고 3,500~5,600자 이내로 쓴다.
- 후보 수와 관계없이 Markdown 표 1개를 반드시 포함한다. 후보가 1곳이면 주소/연락처/과정/상담 확인점을 담은 요약표로 작성한다.
- 체크리스트는 포함한다. ${options?.faqInstruction || "FAQ는 질문형 의도이거나 템플릿 필수 구조에 FAQ가 명시된 경우에만 2~4개로 짧게 둔다."}
- 사용 가능한 이미지 슬롯이 있으면 실제 키만 [IMAGE:academy_1] 형식으로 배치한다. 학원 사진 슬롯([IMAGE:academy_*])은 제공된 것을 하나도 빠뜨리지 말고 해당 학원 카드 안에 1장씩 넣는다(후보가 5곳이면 5장). 그 외 슬롯은 3~4개까지만 쓴다.
- 학원명·가격·셔틀·면허종류·준비물처럼 독자가 스캔해야 하는 핵심어는 Markdown bold를 적당히 사용한다.
- ${/관련 글 후보/.test(facts) ? "관련 글 후보가 있으면 실제 링크만 2~4개 연결한다. 후보가 없으면 링크를 꾸며내지 않는다." : "자사 사이트 내부 글로 연결하는 링크는 넣지 않는다. 재료에 실제로 주어진 외부 URL(공신력 출처·블로그 후기 등)만 링크로 쓴다."}
- [1], [2] 같은 출처번호와 입력 묶음 표현(확인된 콘텐츠 재료, 작성 범위, 소개 가능한 후보 수, API 자료, 후보 수, 참고자료, 내부 API URL 등)은 노출하지 않는다.
- ${authoritativeSourceGuide}
- 이번 입력의 학원 API는 출처가 아니라 내부 데이터다.
- ${repairNaturalToneGuide}
- ai_cliche_expressions 가 사유에 있으면, 표시된 판박이 표현("이번 글에서는", "~알아보겠습니다/살펴보겠습니다", "여러분", "도움이 되셨기를 바랍니다" 등)을 전부 없애고 실제 사람이 쓴 블로그처럼 구체 상황으로 자연스럽게 다시 시작·마무리한다. 같은 뜻의 다른 상투구로 바꾸지 말 것.
- boilerplate_phrase / repeated_sentence 가 사유에 있으면, 표시된 상투 프레임 문장을 그대로 쓰지 말고 이 지역·후보에 맞는 새 문장으로 다시 쓰고, 같은 글 안에서 반복된 동일 문장은 표현을 바꿔 중복을 없앤다(사실 내용은 유지).
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

// 구조 변형 선택 시드 — 학원 샘플링과 동일하게 슬롯 식별자 기반(같은 슬롯=같은 구조=재현성).
// T16 계열 판정 — 빌트인 T16 과 T16 에서 복제한 커스텀 유형(kind=local_axis) 모두 포함.
// 커스텀은 template_id 가 다르므로 아키타입으로도 본다.
function isT16Slot(slot: Row, archetype?: Archetype): boolean {
  return String(slot.template_id || "") === T16_TEMPLATE_ID || archetype?.id === "local_axis";
}

function structureSeed(slot: Row): string {
  return String(slot.slot_id ?? slot.id ?? `${slot.region ?? ""}|${slot.primary_keyword ?? ""}`);
}

/**
 * 프롬프트 '수식어:' 줄에 노출할 라벨. "가까운/근처"는 후보를 직선거리로 뽑는 선택 힌트일 뿐
 * (academy-candidate-selection) 독자용 관점 라벨이 아니라서 뺀다 — 노출하면 근거 없는 근접·접근성
 * 주장을 유도해 T16 거리 게이트(distance_number_claim)와 엇박이 난다. 축 해석(buildT16AxisPlan)은
 * slot.modifier_1 을 직접 읽으므로 이 스트립은 축 선택에 영향이 없다. Legacy Plus·T16 공용.
 */
export function readerFacingModifierLabels(slot: Row): string[] {
  return [slot.modifier_1, slot.modifier_2]
    .filter((label): label is string => Boolean(label && !/^(?:가까운|근처)$/u.test(String(label).trim())));
}

export function buildPrompt(domain: Row, slot: Row, facts: string, designTemplateId: string, archetype: Archetype | undefined, direction: string, hasAcademy: boolean, forcedTitle?: string | null, options?: GenerationPromptOptions): string {
  const brand = publicBrandName(domain);
  const isT01AcademyComparison = isT01AcademyComparisonPrompt(slot, hasAcademy, options);
  // T16(local_axis)은 학원을 하나씩 '소개·안내'하는 글이라 T01 의 '비교글' 프레이밍과 충돌한다
  // (t16-axis-comparison 계약: "우열을 정량 비교하려 애쓰지 말고"). 스코프 제한(도로교통공단 일반
  // 절차·외부 공식 링크 제외)은 T01·T16 이 공유하되, '비교글'이라는 표현만 T16 에서 '소개글'로 바꾼다.
  const isAcademyProfile = isT01AcademyComparison && archetype?.id === "local_axis";
  // 표 지칭: T01 은 후보 우열을 견주는 '비교표', T16 은 각 학원 정보를 모아 보여주는 '요약표'.
  // 같은 '표'를 유형에 맞게 부른다(T16 요약표를 '비교표'라 부르면 정량 비교로 수렴한다).
  const tableNoun = isAcademyProfile ? "요약표" : "비교표";
  const authoritativeSourceGuide = authoritativeSourceGuideForPrompt(slot, hasAcademy, options);
  const academyScopeGuide = !isT01AcademyComparison
    ? ""
    : isAcademyProfile
      ? "이 글은 지역 운전면허학원을 하나씩 소개·안내하는 글이다. 도로교통공단의 시험 접수·응시·면허 발급, 준비 서류 등 일반 제도 안내와 외부 공식 절차 링크는 다루지 않는다. 각 학원의 확인된 사실을 소개하는 데 필요한 내용만 쓴다."
      : "이 글은 지역 운전면허학원 비교글이다. 도로교통공단의 시험 접수·응시·면허 발급, 준비 서류 등 일반 제도 안내와 외부 공식 절차 링크는 다루지 않는다. 제공된 학원별 사실과 그 차이를 비교하는 데 필요한 내용만 쓴다.";
  const missingFactGuide = !isT01AcademyComparison
    ? "가격·셔틀·합격률·후기는 검증된 자료에 있을 때만 단정한다. 없으면 \"상담 때 확인\"으로 처리하되, 무엇을 물어봐야 하는지 구체적인 질문으로 써서 빈말처럼 보이지 않게 한다."
    : isAcademyProfile
      ? "가격·셔틀·합격률·후기는 검증된 자료가 있을 때만 단정한다. 자료가 없는 항목은 본문을 일반 상담 가이드로 채우지 말고, 후보 소개에 꼭 필요한 경우에만 짧은 공통 확인 행동으로 남긴다. 준비 서류·시험 접수·면허 발급 같은 일반 절차는 넣지 않는다."
      : "가격·셔틀·합격률·후기는 검증된 자료가 있을 때만 단정한다. 자료가 없는 항목은 본문을 일반 상담 가이드로 채우지 말고, 후보별 비교에 꼭 필요한 경우에만 짧은 공통 확인 행동으로 남긴다. 준비 서류·시험 접수·면허 발급 같은 일반 절차는 넣지 않는다.";
  const customDesignGuide = designTemplateId === "custom" ? String(domain.custom_design_templates || "").trim() : "";
  const personaHasMobilityConstraint = /(?:출퇴근|통학|직장|학교|생활권|이동\s*제약|대중교통|교통)/u.test(String(slot.persona || ""));
  const personaMobilityGuide = personaHasMobilityConstraint
    ? "페르소나에 명시된 이동 조건을 확인된 셔틀 운행 지역과 연결해 독자가 판단할 수 있게 쓴다. 확인된 셔틀 운행 지역·경유지·이용 조건은 그 학원의 사실이므로 그대로 쓴다. 다만 셔틀 자료가 없는 학원의 운행 범위를 추측하거나, 주소만으로 통학 편의·접근성·가까움을 단정하지 않는다."
    : "확인된 셔틀 운행 지역·경유지·이용 조건은 그 학원의 사실이므로 그대로 쓴다. 다만 셔틀 자료가 없는 학원의 운행 범위를 추측하거나, 주소만으로 통학 편의·접근성·가까움을 단정하지 않는다.";
  const academyNarrativeGuide = options?.readerFlow
    ? [
      "- 이 글의 흐름은 ‘독자 질문 → 학원별 차이 → 객관 정보 → 선택 도움’이다. 도입은 지역에서 면허를 준비할 때 생기는 현실적인 고민을 한두 짧은 문단으로 열고 학원 소개로 자연스럽게 이어 간다. 면허 종류·교육 과정·전문학원 여부는 실제 차이가 있거나 독자의 고민과 맞을 때만 활용하며, 모든 도입의 고정 주제로 삼지 않는다.",
      `- 주소·전화·실제 소재지는 오표현을 막는 보조 사실이다. 주소를 학원 소개의 첫 문장·추천 이유·${tableNoun}의 중심 열로 삼지 않는다. 실제 지역이 다른 학원도 별도 그룹이나 H2 섹션으로 나누지 말고, 해당 학원 소개 또는 ${tableNoun}에 실제 지역명만 짧게 적는다.`,
      `- ${personaMobilityGuide} 거리 수치, 이동시간, 셔틀 가능성을 추측하지 않는다.`,
      "- 학원 소개는 각 학원에서 실제로 차이가 드러나는 면허 과정·운영 형태·자체시험·수강생 리뷰를 필요한 경우에만 활용한다. 각 학원은 반드시 `### 학원명` H3로 시작하고, 한두 문장의 자연스러운 소개 뒤에 제공된 주소·전화·수강료·운영 과정 중 확인된 항목을 짧은 기본 정보 불릿으로 한 번만 정리한다(운영 형태는 학원마다 다를 때만 불릿에 넣고, 모두 같으면 넣지 않는다). 학원마다 첫 문장과 문단 순서를 기계적으로 같게 맞추지 않는다. 주소는 기본 정보이지 추천 이유가 아니다. 정보가 부족하면 내용을 부풀리지 말고 공통 체크리스트로 한 번만 확인 행동을 안내한다.",
    ].join("\n")
    : [
      "- 딱딱한 데이터 나열이 아니라 사람이 쓴 블로그처럼 자연스럽게 시작한다. 예: 지역 생활권, 면허 준비 상황, 비용/동선 고민을 먼저 짚고 학원으로 연결한다.",
      "- 원본처럼 \"왜 이 학원이 이 지역/상황에 맞는지\"를 구체화한다. 주소만 쓰지 말고 생활권, 셔틀 확인 포인트, 면허 종류, 상담 질문, 사진을 같이 엮는다.",
      "- 학원 소개는 원본 블로그의 카드형 리듬을 따른다. 학원마다 반드시 '### 학원명' H3 소제목을 먼저 쓰고, 위치/동선, 추천 대상, 상담 질문, 사진을 짧은 문단과 불릿으로 섞어 보여준다.",
    ].join("\n");
  const academyDetailGuide = options?.readerFlow
    ? "- 각 학원은 반드시 `### 학원명` H3로 시작한다. H3 뒤에는 한두 문장의 자연스러운 소개를 쓰고, 확인된 면허 과정·운영 형태·자체시험 여부·수강생 리뷰는 실제 차이가 있거나 독자의 선택에 도움이 될 때만 쓴다. 이어서 제공된 정보만 사용해 `- **주소:**`, `- **전화:**`, `- **수강료:**`, `- **운영 과정:**`, `- **운영 형태:**` 중 2~5개의 짧은 기본 정보 불릿을 둔다. 값이 없는 항목은 만들지 않는다. **운영 형태는 학원마다 다를 때만 불릿에 넣고, 모든 학원이 같은 운영 형태면 카드 불릿에 넣지 않는다(공통 사실이라 글에서 한 번만 밝힌다).** 실제 지역은 주소 불릿 또는 짧은 사실로만 적고, 주소·전화는 추천 이유나 " + tableNoun + "의 중심 열로 쓰지 않는다."
    : "- 학원별 설명에는 가능한 경우 학원명, 주소, 전화, 운영 과정/유형, 추천 대상, 상담 시 확인할 점을 포함한다. 전화번호는 자료에 있는 번호만 그대로 쓰고 다른 번호를 만들지 않는다.";
  const academyPrinciples = options?.academyPrinciples ?? DRIVING_ACADEMY_PRINCIPLES;
  // 내부(자사) 글 링크: facts 에 '관련 글 후보'가 실제로 주어졌을 때만 유도한다. 현재 후보 제공이
  // 꺼져 있어(relatedPostsForSlot→[]) 항상 '금지' 분기로 떨어진다 — 죽은 내부 링크로 신뢰도가
  // 깎이는 것을 막기 위함. 외부(공신력 출처·블로그 후기)처럼 재료에 주어진 URL 링크는 계속 허용한다.
  const hasRelatedPosts = /관련 글 후보/.test(facts);
  const internalLinkGuide = hasRelatedPosts
    ? "- \"확인된 콘텐츠 재료\"에 '관련 글 후보'가 있으면, 그 중 최소 1개(가능하면 2~4개)를 반드시 본문에 [앵커 텍스트](URL) 형태 Markdown 링크로 자연스럽게 연결한다. 앵커는 문맥에 맞게 쓰고, URL은 재료에 있는 것만 그대로 쓴다. 관련 글 후보가 없으면 내부링크를 만들지 않는다(URL을 지어내지 않는다)."
    : "- 자사 사이트의 다른 글로 연결하는 내부 링크는 넣지 않는다. 링크는 확인된 콘텐츠 재료에 실제로 주어진 외부 URL(공신력 출처·블로그 후기 등)만 그대로 쓴다.";
  // 역할 문장에는 브랜드명을 넣지 않는다. 모델은 그 브랜드의 기존 글을 모르므로 "○○ 블로그처럼"은
  // 실질 지시가 없는 빈 문장이 되고, 아래 「브랜드:」 선언과 CTA 지침이 이미 이름을 전달한다.
  return `너는 한국어 SEO 블로그 에디터다. 아래 슬롯과 검증된 자료만 사용해, 회사 콘텐츠 상세 페이지와 HTML 다운로드에서 바로 읽히는 완성형 Markdown 글을 작성하라.

브랜드: ${brand}
업종: ${domain.vertical || "driving"}
디자인 템플릿: ${designTemplateId}
디자인 작성 지침: ${options?.designGuide ?? designWritingGuide(designTemplateId)}
${customDesignGuide ? `사용자 지정 디자인 메모:\n${customDesignGuide}\n` : ""}지침 우선순위:
- 글 유형/검색 의도/검증된 콘텐츠 재료가 상위 계약이다.
- 디자인 지침은 섹션 배치, 강조 방식, CTA 톤을 정하는 보조 지침이며 글 유형의 필수 정보와 충돌하면 글 유형을 우선한다.
템플릿 필수 구조:
${options?.structureGuide || structureGuideForArchetype(archetype, structureSeed(slot))}
원본 엑셀 기반 템플릿 작성법:
${options?.writingGuide ?? writingGuideForArchetype(archetype, Boolean(slot.region))}
템플릿: ${slot.template_id}
원본 전체 글 패턴 기반 작성법:
${options?.articlePatternGuide ?? originalArticlePatternGuide(slot)}
주 키워드: ${slot.primary_keyword}
지역: ${slot.region || ""}
페르소나: ${slot.persona || ""}
의도: ${slot.intent || ""}
수식어: ${options?.modifierLabels?.join(", ") ?? [slot.modifier_1, slot.modifier_2].filter(Boolean).join(", ")}
공통원칙: ${domain.common_principles || "없음"}
글유형 방향성: ${direction || "없음"}

확인된 콘텐츠 재료:
${facts || "없음"}

절대 원칙:
${DRIVING_ABSOLUTE_PRINCIPLES}${hasAcademy ? `\n${academyPrinciples}` : ""}

${isT01AcademyComparison ? (isAcademyProfile ? "학원 소개 범위:" : "비교글 범위:") : "공신력 출처(EEAT, 선택):"}
${authoritativeSourceGuide}

원본 레퍼런스 품질 기준:
- 원본 엑셀의 평균 형태에 맞춘다: 4,000~5,200자대, H2는 4~6개 중심, 표 1개 이상, 리스트 1개 이상, 이미지 3~4개 권장(단 학원 사진 슬롯은 아래 '카드별 1장' 규칙을 따르므로 이 권장 수치에 묶이지 않는다)${hasRelatedPosts ? ", 관련 내부링크 2~4개 권장" : ""}, FAQ는 필수 아님.
${academyNarrativeGuide}
${academyScopeGuide ? `- ${academyScopeGuide}` : ""}
- ${options?.readerFlow ? "후보가 적거나 비교 정보가 희소하면 주소·인근 여부를 글의 주제로 키우지 말고, 실제 후보명과 짧은 객관 정보·공통 확인 순서를 중심으로 쓴다." : "후보가 적은 지역은 억지로 BEST 숫자를 키우지 말고 ‘직접 확인 가능한 후보와 인근 선택지’처럼 정직하게 풀되, 실제 후보명이 보이게 쓴다."}
- ${missingFactGuide}
- 수강료 자료가 없으면 60만원대, 70만원대, 709,600원 같은 구체 금액을 추정하지 않는다. 비용 문단은 “상담 시 확인할 항목” 중심으로 쓴다.
${internalLinkGuide}
- ${options?.reviewInstruction || "제공된 수강생 리뷰는 슬롯별로 선택된 실제 수강생 원문 1건이다. 리뷰가 있는 학원은 이 1건만 후보 설명 안에 Markdown 인용(> “원문” — 출처: 운전면허PLUS 실제 수강생 리뷰)으로 그대로 노출한다. 테마 요약·재서술·출처 삭제는 금지하며, 작성자·작성일·평점과 제공되지 않은 후기 문구는 쓰거나 만들지 않는다. 리뷰가 없으면 실제 후기처럼 꾸며 쓰지 말고 상담 확인 팁으로 대체한다."}
- 긍정 블로그 리뷰글 보충자료가 있으면 공식 근거처럼 단정하지 말고 “블로그 후기 흐름에서는 이런 점을 확인할 수 있다” 정도로 자연스럽게 녹인다. 링크를 넣을 때는 제공된 실제 URL만 사용한다.

필수 출력 구조:
${forcedTitle ? `- 첫 줄 H1 제목은 반드시 정확히 "# ${forcedTitle}" 로 쓴다(글자 하나도 바꾸지 말 것). 본문 도입·소제목·후보 수 서술을 이 제목에 맞춰 일관되게 쓴다.` : "- 첫 줄은 '# ' H1 제목. 제목은 주 키워드/지역/직접 매칭 후보 수와 모순되면 안 된다."}
- H2 섹션은 4~6개를 기본으로 사용한다. 너무 잘게 쪼개 원본과 다르게 보이지 않게 하고, 많아도 10개를 넘기지 않는다.
- 권장 흐름은 템플릿 필수 구조를 우선 따른다. 공통적으로 도입 → 기준 → 후보/절차 → ${isAcademyProfile ? "요약" : "비교/요약"} → 체크리스트 → 상담/예약 CTA가 자연스럽게 이어져야 한다.
- 제공된 학원 수와 관계없이 Markdown 표 1개를 반드시 포함한다. 후보가 1곳이면 주소/연락처/과정/추천 대상/상담 확인점을 담은 요약표로 작성한다.
- ${isAcademyProfile ? "표는 정상 Markdown 표로 작성한다. 예: | 학원 | 항목 A | 항목 B | 형태로 각 학원을 행으로 두는 요약표(우열을 매기는 비교표가 아니다). 실제 후보가 있으면 표 안에 실제 후보명을 넣는다." : "표는 정상 Markdown 표로 작성한다. 예: | 비교 항목 | 후보 A | 후보 B | 형태. 실제 후보가 있으면 표 안에도 실제 후보명을 넣는다."}
${academyDetailGuide}
- 본문에는 제공된 이미지 슬롯만 사용한다. 학원/시험장 사진 슬롯([IMAGE:academy_*])은 각각 그 학원(또는 시험장)을 소개하는 카드 안에 배치한다(카드별 1장). **제공된 학원 사진 슬롯은 하나도 남기지 않고 모두 쓴다** — 후보가 5곳이고 슬롯이 5개면 5장을 모두 배치하며, 위 '이미지 3~4개 권장'을 이유로 마지막 후보의 사진을 빠뜨리지 않는다. 특정 대상을 소개하지 않는 일반 설명 문단이나 필기·앱처럼 학원과 무관한 글에는 넣지 않는다.
- 생성 이미지 슬롯([IMAGE:generated_*])이 제공되면 서로 다른 섹션에 하나씩 배치한다. 학원 사진만 제공되면 생성 슬롯 없이 학원 사진만 배치한다.
- 허용된 이미지 슬롯은 자료에 제시된 키만 사용한다. 없는 키나 임의 플레이스홀더는 만들지 않는다.
- [IMAGE_SLOT: ...], [TABLE_SLOT: ...], [CTA_SLOT: ...], [QUOTE_SLOT: ...] 같은 임의 플레이스홀더는 절대 쓰지 말 것.
- 체크리스트 섹션은 ✅ 불릿 목록으로 작성한다.
- ${options?.faqInstruction || "FAQ는 기본적으로 선택 사항이다. 다만 템플릿 필수 구조에 FAQ가 명시되면 비교 글에서도 비용·셔틀·수강 일정처럼 제공된 facts 또는 상담 확인 범위 안의 질문 2~4개를 포함한다."}
- 마지막 H2 섹션은 ${brand}에서 비교·상담·예약으로 이어지는 자연스러운 CTA로 마무리하고, 브랜드명을 3~7회 정도 자연스럽게 언급한다.

문체/분량:
- 4,000~5,200자를 우선 목표로 하고, 최소 3,500자 이상 5,600자 이내로 작성한다. 원본처럼 구체적인 설명과 표/이미지/링크가 있는 풍성한 글을 목표로 한다.
- 문단 하나는 2~3문장 안에서 끊고, 가능하면 300자 안팎으로 유지한다. 긴 설명 뒤에는 표/불릿/짧은 확인 질문을 넣어 읽기 좋게 만든다.
- 제목만 이어지는 구조는 피한다. 각 H2 아래에는 독자가 바로 이해할 수 있는 짧은 설명, 표, 리스트, 이미지 중 하나가 반드시 따라와야 한다.
- 독자가 바로 도움받을 수 있게 구체적으로 쓰되, 확인되지 않은 장점은 "상담 때 확인"으로 표현한다.
- SEO 키워드는 참고용으로만 사용하고 부자연스럽게 반복하지 말 것.
- 주 키워드와 맞지 않는 내용으로 글 방향을 틀지 말 것.
${commonToneGuide()}
- 도입·요약·후기 언급은 매번 다른 문장으로 쓰고, 다른 글에서 쓸 법한 상투적인 프레임 문장("확인된 후보 정보와 상담 전 체크포인트를 기준으로…", "후기 요약에서는 친절한 상담과 꼼꼼한 설명이 확인됩니다", "정리하면 선택 기준은 단순합니다" 등)을 그대로 재사용하지 말 것. 같은 글 안에서 동일한 문장을 반복하지 말 것(사실도 매번 다른 표현으로 쓴다).
- 출력은 Markdown 본문만 제공하고 설명/주석은 쓰지 말 것.
- 마지막에 참고자료/출처 목록을 붙이지 말 것.${isT01AcademyComparison ? (isAcademyProfile ? " 학원 소개글에는 외부 공식 절차 링크를 넣지 않는다." : " 학원 비교글에는 외부 공식 절차 링크를 넣지 않는다.") : " 공신력 출처는 위 '공신력 출처' 지침대로 본문 문장 안에 인라인 링크로만 인용한다."}`;
}

/**
 * 전 글유형 공통 문체 지침. `SEO_PROMPT_STYLE=formal` 로 즉시 되돌릴 수 있다
 * (프로세스 시작 시점의 env 를 읽으므로 되돌리려면 API 를 재시작해야 한다).
 *
 * 기존 지침은 금지 목록만 길게 나열했고 거기에 "여러분"이 들어 있었다. 그런데 그건 AI 상투구가
 * 아니라 2인칭 호칭이다. 품질 게이트에서는 반복 금지로 완화했는데 프롬프트가 계속 금지하고
 * 있어서, 모델은 독자에게 말을 거는 표현을 통째로 피했다(실측: 표본 4건에서 질문형 0·2인칭 0).
 * 금지는 실제 상투구만 남기고, 어떤 문체를 쓰라는 지시를 함께 준다.
 */
function commonToneGuide(): string {
  const banned = '- AI가 쓴 티가 나는 판박이 표현을 쓰지 말 것. 금지 예: "이번 글에서는/이 글에서는", "~에 대해 알아보겠습니다/살펴보겠습니다/정리해보겠습니다", "~살펴보았습니다", "도움이 되셨기를 바랍니다/참고하시기 바랍니다", "이번 포스팅/본 포스팅".';
  if (String(process.env.SEO_PROMPT_STYLE || "").trim() === "formal") {
    return `${banned.replace('"~살펴보았습니다"', '"~살펴보았습니다", "여러분"')} 대신 실제 사람이 쓴 블로그처럼 지역 상황·고민·구체 정보로 바로 들어가고 자연스럽게 마무리한다.`;
  }
  return [
    banned,
    '- 문체의 격식 수준(종결어미·이모지·감탄사의 허용 폭)은 글유형 방향성을 우선한다. 방향성이 "대화체/친근한 블로그"를 지시하면 아래 대화체 범위를 넓게 쓰고, "전문가/설명 톤"을 지시하면 아래 전문가 범위로 절제한다. 방향성에 톤 지시가 없으면 기본은 대화체다.',
    '- 보고서가 아니라 독자에게 말을 거는 블로그 문체로 쓴다. 대화체 톤에서는 독자를 "여러분"으로 부르거나 "~하시죠?", "~해 보세요"처럼 편하게 말을 걸어도 되고, 전문가 톤에서는 "~하시는 것이 좋습니다"처럼 정중하게 말을 건다(어느 쪽이든 "여러분"을 문단마다 반복하지 않는다). 독자의 실제 의문을 대신하는 질문형 문장은 섹션마다 한 번까지 쓸 수 있다.',
    '- 사실을 나열한 뒤에는 그것이 독자에게 어떤 의미인지 한 문장으로 이어 준다. 종결은 "-습니다"를 기본으로 "-해요"·"-인데요"·"-거든요"를 자연스럽게 섞고, 대화체 톤에서는 "-거예요"·"-네요"·"-답니다"까지 넓혀 쓸 수 있다(전문가 톤에서는 "-습니다" 위주로 절제한다). 같은 종결을 세 문장 이상 연속으로 쓰지 않는다. 다만 반말·유행어로 글 전체를 가볍게 만들지는 않는다.',
    '- 이모지는 대화체 톤에서는 소제목이나 핵심 문장에 내용과 어울리는 것을 실제로 곁들여 생동감을 준다(예: 🚗·📍·💡 처럼 맥락에 맞는 것 — 장식처럼 남발하지는 않는다). 전문가 톤에서는 체크리스트 ✅처럼 같은 계열 항목을 통일하는 용도 외에는 쓰지 않고, 감정 표현을 장식처럼 남발하지 않는다. 어느 톤이든 한 목록·섹션 안에서 서로 다른 이모지를 섞지 않는다(계열 통일).',
    '- 대화체 톤에서는 활기차고 생동감 있게 쓴다. 도입을 밝게 열고, 느낌표와 가벼운 감탄("자, 그럼!", "이건 꼭 확인!")을 실제로 쓰며, 마무리에서 독자를 따뜻하게 응원한다("좋은 학원 만나 안전운전하시길 바랄게요!"). 브랜드가 옆에서 이끌어 주듯 친근하고 설득력 있게 권유한다 — 광고처럼 밝고 적극적인 카피도 좋다. (활기는 확인된 사실 위에서만 — 없는 장점·합격 보장·최저가 같은 미검증 단정은 여전히 쓰지 않는다.) 전문가 톤에서는 감탄·응원 없이 차분하게 맺는다.',
    '- 자연스러움: 분류 라벨(페르소나·축 값 등)을 문장에 그대로 옮기지 말고 상황으로 풀어 쓰고, 한 문장에 여러 요소를 욱여넣지 말고 나눈다. 지침의 예시 문구를 글자 그대로 베끼지 말고 같은 틀의 문장을 되풀이하지 않으며, 소리 내어 읽어 걸리는 문장이 없게 다듬는다.',
    '- 사실의 "의미"를 이을 때는 구체 항목을 이름으로 댄다. "아쉬운 항목이 있어요", "X는 되지만 Y는 확인하세요"처럼 무엇인지 없는 두루뭉술한 조언·양보형 필러는 쓰지 말고, "이렇게 물어보세요"라고 하면 실제 질문을 바로 적는다.',
    '- 지역 상황·고민·구체 정보로 바로 들어가고 자연스럽게 마무리한다.',
  ].join("\n");
}

function isT01AcademyComparisonPrompt(slot: Row, hasAcademy: boolean, options?: GenerationPromptOptions): boolean {
  return hasAcademy && (Boolean(options?.t01Comparison) || String(slot.template_id || "").trim() === "T01");
}

function authoritativeSourceGuideForPrompt(slot: Row, hasAcademy: boolean, options?: GenerationPromptOptions): string {
  return isT01AcademyComparisonPrompt(slot, hasAcademy, options)
    ? "- 이 글의 학원 내용과 직접 관련 없는 외부 공식 제도·절차 링크는 사용하지 않는다."
    : DRIVING_AUTHORITATIVE_SOURCES_GUIDE;
}

function t01ComparisonScopeIssues(markdown: string, isT01Comparison: boolean): string[] {
  if (!isT01Comparison) return [];
  const text = String(markdown || "");
  const issues: string[] = [];
  if (/(?:safedriving\.or\.kr|도로교통공단\s*안전운전\s*통합민원)/iu.test(text)) {
    issues.push("t01_comparison_out_of_scope_official_procedure_link");
  }
  if (/(?:시험\s*(?:접수|응시)|면허\s*발급|준비\s*서류)/u.test(text)) {
    issues.push("t01_comparison_out_of_scope_general_procedure");
  }
  return issues;
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
  const file = resolve(PROJECT_DIR, "data/content_research/summaries/summary_all_article_patterns.json");
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

// 원본 21,275개 글에서 뽑은 제목/헤딩 패턴에는 '100% 합격 / 단기·빠른·초단기 합격 / N일 최단기 취득 /
// 합격 보장' 같은 위험 문구가 26%가량 섞여 있다. 런타임 위험 게이트(hasRiskyDurationClaim)는 '3일 만에',
// '합격 보장' 정도만 잡고 '100%·초단기·빠른/단기 합격·N일 최단기 취득'은 놓친다. 그래서 프롬프트에 패턴을
// 주입하기 '전에' 여기서 먼저 걸러 LLM 이 위험 제목을 흉내내지 않게 한다(예방). 런타임 게이트보다 넓게 잡는다.
const RISKY_ARTICLE_PATTERN_RE = /\d+\s*%|백\s*[%퍼]|무조건|보장|당일\s*합격|하루\s*만|\d+\s*일\s*(?:만|컷|완성|최단|단기|취득|합격)|최단기|초단기|속성|단기\s*합격|빠(?:른|르게)\s*합격|한\s*번에\s*합격/u;
export function isRiskyArticlePattern(pattern: ArticlePattern): boolean {
  return RISKY_ARTICLE_PATTERN_RE.test(`${pattern?.pattern || ""} ${pattern?.example_title || ""}`);
}

function selectPatterns(patterns: ArticlePattern[] | undefined, articleType: string, limit: number): ArticlePattern[] {
  const rows = (Array.isArray(patterns) ? patterns : []).filter((row) => row.pattern && !isRiskyArticlePattern(row));
  const exact = rows.filter((row) => row.article_type === articleType);
  return (exact.length ? exact : rows).slice(0, limit);
}

function formatMetric(value: any, fallback: string): string {
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : fallback;
}


function extractTitle(md: string, fallback: string) {
  return cleanGeneratedTitle(md.split(/\r?\n/).map((l) => l.trim()).find((l) => l.startsWith("# "))?.slice(2).trim() || fallback);
}

// 제목 규칙 해석: 실제 후보 수로 티어 매칭 + 플레이스홀더 치환. 규칙 없으면 title=null(=LLM 이 H1 결정).
// skip=true 는 후보 수가 min_generate 미만이라 생성하지 않음을 뜻한다(부족 지역 차단).
export function resolveTitleFromRule(rule: TitleRule | undefined, ctx: TitleContext): { title: string | null; skip: boolean } {
  if (!rule) return { title: null, skip: false };
  if (ctx.count < (rule.min_generate ?? 0)) return { title: null, skip: true };
  const tier = [...rule.tiers].sort((a, b) => b.min_count - a.min_count).find((t) => ctx.count >= t.min_count);
  const template = tier?.template ?? rule.fallback;
  if (!template) return { title: null, skip: false };
  const title = substituteTitlePlaceholders(template, ctx);
  return { title: title || null, skip: false };
}
type TitleContext = { region: string; count: number; keyword: string; academyName: string; subtitle?: string };
// 제목 플레이스홀더 치환(규칙·수동 오버라이드 공용). {개수} = 실제 후보 수(직접+인근+보장 선정분).
export function substituteTitlePlaceholders(template: string, ctx: TitleContext): string {
  return template
    .replace(/\{지역\}/g, ctx.region)
    .replace(/\{개수\}/g, String(ctx.count))
    .replace(/\{키워드\}/g, ctx.keyword)
    .replace(/\{학원명\}/g, ctx.academyName)
    // {부제}는 T16 축 계획이 채운다. 값이 없으면 앞의 구분 기호("! ")까지 함께 지워 제목이 깨지지 않게 한다.
    .replace(/\s*[!·]?\s*\{부제\}/g, ctx.subtitle ? `! ${ctx.subtitle}` : "")
    .replace(/\s+/g, " ").trim();
}
// 확정 제목 우선순위: 슬롯 수동 제목 > 규칙 제목 > null(=LLM H1). 수동 제목도 생성 시점 플레이스홀더 치환.
// 스킵(min_generate)은 규칙이 결정하며 수동 제목이 무력화하지 않는다(후보 부족 방어 유지).
export function effectiveGenerationTitle(manualRaw: string | null | undefined, ruleTitle: string | null, ctx: TitleContext): string | null {
  const manual = manualRaw != null && String(manualRaw).trim() ? substituteTitlePlaceholders(String(manualRaw), ctx) : null;
  return manual || ruleTitle;
}
export function rewriteH1Title(md: string, title: string): string {
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
