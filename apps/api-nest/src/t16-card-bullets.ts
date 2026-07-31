import { courseFactText } from "./academy-course-evidence.js";
import { hasShuttleDetail } from "./drivingplus-shuttle-facts.js";

/**
 * T16 학원 카드의 「기본 정보 불릿」을 **코드가 facts 에서 만들어 붙인다.**
 *
 * 왜 프롬프트가 아니라 코드인가 — 계약(`worker.service.ts` 의 academyDetailGuide)은 카드마다
 * 2~6개의 기본 정보 불릿을 요구하지만 **지켜지지 않는다.** 실측(2026-07-31): 발행 5편 중 3편이
 * 카드 불릿 0개였고, 계약 문장을 「반드시」로 강화한 뒤 생성한 글도 0개였다. 카드 구조가 모델
 * 재량인 한 문장을 더 얹어도 같은 결과다(그 판단은 `t16-axis-comparison.ts` 의 실측 주석 참조).
 *
 * 그래서 **모델이 쓴 카드는 건드리지 않고, 빠진 카드에만 채워 넣는다.** 이 함수가 하는 일은
 * 정보를 새로 만드는 것이 아니라 이미 facts 로 프롬프트에 준 값을 같은 자리에 다시 놓는 것뿐이다
 * — 지어낸 값이 들어갈 여지가 없다(입력이 academies 행이고, 없는 항목은 아예 만들지 않는다).
 *
 * 마크다운 그대로 `- **라벨:** 값` 줄을 넣으므로 렌더러(`post-rendering.ts`)와 `qa-posts.mjs`
 * 미러는 손대지 않아도 된다 — 둘 다 이미 일반 목록으로 처리한다(`gate-parity.test.ts` 가 대조).
 */

export type CardBulletAcademy = Record<string, unknown>;

/** 카드에 이미 기본 정보 불릿이 있다고 볼 라벨. 계약이 쓰는 여섯 가지와 같다. */
const BULLET_LABELS = ["주소", "전화", "수강료", "셔틀 운행 지역", "운영 과정", "운영 형태"] as const;
const BULLET_LINE = new RegExp(`^\\s*-\\s+\\*\\*(${BULLET_LABELS.join("|")})\\s*:?\\*\\*`);

/**
 * 이 개수 이상이면 모델이 쓴 것으로 보고 건드리지 않는다.
 *
 * 1개만 두는 카드는 계약(2~6개)을 못 지킨 것이지만 그래도 손대지 않는다 — 모델이 고른 한 줄을
 * 코드가 지우거나 뒤에 덧붙이면 순서·중복을 사람이 예측할 수 없게 된다. 0개인 카드만 채운다.
 */
const KEEP_IF_AT_LEAST = 1;

function text(value: unknown): string {
  return String(value ?? "").trim();
}

/**
 * 수강료에서 공통 단서를 뗀다.
 *
 * "(부가세 별도, 검정료 포함, 2026년 1분기 기준)" 같은 단서는 **글에서 한 번만** 밝히는 것이
 * 계약이다(표 아래 한 줄). 카드마다 되풀이하면 다섯 장이 같은 각주를 지고, 실측에서 카드 불릿
 * 1,555자 중 수강료가 385자를 차지한 주범이었다 — 길이 게이트(5,600자)를 넘겨 글이 격리됐다.
 */
function priceWithoutCommonNote(value: string): string {
  return value.replace(/\s*[（(][^)）]*(?:부가세|검정료|기준)[^)）]*[)）]/g, "").trim();
}

/**
 * 셔틀 운행 지역을 대표 몇 곳으로 줄인다 — 계약이 모델에게 요구하는 것과 같은 규칙이다.
 *
 * 원본(`formatShuttleFact`)은 ` · ` 로 이은 조각 묶음이다:
 *   `운행 지역(자료 기준) 남구(대명동·봉덕동·이천동), 달서구(감삼동·두류동 등), 외 6곳 · 이용 조건 …`
 * 카드 불릿에 필요한 것은 첫 조각뿐이다. 「이용 조건」은 지역이 아니고(라벨과 어긋난다) 길다.
 *
 * 쉼표로 그냥 자르면 **괄호 안에서 잘린다** — 실제로 발행 글에 `달서구(감삼동 등` 이 나갔다.
 * 그래서 괄호 깊이 0인 쉼표에서만 나눈다. 원본이 이미 달고 있는 「외 N곳」은 우리가 다시 줄이면
 * 개수가 맞지 않으므로 뗀다(대신 「등」으로 마무리한다).
 */
