import type { DraftArticle } from "../writer/output.ts";

// 사실 검증: 기계적 게이트를 통과한 원고를 LLM이 근거 자료·유의사항과 대조해
// 뒷받침되지 않는 구체적 서술을 찾는다. 특히 학원·실내운전연습장(지점)에 대한 서술.
// 찾은 문장은 재작성 지시로 되돌린다.

export function factCheckPrompt(
  facts: string,
  guides: string,
  draft: DraftArticle,
  channelBrief = "",
): string {
  return [
    "당신은 운전면허·운전학원 글의 사실 검증 담당자입니다. 아래 원고를 [근거 자료]와 [유의사항]에만 비추어 검사하세요. 당신이 알고 있는 일반 지식으로 사실을 보충하거나 인정하지 마세요.",
    "",
    "찾아야 할 문장:",
    "1. 학원·실내운전연습장(지점)에 대한 구체적 서술 중 근거 자료에 없는 것 — 이름, 위치, 요금·할인, 교육 시간, 시설·장비, 강사, 셔틀, 운영 시간, 합격률, 후기, 특징·장점 평가(예: '최신 장비', '친절한 강사'는 후기 인용이 아니면 근거 필요)",
    "2. 근거 자료와 다른 숫자, 다른 조건(부가세·검정료 포함 여부, 기간, 대상)",
    "3. 근거 없이 단정한 법령·시험 제도의 구체 수치(수수료, 문항 수, 합격 점수, 기한, 과태료)",
    "4. 후기를 지어내거나 글쓴이 본인의 경험처럼 쓴 문장",
    "",
    "문제가 아닌 것: 일반적인 조언(확인하세요, 비교해 보세요), 근거 자료의 사실을 풀어 쓴 문장, 이미지 대체 텍스트, 확인처 안내, [채널 소개]에 있는 자사 서비스 안내.",
    "",
    "## 채널 소개 (이 글을 올리는 곳에 대한 사실)",
    channelBrief || "(없음)",
    "",
    "## 유의사항",
    guides || "(없음)",
    "",
    "## 근거 자료",
    facts || "(없음 — 특정 업체·수치를 단정한 문장은 모두 문제입니다)",
    "",
    "## 원고",
    `제목: ${draft.title}`,
    `설명: ${draft.summary}`,
    draft.body,
    "",
    "## 출력",
    'JSON 한 줄만 출력하세요. 형식: {"unsupported":[{"sentence":"문제 문장 그대로","reason":"왜 근거가 없는지"}]}',
    '문제가 없으면 {"unsupported":[]} 를 출력하세요.',
  ].join("\n");
}

export interface UnsupportedClaim {
  sentence: string;
  reason: string;
}

/** 모델 출력에서 JSON을 찾아 읽는다. 읽지 못하면 undefined. */
export function parseFactCheck(output: string): UnsupportedClaim[] | undefined {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    const obj = JSON.parse(output.slice(start, end + 1)) as { unsupported?: unknown };
    if (!Array.isArray(obj.unsupported)) return undefined;
    return obj.unsupported
      .map((u: any) => ({
        sentence: String(u?.sentence ?? "").trim(),
        reason: String(u?.reason ?? "").trim(),
      }))
      .filter((u) => u.sentence);
  } catch {
    return undefined;
  }
}

export function factCheckIssues(claims: UnsupportedClaim[]): string[] {
  return claims
    .slice(0, 8)
    .map(
      (c) =>
        `근거 없는 서술: "${c.sentence.slice(0, 80)}" — ${c.reason || "근거 자료·유의사항에 없음"}. 빼거나 근거 자료의 사실로 바꾸세요`,
    );
}
