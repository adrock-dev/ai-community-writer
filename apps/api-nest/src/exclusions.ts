type Row = Record<string, any>;

const SLOT_EXCLUSION_FIELDS = [
  "slot_id",
  "template_id",
  "primary_keyword",
  "region",
  "persona",
  "intent",
  "modifier_1",
  "modifier_2",
  "entity_id",
];

export function parseExclusionTerms(raw: any): string[] {
  const source = Array.isArray(raw) ? raw.join("\n") : String(raw || "");
  const seen = new Set<string>();
  for (const term of source.split(/\r?\n|,/).map((v) => v.trim().toLowerCase()).filter(Boolean)) {
    seen.add(term);
  }
  return [...seen];
}

// 감시 문구(monitored_phrases): 품질 게이트의 boilerplate 검사에 더할 도메인별 판박이 문구.
// 본문과 대소문자 구분 없이 includes 로 매칭하므로 소문자화하지 않는다(한글 위주, 원문 보존).
export function parseMonitoredPhrases(raw: any): string[] {
  const source = Array.isArray(raw) ? raw.join("\n") : String(raw || "");
  const seen = new Set<string>();
  for (const term of source.split(/\r?\n|,/).map((v) => v.trim()).filter(Boolean)) seen.add(term);
  return [...seen];
}

export function slotExclusionText(slot: Row): string {
  return SLOT_EXCLUSION_FIELDS.map((field) => String(slot[field] || "")).join(" ").toLowerCase();
}

export function findMatchedExclusionTerms(text: string, terms: string[]): string[] {
  const haystack = String(text || "").toLowerCase();
  return terms.filter((term) => haystack.includes(term));
}

export function findSlotExclusionTerms(slot: Row, terms: string[]): string[] {
  return findMatchedExclusionTerms(slotExclusionText(slot), terms);
}

export function filterExcludedSlots<T extends Row>(slots: T[], rawTerms: any): { kept: T[]; excluded: T[]; terms: string[] } {
  const terms = parseExclusionTerms(rawTerms);
  if (!terms.length) return { kept: slots, excluded: [], terms };
  const kept: T[] = [];
  const excluded: T[] = [];
  for (const slot of slots) {
    if (findSlotExclusionTerms(slot, terms).length) excluded.push(slot);
    else kept.push(slot);
  }
  return { kept, excluded, terms };
}

export function slotExclusionSql(alias = "slots"): { predicate: string; argsForTerm: (term: string) => string[] } {
  const prefix = alias ? `${alias}.` : "";
  const fields = SLOT_EXCLUSION_FIELDS.map((field) => `lower(COALESCE(${prefix}${field},'')) LIKE ?`);
  return {
    predicate: `NOT (${fields.join(" OR ")})`,
    argsForTerm: (term: string) => fields.map(() => `%${term}%`),
  };
}