function shuttleSummary(value: string, max = 3): string {
  const segments = value.split(/\s+·\s+/).map((v) => v.trim()).filter(Boolean);
  const regionSegment = segments.find((v) => v.startsWith("운행 지역")) ?? segments[0] ?? "";
  const body = regionSegment.replace(/^운행 지역\s*(\([^)]*\))?\s*/, "").trim();
  if (!body) return "";

  const parts: string[] = [];
  let depth = 0;
  let buf = "";
  for (const ch of body) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) { parts.push(buf.trim()); buf = ""; continue; }
    buf += ch;
  }
  if (buf.trim()) parts.push(buf.trim());

  const regions = parts.filter((v) => v && !/^외\s*\d+\s*곳$/.test(v));
  if (!regions.length) return "";
  const shown = regions.slice(0, max);
  return regions.length > shown.length ? `${shown.join(", ")} 등` : shown.join(", ");
}

/**
 * 학원 한 곳의 기본 정보 불릿 줄을 만든다. 값이 없는 항목은 만들지 않는다(계약과 같다).
 *
 * `includeOperationType` 는 호출자가 정한다 — 계약이 "모든 학원이 같은 운영 형태면 카드 불릿에
 * 넣지 않는다"고 하는데, 그 판정은 카드 하나만 봐서는 할 수 없다.
 */
export function academyCardBulletLines(
  academy: CardBulletAcademy,
  includeOperationType: boolean,
  academyTypeLabel: (value: unknown) => string,
): string[] {
  const lines: string[] = [];
  const push = (label: string, value: string) => { if (value) lines.push(`- **${label}:** ${value}`); };

  push("주소", text(academy.address));
  // 공개 글에 노출할 연락처는 안심번호(vphone)뿐이다 — facts 와 같은 규칙이다(실번호는 아예 안 쓴다).
  push("전화", text(academy.vphone));
  push("수강료", priceWithoutCommonNote(text(academy.price)));
  // 지역이 없는 셔틀 값("셔틀 운행" 같은 내부 신호)은 라벨과 어긋나므로 넣지 않는다.
  if (hasShuttleDetail(academy.shuttle)) push("셔틀 운행 지역", shuttleSummary(text(academy.shuttle)));
  push("운영 과정", text(courseFactText(academy)));
  if (includeOperationType) push("운영 형태", text(academyTypeLabel(academy.academy_type)));

  // 계약의 상한과 같게 자른다. 라벨 순서는 위 고정 순서를 따른다 — 카드마다 순서가 달라지면
  // 독자가 같은 자리에서 같은 값을 찾지 못한다.
  return lines.slice(0, 6);
}

type Card = { name: string; start: number; end: number; bulletCount: number; insertAt: number };

/**
 * `### 학원명` H3 카드를 찾는다. H2 이상(`## `·`# `)을 만나면 카드 묶음이 끝난 것으로 본다.
 */
function parseCards(lines: string[]): Card[] {
  const cards: Card[] = [];
  let current: Card | null = null;
  const close = (end: number) => { if (current) { current.end = end; cards.push(current); current = null; } };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const h3 = /^###\s+(.+?)\s*$/.exec(line);
    if (h3) { close(i); current = { name: (h3[1] ?? "").trim(), start: i, end: lines.length, bulletCount: 0, insertAt: -1 }; continue; }
    if (/^#{1,2}\s+/.test(line)) { close(i); continue; }
    if (!current) continue;
    if (BULLET_LINE.test(line)) current.bulletCount++;
  }
  close(lines.length);

  // 넣을 자리: 카드의 첫 인용(>) 앞. 계약이 "소개 → (이미지) → 기본 정보 불릿 → 리뷰 인용" 순서를
  // 요구하므로, 인용이 있으면 그 앞이 유일하게 맞는 자리다. 인용이 없으면 카드 끝(빈 줄 제외)에 붙인다.
  for (const card of cards) {
    let quote = -1;
    let lastContent = card.start;
    for (let i = card.start + 1; i < card.end; i++) {
      const line = (lines[i] ?? "").trim();
      if (!line) continue;
      lastContent = i;
      if (quote === -1 && line.startsWith(">")) quote = i;
    }
    card.insertAt = quote === -1 ? lastContent + 1 : quote;
  }
  return cards;
}

