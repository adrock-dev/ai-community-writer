type AcademyRow = Record<string, unknown>;

/**
 * The DrivingPlus academy feed does not expose a dedicated course column in
 * the content DB.  Its source description does, however, state the courses
 * offered by an academy.  Extract only canonical licence labels that appear
 * in that source text; never infer a course from a school name or location.
 */
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

export function availableLicensesFromSource(row: AcademyRow): string[] {
  const source = String(row.seo_description || "").trim()
    // A frequent compact source form means both ordinary-licence courses.
    .replace(/1종\s*[·ㆍ/]\s*2종\s*보통/gu, "1종 보통, 2종 보통");
  return COURSE_PATTERNS.filter(([, pattern]) => pattern.test(source)).map(([label]) => label);
}

export function courseFactText(row: AcademyRow): string | null {
  const courses = availableLicensesFromSource(row);
  return courses.length ? courses.join(", ") : null;
}
