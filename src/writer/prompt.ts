import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ChannelDef, SectionDef } from "../channels.ts";
import { type GuideRule, renderGuideRules } from "../guides.ts";
import { regionLabel } from "../keywords/regions.ts";
import { PROJECT_ROOT } from "../paths.ts";
import type { AvoidItem } from "../similarity/fingerprint.ts";
import { articleTypeLabel } from "../topics/intent.ts";
import type { Topic } from "../topics/store.ts";
import type { Facts, ImageCandidate } from "./facts.ts";

// 생성 프롬프트 조립. 같은 주제라도 채널 × 글 유형마다 다른 프롬프트가 되도록 파일을 겹친다.
//   prompts/base.md                               공통 원칙 (SEO·AEO·GEO·사실 원칙)
//   prompts/channels/<채널>.md                     채널 목소리·양식·분량
//   prompts/channels/<채널>/<글 유형>.md           채널 전용 글 유형 구성 (있으면 아래 대신)
//   prompts/types/<글 유형>.md                     글 유형 공통 구성
//   (없으면 prompts/types/guide.md)

export const PROMPTS_DIR = join(PROJECT_ROOT, "prompts");

export interface PromptFile {
  path: string;
  content: string;
}

function read(dir: string, rel: string): PromptFile | undefined {
  const path = join(dir, rel);
  return existsSync(path)
    ? {
        path: rel,
        content: readFileSync(path, "utf8")
          .replace(/^\uFEFF/, "")
          .trim(),
      }
    : undefined;
}

/** 채널 × 글 유형에 쓸 프롬프트 파일들 (적용 순서대로). */
export function promptFiles(
  channelId: string,
  articleType: string,
  dir = PROMPTS_DIR,
): PromptFile[] {
  const base = read(dir, "base.md");
  const channel = read(dir, `channels/${channelId}.md`);
  const type =
    read(dir, `channels/${channelId}/${articleType}.md`) ??
    read(dir, `types/${articleType}.md`) ??
    read(dir, "types/guide.md");
  if (!base || !channel || !type) {
    throw new Error(`프롬프트 파일이 없습니다 (base / channels/${channelId} / ${articleType})`);
  }
  return [base, channel, type];
}

export const OUTPUT_FORMAT = `## 출력 형식 (반드시 지키세요)

아래 구분자와 순서 그대로 출력하고, 구분자 밖에는 아무것도 쓰지 마세요. 코드 블록(\`\`\`)으로 감싸지 마세요.

<<<TITLE>>>
글 제목 한 줄
<<<SUMMARY>>>
검색 결과에 보일 설명 한두 문장 (80~150자, 대표 키워드 포함)
<<<KEYWORDS>>>
본문에 실제로 쓴 키워드 3~8개, 쉼표로 구분
<<<BODY>>>
# 글 제목
(Markdown 본문)
<<<END>>>`;

export interface PromptInput {
  topic: Topic;
  channel: ChannelDef;
  section: SectionDef;
  guides: Pick<GuideRule, "group" | "text">[];
  facts: Facts;
  avoid: AvoidItem[];
  /** 본문에 넣을 수 있는 이미지 (실제 사진 + 생성 삽화) */
  images: ImageCandidate[];
  /** 이번 글에 넣을 수 있는 자사 사이트 링크. 비어 있으면 링크를 쓰지 않는다. */
  links?: readonly { label: string; url: string }[];
  today: Date;
}

export interface ComposedPrompt {
  prompt: string;
  files: string[];
  /** 채널 소개 (사실 검증에서 자사 서비스 안내의 근거로 쓴다) */
  channelBrief: string;
}

function imagesText(images: ImageCandidate[], min: number): string {
  if (!images.length) return "(사용할 수 있는 이미지 없음 — 이미지를 넣지 마세요)";
  const free = images.filter((i) => !i.sectionMustMention).length;
  const restricted = images.length - free;
  const available = free + Math.min(1, restricted);
  const photoNote =
    '실제 사진, 무엇이 찍혔는지는 확인되지 않음 — 대체 텍스트에 장면을 지어내지 말고 "OO 사진"처럼 대상만 쓰세요';
  return [
    `아래 번호의 이미지만 서로 다른 섹션에 ${Math.min(min, available)}장 이상 넣으세요. 형식: ![대체 텍스트](번호)`,
    ...images.map((i) => {
      if (i.kind !== "photo") {
        return `- ${i.id}: 삽화 — ${i.subject} (생성 이미지, 실제 장소·업체가 아님 — 특정 학원·지점 사진처럼 쓰지 마세요)`;
      }
      if (i.sectionMustMention) {
        return `- ${i.id}: ${i.subject} (${photoNote}. **드라이빙존을 소개·안내하는 섹션에만** 넣고, 이런 매장 사진은 글 전체에서 1장까지입니다. 시험 절차·준비 방법을 설명하는 섹션에는 넣지 마세요)`;
      }
      return `- ${i.id}: ${i.subject} (${photoNote})`;
    }),
  ].join("\n");
}

