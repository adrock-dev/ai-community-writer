import { createArticle } from "../articles/store.ts";
import { findChannel, findSection } from "../channels.ts";
import type { AppConfig } from "../config.ts";
import type { Database } from "../db/database.ts";
import { loadGuideRules } from "../guides.ts";
import type { LlmResult } from "../llm/client.ts";
import { qualityIssues } from "../quality/gate.ts";
import {
  avoidList,
  findSimilar,
  fingerprint,
  saveFingerprint,
  similarityIssues,
} from "../similarity/fingerprint.ts";
import { getTopic, setTopicProgress } from "../topics/store.ts";
import { buildFacts, type Facts } from "./facts.ts";
import { parseDraft } from "./output.ts";
import { composePrompt, repairPrompt } from "./prompt.ts";

// 글 1편 생성: 근거 자료 → 프롬프트 → LLM → 품질·유사도 검사 → (문제 있으면 재작성) → 저장.
// 결과는 사람 검수를 기다린다. 문제가 끝까지 남으면 status=draft와 문제 목록을 함께 저장한다.

export interface LlmLike {
  generate(prompt: string, opts?: { timeoutSec?: number }): Promise<LlmResult>;
}

export interface GenerateDeps {
  db: Database;
  config: AppConfig;
  llm: LlmLike;
  /** 테스트용: 근거 자료를 직접 준다 */
  facts?: Facts;
  now?: Date;
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

export async function generateArticle(
  deps: GenerateDeps,
  topicId: number,
): Promise<GenerateResult> {
  const { db, config } = deps;
  const log = deps.log ?? (() => {});
  const topic = getTopic(db, topicId);
  if (!topic) throw new Error(`주제 #${topicId}가 없습니다`);
  const channel = findChannel(topic.channelId);
  const section = findSection(topic.channelId, topic.sectionCode);
  if (!channel || !section) throw new Error(`주제 #${topicId}의 채널·섹션 정의가 없습니다`);

  setTopicProgress(db, topicId, "queued");
  try {
    const guides = loadGuideRules(db, channel.id);
    const facts = deps.facts ?? (await buildFacts(db, config.sources, topic, channel));
    const avoid = avoidList(db, channel.id, topic.articleType);
    const composed = composePrompt({
      topic,
      channel,
      section,
      guides,
      facts,
      avoid,
      today: deps.now ?? new Date(),
    });
    const corpus = `${facts.text}\n${guides.map((g) => g.text).join("\n")}`;

    let prompt = composed.prompt;
    let issues: string[] = [];
    let last: { output: string; result: LlmResult } | undefined;
    let draft: ReturnType<typeof parseDraft>;
    let similar: ReturnType<typeof findSimilar> = [];
    const history: { attempt: number; provider: string; durationMs: number; issues: string[] }[] =
      [];

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      log(`주제 #${topicId} "${topic.primaryKeyword}" ${attempt}차 작성 (${channel.id})`);
      const result = await deps.llm.generate(prompt);
      draft = parseDraft(result.text);
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
            candidates: facts.candidates,
          }),
          ...similarityIssues(similar),
        ];
      }
      history.push({ attempt, provider: result.provider, durationMs: result.durationMs, issues });
      last = { output: result.text, result };
      if (!issues.length) break;
      log(`  문제 ${issues.length}건: ${issues.join(" | ")}`);
      prompt = repairPrompt(composed.prompt, result.text, issues);
    }

    if (!draft || !last) {
      throw new Error(`출력 형식 오류가 ${MAX_ATTEMPTS}번 반복됐습니다`);
    }
    const status = issues.length ? "draft" : "review";
    const articleId = createArticle(db, {
      topicId,
      channelId: channel.id,
      sectionCode: section.code,
      articleType: topic.articleType,
      region: topic.region,
      title: draft.title,
      summary: draft.summary,
      body: draft.body,
      format: channel.format,
      keywords: draft.keywords,
      status,
      qualityIssues: issues,
      similarArticles: similar,
      facts: facts.text,
      generation: {
        promptFiles: composed.files,
        attempts: history,
        factsAsOf: facts.asOf,
        factsWarnings: facts.warnings,
        guideRuleIds: guides.map((g) => g.id),
      },
      provider: last.result.provider,
      model: last.result.model,
    });
    saveFingerprint(db, articleId, fingerprint(draft.body));
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
