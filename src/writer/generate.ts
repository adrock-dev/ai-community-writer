import { createArticle } from "../articles/store.ts";
import { findChannel, findSection } from "../channels.ts";
import type { AppConfig } from "../config.ts";
import type { Database } from "../db/database.ts";
import { loadGuideRules, publicGuideText, renderGuideRules } from "../guides.ts";
import { type ImageGenerator, pickImageStyle } from "../images/generator.ts";
import { scenesFor } from "../images/scenes.ts";
import { imageStyleFor, imageStyleSettings } from "../images/style.ts";
import type { LlmResult } from "../llm/client.ts";
import { factCheckIssues, factCheckPrompt, parseFactCheck } from "../quality/factcheck.ts";
import { qualityIssues } from "../quality/gate.ts";
import {
  avoidList,
  findSimilar,
  fingerprint,
  sameTopicArticles,
  saveFingerprint,
  similarityIssues,
} from "../similarity/fingerprint.ts";
import { getTopic, setTopicProgress, type Topic } from "../topics/store.ts";
import { buildFacts, type Facts, type ImageCandidate } from "./facts.ts";
import { type DraftArticle, parseDraft } from "./output.ts";
import { composePrompt, repairPrompt } from "./prompt.ts";

// 글 1편 생성:
//   근거 자료(+실제 사진) → 사진이 모자라면 삽화 생성 → 프롬프트 → LLM
//   → 품질 게이트·유사도 → 통과하면 사실 검증(LLM) → 문제가 있으면 재작성(최대 3회) → 저장
// 결과는 사람 검수를 기다린다. 문제가 끝까지 남으면 status=draft와 문제 목록을 함께 저장한다.

export interface LlmLike {
  generate(prompt: string, opts?: { timeoutSec?: number }): Promise<LlmResult>;
}

export interface GenerateDeps {
  db: Database;
  config: AppConfig;
  llm: LlmLike;
  /** 실제 사진이 모자랄 때 삽화를 만든다. 없으면 만들지 않는다. */
  images?: ImageGenerator;
  /** 사실 검증 단계 (기본 켬) */
  factCheck?: boolean;
  /** 테스트용: 근거 자료를 직접 준다 */
  facts?: Facts;
  now?: Date;
  /** 링크를 넣을 글인지 정하는 난수(0~1). 테스트에서 고정한다. */
  random?: () => number;
  log?: (message: string) => void;
}

export interface GenerateResult {
  articleId: number;
  status: "review" | "draft";
  attempts: number;
  issues: string[];
}

/** 첫 작성 + 재작성 최대 횟수 */
export const MAX_ATTEMPTS = 3;

/** 생성 삽화의 URL. 로컬 서버가 /images/로 제공하고, 내보낼 때 파일을 함께 챙긴다. */
export const generatedImageUrl = (file: string) => `/images/${file}`;

async function prepareImages(
  deps: GenerateDeps,
  topic: Topic,
  photos: ImageCandidate[],
  min: number,
  warnings: string[],
): Promise<ImageCandidate[]> {
  const images = [...photos];
  // 섹션이 제한된 사진(드라이빙존 매장 사진 등)은 안내 섹션에만 들어가므로 최소 장수에 세지 않는다.
  const need = min - images.filter((i) => !i.sectionMustMention).length;
  if (need <= 0 || !deps.images) return images;
  const stamp = (deps.now ?? new Date()).toISOString().replace(/\D/g, "").slice(0, 14);
  // 화풍은 채널 설정(화면 저장 값 → config.json)을 따르고, 한 글 안의 삽화는 화풍을 맞춘다
  const style = pickImageStyle(
    imageStyleFor(imageStyleSettings(deps.db, deps.config), topic.channelId),
    deps.random ?? Math.random,
  );
  for (const [i, scene] of scenesFor(topic.articleType, need).entries()) {
    try {
      deps.log?.(`  삽화 생성 ${i + 1}/${need} (${style}): ${scene}`);
      const file = await deps.images.generate(scene, `t${topic.id}-${stamp}-${i + 1}`, style);
      images.push({
        id: `img${images.length + 1}`,
        url: generatedImageUrl(file),
        kind: "generated",
        subject: scene,
      });
    } catch (error) {
      warnings.push((error as Error).message);
    }
  }
  return images;
}

/** 본문의 이미지 번호(img1)를 실제 주소로 바꾸고, 쓰인 이미지 목록을 돌려준다. */
export function resolveImages(
  body: string,
  images: ImageCandidate[],
): { body: string; used: (ImageCandidate & { alt: string })[] } {
  const used: (ImageCandidate & { alt: string })[] = [];
  const out = body.replace(/!\[([^\]]*)\]\((img\d+)\)/g, (m, alt: string, id: string) => {
    const image = images.find((i) => i.id === id);
    if (!image) return m;
    used.push({ ...image, alt: alt.trim() });
    return `![${alt}](${image.url})`;
  });
  return { body: out, used };
}