function linksText(links: readonly { label: string; url: string }[]): string {
  return [
    "이 글에는 아래 주소만 링크로 넣을 수 있습니다. 드라이빙존을 안내하는 섹션(보통 글 끝쪽)에서 내용과 맞는 것 1~2개를 `[링크 글자](주소)` 형식으로 넣고, 링크 글자는 무엇을 볼 수 있는지 알 수 있게 씁니다(예: 요금제 자세히 보기). 주소를 바꾸거나 다른 주소를 만들지 마세요.",
    ...links.map((l) => `- ${l.label}: ${l.url}`),
  ].join("\n");
}

function avoidText(items: AvoidItem[]): string {
  if (!items.length) return "(같은 유형의 기존 글 없음)";
  return items
    .map(
      (a, i) =>
        `${i + 1}. 제목: ${a.title}\n   소제목: ${a.outline.slice(0, 8).join(" / ") || "(없음)"}\n   도입부: ${a.intro.slice(0, 90)}`,
    )
    .join("\n");
}

export function composePrompt(input: PromptInput, dir = PROMPTS_DIR): ComposedPrompt {
  const { topic, channel, section, facts } = input;
  const files = promptFiles(channel.id, topic.articleType, dir);
  const today = input.today.toISOString().slice(0, 10);
  const topicBlock = [
    "## 이번 글",
    `- 채널: ${channel.label} / 섹션: ${section.label} (${section.focus.join(", ")})`,
    `- 대표 키워드: ${topic.primaryKeyword} (최근 30일 네이버 검색 약 ${topic.volume.toLocaleString("ko-KR")}회)`,
    `- 보조 키워드: ${topic.secondaryKeywords.join(", ") || "(없음)"}`,
    `- 지역: ${topic.region ? regionLabel(topic.region) : "지역 무관(전국)"}`,
    `- 글 유형: ${articleTypeLabel(topic.articleType)}`,
    ...(topic.brief
      ? [
          `- 글 방향(운영자 지정): ${topic.brief.replace(/\s*\n\s*/g, " ")}`,
          "  이 방향으로 쓰되, 숫자·조건은 유의사항과 근거 자료에 있는 것만 씁니다.",
        ]
      : []),
    `- 작성일: ${today}`,
  ].join("\n");

  const guides = renderGuideRules(input.guides);
  const prompt = [
    ...files.map((f) => f.content),
    topicBlock,
    `## 유의사항 (반드시 지킬 운영 규칙과 사실)\n\n${guides || "(없음)"}`,
    `## 근거 자료\n\n${facts.text || "이 주제에 대해 제공되는 구체적 자료가 없습니다. 가격·합격률·기간 같은 수치와 특정 업체 이름은 쓰지 마세요."}`,
    `## 본문에 넣을 이미지\n\n${imagesText(input.images, channel.quality.minImages)}`,
    ...(input.links?.length ? [`## 본문에 넣을 수 있는 링크\n\n${linksText(input.links)}`] : []),
    `## 피해야 할 기존 글 (제목·소제목 구성·도입부가 겹치지 않게, 다른 각도로 쓰세요)\n\n${avoidText(input.avoid)}`,
    OUTPUT_FORMAT,
  ].join("\n\n");
  return { prompt, files: files.map((f) => f.path), channelBrief: files[1]?.content ?? "" };
}

/** 품질·유사도 문제를 알려 주고 전체를 다시 쓰게 한다. */
export function repairPrompt(original: string, previousOutput: string, issues: string[]): string {
  return [
    original,
    "## 이전에 쓴 원고",
    previousOutput.trim(),
    "## 고쳐야 할 점",
    "이전 원고에 아래 문제가 있습니다. 모두 고쳐서 출력 형식대로 **전체를 다시** 쓰세요. 문제가 없는 부분은 최대한 유지하세요.",
    issues.map((i) => `- ${i}`).join("\n"),
  ].join("\n\n");
}
