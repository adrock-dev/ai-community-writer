type AcademyRow = Record<string, unknown>;

/**
 * 학원이 운영하는 면허 과정을 구한다.
 *
 * 원천(DrivingPlus)이 licenseTypes 를 구조화해서 내려주므로 그 값을 우선 쓴다.
 * 동기화가 이 필드를 받기 전(또는 운영 endpoint 처럼 필드가 없는 경우)에 저장된 행을 위해
 * 기존 seo_description 정규식 추출을 폴백으로 남긴다.
 *
 * 정규식 폴백은 두 가지를 놓친다.
 *  - 소개 문구에 적히지 않은 과정(전체의 90%가 구조화 필드 쪽이 더 많다)
 *  - 자동·수동 구분(정규식은 "1종 보통" 하나로 뭉갠다)
 * 어느 경로든 학원명·지역에서 과정을 추론하지는 않는다.
 */

/** 원천 응답의 노출 순서와 같은 표준 정렬. 같은 입력이 항상 같은 문장이 되게 한다. */
const LICENSE_CODE_ORDER = [
  "type1_normal_manual",
  "type1_normal_auto",
  "type2_normal_auto",
  "type1_large",
  "type2_small",
  "motorized_bicycle",
  "type1_special_small_tow",
  "type1_special_large_tow",
  "type1_special_rescue",
];

const COURSE_PATTERNS: Array<[string, RegExp]> = [
  ["1종 보통", /1종\s*보통/u],
  ["2종 보통", /2종\s*보통/u],
  ["1종 대형", /1종\s*대형/u],
  ["2종 소형", /2종\s*소형/u],
  ["원동기", /원동기/u],
  ["대형견인", /대형\s*견인/u],
  ["소형견인", /소형\s*견인/u],
  ["구난", /구난/u],
];

function structuredLicenses(row: AcademyRow): string[] {
  const raw = row.extra;
  if (!raw) return [];
  let parsed: unknown;
  if (typeof raw === "string") {
    try { parsed = JSON.parse(raw); } catch { return []; }
  } else {
    parsed = raw;
  }
  if (!parsed || typeof parsed !== "object") return [];
  const types = (parsed as Record<string, unknown>).license_types;
  if (!Array.isArray(types)) return [];
  const seen = new Set<string>();
  const entries: Array<{ code: string; label: string }> = [];
  for (const type of types) {
    if (!type || typeof type !== "object") continue;
    const label = String((type as Record<string, unknown>).label ?? "").trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    entries.push({ code: String((type as Record<string, unknown>).code ?? "").trim(), label });
  }
  const rank = (code: string) => {
    const index = LICENSE_CODE_ORDER.indexOf(code);
    return index === -1 ? LICENSE_CODE_ORDER.length : index;
  };
  return entries.sort((a, b) => rank(a.code) - rank(b.code)).map((entry) => entry.label);
}

function parsedLicenses(row: AcademyRow): string[] {
  const source = String(row.seo_description || "").trim()
    // A frequent compact source form means both ordinary-licence courses.
    .replace(/1종\s*[·ㆍ/]\s*2종\s*보통/gu, "1종 보통, 2종 보통");
  return COURSE_PATTERNS.filter(([, pattern]) => pattern.test(source)).map(([label]) => label);
}

export function availableLicensesFromSource(row: AcademyRow): string[] {
  const structured = structuredLicenses(row);
  return structured.length ? structured : parsedLicenses(row);
}

export function courseFactText(row: AcademyRow): string | null {
  const courses = availableLicensesFromSource(row);
  return courses.length ? courses.join(", ") : null;
}