/** 학원명 대조용 정규화 — 공백·괄호 안 부연을 무시한다(모델이 카드 제목을 다듬는 일이 잦다). */
function normalizeName(value: string): string {
  return value.replace(/\([^)]*\)/g, "").replace(/\s+/g, "").toLowerCase();
}

function findAcademy(name: string, academies: CardBulletAcademy[]): CardBulletAcademy | undefined {
  const target = normalizeName(name);
  if (!target) return undefined;
  const exact = academies.find((a) => normalizeName(text(a.name)) === target);
  if (exact) return exact;
  // 카드 제목에 지역·수식이 붙는 경우가 있어 포함 관계까지만 본다. 그 이상은 맞추지 않는다 —
  // 엉뚱한 학원의 주소·전화를 붙이는 것이 불릿이 없는 것보다 훨씬 나쁘다.
  return academies.find((a) => {
    const candidate = normalizeName(text(a.name));
    return candidate.length >= 3 && (target.includes(candidate) || candidate.includes(target));
  });
}

/**
 * 기본 정보 불릿이 하나도 없는 카드에 facts 기반 불릿을 채운다.
 *
 * 학원을 못 찾은 카드는 건드리지 않는다. 되돌릴 수 없는 오배정(다른 학원의 전화번호)이
 * 불릿이 비는 것보다 나쁘기 때문이다.
 */
export function ensureT16CardBullets(
  markdown: string,
  academies: CardBulletAcademy[],
  // 운영 형태의 사람이 읽는 이름은 호출자가 준다. 여기서 다시 매핑하면 표·용어 설명과 어긋나고,
  // worker.service 에서 가져오면 순환 임포트가 된다(그쪽이 이 모듈을 부른다).
  academyTypeLabel: (value: unknown) => string,
): string {
  const body = String(markdown || "");
  if (!body.trim() || !academies?.length) return body;

  // 운영 형태는 학원마다 다를 때만 넣는다(계약과 같은 규칙). 한 글의 운영 형태는 보통 1~2가지라
  // 모두 같으면 공통 사실이고, 카드마다 되풀이하면 다섯 줄이 같은 말을 한다.
  const operationTypes = new Set(academies.map((a) => text(academyTypeLabel(a.academy_type))).filter(Boolean));
  const includeOperationType = operationTypes.size > 1;

  const lines = body.split("\n");
  const cards = parseCards(lines);
  const inserts: Array<{ at: number; lines: string[] }> = [];

  for (const card of cards) {
    if (card.bulletCount >= KEEP_IF_AT_LEAST) continue;
    const academy = findAcademy(card.name, academies);
    if (!academy) continue;
    const bullets = academyCardBulletLines(academy, includeOperationType, academyTypeLabel);
    // 2개 미만이면 넣지 않는다 — 계약의 하한이고, 한 줄짜리 불릿 묶음은 목록으로 보이지 않는다.
    if (bullets.length < 2) continue;
    inserts.push({ at: card.insertAt, lines: bullets });
  }
  if (!inserts.length) return body;

  // 뒤에서부터 넣어야 앞선 삽입이 뒤 카드의 줄 번호를 밀지 않는다.
  inserts.sort((a, b) => b.at - a.at);
  const out = [...lines];
  for (const { at, lines: bullets } of inserts) {
    const before = (out[at - 1] ?? "").trim() ? [""] : [];
    const after = (out[at] ?? "").trim() ? [""] : [];
    out.splice(at, 0, ...before, ...bullets, ...after);
  }
  return out.join("\n");
}
