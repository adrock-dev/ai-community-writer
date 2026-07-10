// 글유형(템플릿)별로 어떤 축 값을 쓸지 결정하는 태그 시스템.
// 축 값(persona/intent/modifier)의 태그는 DB에 저장하지 않고 값 문자열에서 규칙으로 유도한다.
// 이렇게 하면 프리셋/AI/수동 입력 값 모두 자동 태깅되고, 기존 도메인도 별도 백필 없이 즉시 필터된다.
// keyword/region은 이미 slot.service 의 정규식으로 글유형별 선택이 이뤄지므로 여기서 다루지 않는다.

import type { TemplateSpecShape } from "./constants.js";

type Row = Record<string, any>;
export type TaggedAxis = "persona" | "intent" | "modifier";

// 관리자 UI가 글유형별 수용 태그를 편집할 때 보여줄 어휘. "common"은 어느 글유형에나 포함되는 범용 태그.
export const AXIS_TAG_VOCAB: Record<TaggedAxis, string[]> = {
  persona: ["select", "practice", "license", "schedule", "cost", "written", "timing", "common"],
  intent: ["select", "exam", "written", "location", "schedule", "common"],
  modifier: ["select", "cost", "schedule", "written", "practice", "common"],
};

// 값 → 태그 유도 규칙. 하나의 값이 여러 태그를 가질 수 있고, 아무 규칙에도 안 맞으면 ["common"](전체 매칭)이다.
const TAG_RULES: Record<TaggedAxis, Array<{ tag: string; test: RegExp }>> = {
  persona: [
    { tag: "select", test: /학원|셔틀|가까운|근처|가성비|자체시험|후기|비교|추천|연습|시험장/u },
    { tag: "practice", test: /기능|도로주행|주차|경사로|T자|평행|야간운전|자신감|두려|걱정되는 초보|재응시/u },
    { tag: "license", test: /1종|2종|대형|소형/u },
    { tag: "schedule", test: /주말|야간|교대|자영업|퇴근|출퇴근/u },
    { tag: "cost", test: /비용|수강료|가성비|절약/u },
    { tag: "written", test: /필기/u },
    { tag: "timing", test: /취업|입대|방학|수능|복학|유학|편입|결혼|출산|육아|첫 차|신차|중고차|이직|입사|출근|신입|자녀|보호자|부모|커플|친구|형제/u },
  ],
  intent: [
    { tag: "select", test: /비교|추천|근처|비용|수강료|셔틀/u },
    { tag: "exam", test: /기능|도로주행|필기|단기/u },
    { tag: "written", test: /필기|접수|준비물/u },
    { tag: "location", test: /근처|셔틀/u },
    { tag: "schedule", test: /주말|야간/u },
  ],
  modifier: [
    { tag: "select", test: /근처|가까운|셔틀|상담/u },
    { tag: "cost", test: /비용|절약/u },
    { tag: "schedule", test: /주말|야간/u },
    { tag: "written", test: /필기/u },
    { tag: "practice", test: /도로주행/u },
  ],
};

// 축 값 하나의 태그를 유도한다. 규칙 미매치는 "common"(어느 글유형에나 포함).
export function tagsForValue(axis: TaggedAxis, value: unknown): string[] {
  const text = String(value ?? "").trim();
  if (!text) return ["common"];
  const tags = TAG_RULES[axis].filter((rule) => rule.test.test(text)).map((rule) => rule.tag);
  return tags.length ? tags : ["common"];
}

// 값 태그가 글유형의 수용 태그에 부합하는가.
// - 수용 목록에 "*"가 있으면 전부 허용
// - 값이 "common"이면 어느 글유형에나 포함(범용)
// - 그 외에는 교집합이 있어야 포함
function valueMatchesAccepted(valueTags: string[], accepted: string[]): boolean {
  if (accepted.includes("*")) return true;
  if (valueTags.includes("common")) return true;
  return valueTags.some((tag) => accepted.includes(tag));
}

// 글유형이 특정 축에서 수용하는 태그 목록. 미지정이면 ["*"](전체 허용) — 즉 기존 동작과 동일해 안전.
// 기본값은 spec.axis_tags(빌트인 상수/커스텀 row)에서, 도메인별 override 로 재정의 가능.
export function resolveAcceptedTags(spec: TemplateSpecShape | undefined, axis: TaggedAxis, override: TemplateOverride | undefined): string[] {
  const o = override?.axis_tags?.[axis];
  if (Array.isArray(o) && o.length) return o;
  const base = spec?.axis_tags?.[axis];
  return Array.isArray(base) && base.length ? base : ["*"];
}