export async function generateArticle(
  deps: GenerateDeps,
  topicId: number,
): Promise<GenerateResult> {
  const { db, config } = deps;
  const log = deps.log ?? (() => {});
  const stored = getTopic(db, topicId);
  if (!stored) throw new Error(`주제 #${topicId}가 없습니다`);
  const channel = findChannel(stored.channelId);
  const section = findSection(stored.channelId, stored.sectionCode);
  if (!channel || !section) throw new Error(`주제 #${topicId}의 채널·섹션 정의가 없습니다`);
  // 지역 글은 regional 채널만 쓴다. 예전에 만들어진 지역 주제가 남아 있어도 전국 글로 쓴다.
  const topic: Topic = channel.regional ? stored : { ...stored, region: "" };

  setTopicProgress(db, topicId, "queued");
  try {
    const guides = loadGuideRules(db, channel.id);
    const facts = deps.facts ?? (await buildFacts(db, config.sources, topic, channel));
    const warnings = [...facts.warnings];
    const images = await prepareImages(
      deps,
      topic,
      facts.images,
      channel.quality.minImages,
      warnings,
    );
    // 같은 주제로 다른 채널에 쓴 글을 먼저, 그다음 같은 유형의 최근 글을 피한다.
    const avoid = [
      ...sameTopicArticles(db, topic.topicKey, channel.id),
      ...avoidList(db, channel.id, topic.articleType),
    ].filter((a, i, all) => all.findIndex((b) => b.title === a.title) === i);
    // 모든 글에 같은 링크가 들어가지 않게 글마다 무작위로 링크 허용 여부를 정한다(재작성 중에는 유지).
    const links =
      channel.linkTargets?.length && (deps.random ?? Math.random)() < config.writer.linkChance
        ? channel.linkTargets
        : [];
    const composed = composePrompt({
      topic,
      channel,
      section,
      guides,
      facts,
      avoid,
      images,
      links,
      today: deps.now ?? new Date(),
    });
    const guideText = renderGuideRules(guides);
    const corpus = `${facts.text}\n${guides.map((g) => g.text).join("\n")}`;

    let prompt = composed.prompt;
    let issues: string[] = [];
    let last: { output: string; result: LlmResult } | undefined;
    let draft: DraftArticle | undefined;
    let similar: ReturnType<typeof findSimilar> = [];
    const history: {
      attempt: number;
      provider: string;
      durationMs: number;
      issues: string[];
      factChecked: boolean;
    }[] = [];

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      log(`주제 #${topicId} "${topic.primaryKeyword}" ${attempt}차 작성 (${channel.id})`);
      const result = await deps.llm.generate(prompt);
      draft = parseDraft(result.text);
      let factChecked = false;
      if (!draft) {
        issues = [
          "출력 형식이 맞지 않습니다. <<<TITLE>>> … <<<BODY>>> 구분자 형식을 그대로 지키세요",
        ];
      } else {
        similar = findSimilar(db, {
          title: draft.title,
          channelId: channel.id,
          articleType: topic.articleType,
          fp: fingerprint(draft.body),
        });
        issues = [
          ...qualityIssues(draft, {
            channel,
            primaryKeyword: topic.primaryKeyword,
            articleType: topic.articleType,
            corpus,
            publicFees: publicGuideText(guides),
            candidates: facts.candidates,
            imageIds: images.map((i) => i.id),
            allowedLinks: links.map((l) => l.url),
            restrictedImages: images.flatMap((i) =>
              i.sectionMustMention ? [{ id: i.id, mustMention: i.sectionMustMention }] : [],
            ),
          }),
          ...similarityIssues(similar),
        ];
        // 기계 검사를 통과한 원고만 사실 검증한다 (LLM 호출을 아끼기 위해)
        if (!issues.length && deps.factCheck !== false) {
          log("  사실 검증");
          const check = await deps.llm.generate(
            factCheckPrompt(facts.text, guideText, draft, composed.channelBrief),
          );
          const claims = parseFactCheck(check.text);
          factChecked = true;
          if (claims === undefined) warnings.push("사실 검증 결과를 읽지 못했습니다");
          else issues = factCheckIssues(claims);
        }
      }
      history.push({
        attempt,
        provider: result.provider,
        durationMs: result.durationMs,
        issues,
        factChecked,
      });
      last = { output: result.text, result };
      if (!issues.length) break;
      log(`  문제 ${issues.length}건: ${issues.join(" | ")}`);
      prompt = repairPrompt(composed.prompt, result.text, issues);
    }

    if (!draft || !last) {
      throw new Error(`출력 형식 오류가 ${MAX_ATTEMPTS}번 반복됐습니다`);
    }
    // 이미지가 모자라면(생성 실패 등) 고쳐 쓸 수 없는 문제로 남겨 사람이 검수 때 채운다
    if (images.length < channel.quality.minImages) {
      issues.push(
        `사용할 수 있는 이미지가 ${images.length}장뿐입니다. 검수할 때 이미지를 ${channel.quality.minImages}장 이상으로 채우세요`,
      );
    }
    const resolved = resolveImages(draft.body, images);
    const status = issues.length ? "draft" : "review";
    const articleId = createArticle(db, {
      topicId,
      channelId: channel.id,
      sectionCode: section.code,
      articleType: topic.articleType,
      region: topic.region,
      title: draft.title,
      summary: draft.summary,
      body: resolved.body,
      format: channel.format,
      keywords: draft.keywords,
      status,
      qualityIssues: issues,
      similarArticles: similar,
      facts: facts.text,
      images: resolved.used,
      generation: {
        promptFiles: composed.files,
        attempts: history,
        factsAsOf: facts.asOf,
        warnings,
        guideRuleIds: guides.map((g) => g.id),
        imageCandidates: images,
        links: links.map((l) => l.url),
      },
      provider: last.result.provider,
      model: last.result.model,
    });
    saveFingerprint(db, articleId, fingerprint(resolved.body));
    setTopicProgress(db, topicId, "written");
    log(
      `주제 #${topicId} → 글 #${articleId} (${status === "review" ? "검수 대기" : `문제 ${issues.length}건 남음`})`,
    );
    return { articleId, status, attempts: history.length, issues };
  } catch (error) {
    // LLM 한도 대기(보류)는 작업이 다시 돌 때 이어서 쓰므로 queued를 유지한다.
    if ((error as Error).name !== "LlmUnavailableError") setTopicProgress(db, topicId, "candidate");
    throw error;
  }
}
