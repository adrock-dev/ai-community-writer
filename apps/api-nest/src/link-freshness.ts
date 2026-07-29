/**
 * 「원천 자료가 마지막 연결보다 새로운가」 판정 한 곳.
 *
 * 도메인의 `academies` 는 원본 저장소가 아니라 **쓰기 시점 계산 캐시**다. 지역 배정·셔틀 운행
 * 지역·조사값·승인 상태가 모두 `upsertDrivingplusAcademies`(=「학원자료 연결」) 시점에 구워진다.
 * 그래서 원천 표(지역 목록·지역 사전·조사 DB)만 새로 받으면 학원 행은 옛 값 그대로 남는다.
 *
 * 이 판정이 화면 세 곳(도메인 원천 데이터 탭·심층조사 카드·셸 배너)에서 쓰이는데, 예전에는
 * 서버와 클라이언트에 따로 구현돼 있었다. 이 저장소는 품질 게이트와 마크다운 렌더러를 이중
 * 구현했다가 게이트가 자기 버그를 통과시킨 전례가 있다 — 판정은 여기 하나만 둔다.
 */

/**
 * 두 DB 가 시각 형식이 다르다. admin.db 는 nowSql("2026-07-29 01:41:04"), 조사 DB 는
 * nowIso("2026-07-29T01:41:04.128Z") 다. 문자열로 비교하면 공백(0x20) < "T"(0x54) 라
 * **연결 시각이 언제나 더 작게** 나와 안내가 영영 꺼지지 않는다. 반드시 파싱해서 견준다.
 */
export function parseUtcTimestamp(value: string | null | undefined): number | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  // 공백 구분자는 T 로 바꾸고, 시간대 표기가 없으면 UTC 로 읽는다(두 DB 모두 UTC 로 적는다).
  const normalized = text.includes("T") ? text : text.replace(" ", "T");
  const withZone = /[Zz]|[+-]\d{2}:?\d{2}$/.test(normalized) ? normalized : `${normalized}Z`;
  const parsed = Date.parse(withZone);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * `academies.synced_at` 은 초 단위라 밀리초가 잘린다. 같은 초에 연결했는데 변경 쪽에 .276 이
 * 붙어 있으면 반영이 끝났는데도 안내가 켜진 채로 남는다. 1초는 같은 시점으로 본다.
 */
export const LINK_TOLERANCE_MS = 1000;

/**
 * 원천 자료(sourceAt)가 마지막 연결(linkedAt)보다 새로운가.
 *
 * 한 번도 연결한 적이 없으면(linkedAt 없음) **반영 대기로 보지 않는다.** 반영할 대상 자체가
 * 없고, 그 상황은 「연결된 학원이 없습니다」 안내가 따로 맡는다. 둘 다 띄우면 같은 버튼을
 * 가리키는 안내가 한 화면에 두 개 선다.
 */
export function isAheadOfLink(sourceAt: string | null | undefined, linkedAt: string | null | undefined): boolean {
  const source = parseUtcTimestamp(sourceAt);
  if (source === null) return false;
  const linked = parseUtcTimestamp(linkedAt);
  if (linked === null) return false;
  return source > linked + LINK_TOLERANCE_MS;
}