// 축 값 목록을 글유형 수용 태그로 필터. 부합하는 값이 하나도 없으면 빈 배열을 반환(호출측에서 축 생략).
export function filterAxisValues(axis: TaggedAxis, values: Row[], accepted: string[]): Row[] {
  if (accepted.includes("*")) return values;
  return values.filter((row) => valueMatchesAccepted(tagsForValue(axis, row.value), accepted));
}

export type TemplateOverride = {
  direction?: string;
  axis_tags?: Partial<Record<TaggedAxis, string[]>>;
  // 빌트인 글유형 레시피 파라미터의 도메인별 오버라이드 (없으면 상수 기본값 사용).
  use_persona?: boolean;
  with_intent?: boolean;
  modifier_count?: number;
  // 글유형별 디자인(PR3: 레거시 design_template_overrides 통합 대상). 디자인 유효성은 소비측(resolveGenerationDesign)에서 검증.
  design?: string;
};
export type TemplateOverrides = Record<string, TemplateOverride>;

// 도메인 template_overrides(JSON) 를 안전하게 파싱한다.
export function safeTemplateOverrides(value: unknown): TemplateOverrides {
  const raw = typeof value === "string" ? tryParse(value) : value;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: TemplateOverrides = {};
  for (const [templateId, cfg] of Object.entries(raw as Record<string, unknown>)) {
    if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) continue;
    const entry: TemplateOverride = {};
    const direction = (cfg as Row).direction;
    if (typeof direction === "string" && direction.trim()) entry.direction = direction.trim();
    const axisTags = (cfg as Row).axis_tags;
    if (axisTags && typeof axisTags === "object" && !Array.isArray(axisTags)) {
      const tags: Partial<Record<TaggedAxis, string[]>> = {};
      for (const axis of ["persona", "intent", "modifier"] as TaggedAxis[]) {
        const list = (axisTags as Row)[axis];
        if (Array.isArray(list)) tags[axis] = list.map((t) => String(t)).filter(Boolean);
      }
      if (Object.keys(tags).length) entry.axis_tags = tags;
    }
    const usePersona = (cfg as Row).use_persona;
    if (typeof usePersona === "boolean") entry.use_persona = usePersona;
    const withIntent = (cfg as Row).with_intent;
    if (typeof withIntent === "boolean") entry.with_intent = withIntent;
    const modifierCount = (cfg as Row).modifier_count;
    if (typeof modifierCount === "number" && Number.isFinite(modifierCount)) entry.modifier_count = Math.max(0, Math.min(2, Math.round(modifierCount)));
    const design = (cfg as Row).design;
    if (typeof design === "string" && design.trim()) entry.design = design.trim();
    if (entry.direction || entry.axis_tags || entry.use_persona !== undefined || entry.with_intent !== undefined || entry.modifier_count !== undefined || entry.design) out[templateId] = entry;
  }
  return out;
}

// 글유형 레시피 파라미터: 도메인 오버라이드 → spec 기본값. (빌트인은 상수가 기본, DB엔 델타만 / 커스텀은 row 가 기본)
export function resolveRecipeFlags(spec: TemplateSpecShape | undefined, override: TemplateOverride | undefined): { use_persona: boolean; with_intent: boolean; modifier_count: number } {
  return {
    use_persona: override?.use_persona ?? Boolean(spec?.use_persona),
    with_intent: override?.with_intent ?? Boolean(spec?.with_intent),
    modifier_count: override?.modifier_count ?? Number(spec?.modifier_count ?? 0),
  };
}

// 글유형 방향성: 도메인 오버라이드 → spec 기본 방향성 순.
export function resolveTemplateDirection(spec: TemplateSpecShape | undefined, override: TemplateOverride | undefined): string {
  const o = override?.direction;
  if (o && o.trim()) return o.trim();
  return String(spec?.default_direction || "").trim();
}

function tryParse(value: string): unknown {
  if (!value.trim()) return null;
  try { return JSON.parse(value); } catch { return null; }
}
