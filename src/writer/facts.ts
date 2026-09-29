import type { ChannelDef } from "../channels.ts";
import type { AppConfig } from "../config.ts";
import type { Database } from "../db/database.ts";
import { type Academy, fetchAcademies } from "../sources/drivingplus.ts";
import {
  DRIVINGZONE_PRICE_VAT_INCLUDED,
  fetchPricing,
  fetchStores,
  type PricingCategory,
  type PricingPlan,
  type Store,
} from "../sources/drivingzone.ts";
import type { Topic } from "../topics/store.ts";
import { vatLabel, formatWon as won } from "./money.ts";

// 근거 자료: 글에 구체적으로 쓸 수 있는 사실만 모은 텍스트.
// 프롬프트에는 text가, 품질 게이트의 숫자 검증에는 text + 유의사항이 들어간다.
// 원천 시스템 이름·URL은 넣지 않는다(본문에 새어 나가지 않게).
// 금액은 "25만원" 표기와 부가세 포함 여부를 항상 함께 적는다.

export interface ImageCandidate {
  /** 프롬프트·본문에서 쓰는 번호 (img1, img2 …) */
  id: string;
  url: string;
  /** photo: 원천 데이터의 실제 사진 / generated: 생성한 삽화 */
  kind: "photo" | "generated";
  /** 무엇의 사진인지 (내용은 모름). 대체 텍스트의 근거 */
  subject: string;
  /**
   * 이 사진을 넣을 섹션(H2)에 있어야 하는 낱말. 하나라도 있어야 하고, 이런 사진은 글 전체에서 1장까지다.
   * 드라이빙존 매장 사진이 시험 절차 같은 섹션에 뜬금없이 들어가지 않게, 드라이빙존 안내 섹션에만 둔다.
   * 없으면 어느 섹션에나 넣을 수 있다. 제한 사진은 최소 장수(minImages)를 채우는 데 세지 않는다.
   */
  sectionMustMention?: string[];
}

export interface Facts {
  text: string;
  /** 비교·추천 글의 실제 후보 이름. 부풀린 개수 검사에 쓴다. */
  candidates: string[];
  /** 본문에 넣을 수 있는 실제 사진 */
  images: ImageCandidate[];
  /** 자료 기준 시각 (원천 캐시 시각 중 가장 오래된 것). */
  asOf: string;
  warnings: string[];
}

/** 근거로 쓸 만한 후기인가: 완성형 한글 15자 이상, 자음·모음만 쓴 글자가 많지 않을 것. */
export function isMeaningfulReview(text: string): boolean {
  const syllables = (text.match(/[가-힣]/g) ?? []).length;
  const jamo = (text.match(/[ㄱ-ㅎㅏ-ㅣ]/g) ?? []).length;
  return syllables >= 15 && jamo <= syllables * 0.3;
}

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
const day = (iso: string) => iso.slice(0, 10);
const isUrl = (u: string) => /^https?:\/\//.test(u);

function median(xs: number[]): number | undefined {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round(((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2);
}

/** 행정구역 개편 전 이름으로 적힌 주소를 현재 이름으로 맞춘다. */
const OLD_SIDO: [RegExp, string][] = [
  [/^전라북도/, "전북특별자치도"],
  [/^강원도/, "강원특별자치도"],
  [/^제주도/, "제주특별자치도"],
];

export function normalizeAddress(address: string): string {
  return OLD_SIDO.reduce((a, [re, now]) => a.replace(re, now), address.trim());
}

/** 지역 키("서울특별시 강남구|...")에 속한 주소인가. */
export function inRegion(address: string, regionKey: string): boolean {
  if (!regionKey) return true;
  const a = normalizeAddress(address);
  return regionKey.split("|").some((r) => a.startsWith(r));
}

/** 사진 후보를 모은다. 대상마다 perSubject장, 전체 max장까지. */
function collectPhotos(
  subjects: { subject: string; photos: string[] }[],
  perSubject: number,
  max: number,
): ImageCandidate[] {
  const out: ImageCandidate[] = [];
  for (const s of subjects) {
    for (const url of s.photos.filter(isUrl).slice(0, perSubject)) {
      if (out.length >= max) return out;
      out.push({ id: `img${out.length + 1}`, url, kind: "photo", subject: s.subject });
    }
  }
  return out;
}

// ── 운전면허PLUS: 학원 ────────────────────────────────────────────────────

const ACADEMY_KIND: Record<string, string> = { exam_academy: "전문학원", academy: "일반학원" };

/** 학원 자료가 필요한 글 유형. 시험·시험장·면허 관리 글에는 학원 목록을 넣지 않는다. */
const ACADEMY_TYPES = new Set([
  "academy",
  "recommend",
  "cost",
  "review",
  "training",
  "tips",
  "guide",
]);

function academyLine(a: Academy, training: boolean): string {
  const lines = [`■ ${a.name} (${ACADEMY_KIND[a.type] ?? a.type})`, `  주소: ${a.address}`];
  if (a.licenseTypes.length) lines.push(`  교육 면허: ${a.licenseTypes.join(", ")}`);
  const f = a.officialFees;
  if (f && !training) {
    const parts = [
      f.type1Manual && `1종 보통(수동) ${won(f.type1Manual)}`,
      f.type1Auto && `1종 보통(자동) ${won(f.type1Auto)}`,
      f.type2Auto && `2종 보통(자동) ${won(f.type2Auto)}`,
    ].filter(Boolean);
    lines.push(
      `  공시 수강료(${f.period}, ${f.examFeeIncluded ? "검정료 포함" : "검정료 별도"}, ${vatLabel(f.vatIncluded)}): ${parts.join(" / ")}`,
    );
  }
  const prices = a.prices
    .filter((p) =>
      training ? p.courseType === "driving_training" : p.courseType !== "driving_training",
    )
    .slice(0, 4);
  for (const p of prices) {
    const extra = [
      vatLabel(p.vatIncluded),
      p.examFeeIncluded === false ? "검정료 별도" : p.examFeeIncluded ? "검정료 포함" : "",
      `${day(p.collectedAt)} 확인`,
    ]
      .filter(Boolean)
      .join(", ");
    lines.push(`  안내 가격: ${p.label || p.licenseType} ${won(p.amount)} (${extra})`);
  }
  if (a.hours.length) lines.push(`  운영 시간: ${a.hours.slice(0, 7).join(", ")}`);
  if (a.shuttles.length) {
    lines.push(
      `  셔틀: ${a.shuttles.map((s) => [s.title, s.direction].filter(Boolean).join(" ")).join(" / ")}`,
    );
  }
  if (a.roadCourses.length) lines.push(`  도로주행 코스 안내: ${a.roadCourses.length}개`);
  for (const r of a.reviews.filter((r) => isMeaningfulReview(r.content)).slice(0, 2)) {
    lines.push(
      `  수강생 후기${r.point ? `(${r.point}점)` : ""}: "${cut(r.content.replace(/\s+/g, " "), 140)}"`,
    );
  }
  return lines.join("\n");
}

export function academyFacts(
  academies: Academy[],
  topic: Topic,
): Pick<Facts, "text" | "candidates" | "images"> {
  if (!ACADEMY_TYPES.has(topic.articleType)) {
    return { text: "", candidates: [], images: [] };
  }
  const training = topic.articleType === "training";
  const schools = academies.filter((a) => a.type in ACADEMY_KIND);
  const withTraining = (a: Academy) => a.prices.some((p) => p.courseType === "driving_training");

  if (topic.region) {
    const local = schools
      .filter((a) => inRegion(a.address, topic.region))
      .filter((a) => !training || withTraining(a))
      .sort((a, b) => b.reviews.length - a.reviews.length)
      .slice(0, 6);
    if (!local.length) {
      return {
        text: "이 지역에서 확인된 학원 자료가 없습니다. 특정 학원 이름·가격을 쓰지 말고 학원을 고르는 기준 중심으로 쓰세요.",
        candidates: [],
        images: [],
      };
    }
    return {
      text: [
        `이 지역에서 확인된 학원 ${local.length}곳 (이 외 학원은 언급하지 마세요)`,
        ...local.map((a) => academyLine(a, training)),
      ].join("\n\n"),
      candidates: local.map((a) => a.name),
      images: collectPhotos(
        local.map((a) => ({ subject: `${a.name} 사진`, photos: a.photos })),
        1,
        4,
      ),
    };
  }

  // 지역이 없는 주제: 개별 학원 대신 전국 집계 (특정 학원 사진은 쓰지 않는다)
  const lines = [
    `전국 등록 학원: 전문학원 ${schools.filter((a) => a.type === "exam_academy").length}곳, 일반학원 ${schools.filter((a) => a.type === "academy").length}곳`,
  ];
  const fees = schools.map((a) => a.officialFees).filter((f) => f !== undefined);
  const periodCount = new Map<string, number>();
  for (const f of fees) periodCount.set(f.period, (periodCount.get(f.period) ?? 0) + 1);
  const period = [...periodCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  // 공시 수강료의 부가세 표기가 학원마다 다를 수 있어 가장 많은 쪽을 적고 섞여 있으면 알린다
  const vatValues = new Set(fees.map((f) => f.vatIncluded));
  const vat = vatValues.size === 1 ? vatLabel([...vatValues][0]) : "부가세 포함 여부 학원마다 다름";
  for (const [key, label] of [
    ["type2Auto", "2종 보통(자동)"],
    ["type1Auto", "1종 보통(자동)"],
    ["type1Manual", "1종 보통(수동)"],
  ] as const) {
    const xs = fees.map((f) => f[key]).filter((x): x is number => typeof x === "number" && x > 0);
    const m = median(xs);
    if (m && xs.length >= 5) {
      lines.push(
        `공시 수강료 ${label} (${period}, ${xs.length}곳, ${vat}): 최저 ${won(Math.min(...xs))}, 중간값 ${won(m)}, 최고 ${won(Math.max(...xs))}`,
      );
    }
  }
  const trainingPrices = schools.flatMap((a) =>
    a.prices.filter((p) => p.courseType === "driving_training"),
  );
  if (trainingPrices.length >= 5) {
    const tVat = new Set(trainingPrices.map((p) => p.vatIncluded));
    lines.push(
      `학원 연수 안내 가격 (${schools.filter(withTraining).length}곳, ${tVat.size === 1 ? vatLabel([...tVat][0]) : "부가세 포함 여부 학원마다 다름"}): 중간값 ${won(median(trainingPrices.map((p) => p.amount))!)} (과정·시간이 학원마다 다름)`,
    );
  }
  return { text: lines.join("\n"), candidates: [], images: [] };
}

// ── 드라이빙존: 지점·요금제 ───────────────────────────────────────────────

function storeLine(s: Store, detail: boolean, reviewFor: "license" | "training"): string {
  const head = `■ 드라이빙존 ${s.name} (${s.type === "direct" ? "직영" : "가맹"}) — ${s.address}${s.locationHint ? ` (${s.locationHint})` : ""}`;
  if (!detail) return head;
  const lines = [head];
  if (s.hours.length)
    lines.push(`  운영 시간: ${s.hours.join(", ")}${s.hoursNote ? ` (${s.hoursNote})` : ""}`);
  if (s.subways.length) lines.push(`  교통: ${s.subways.join(" / ")}`);
  if (s.keywordTags.length) lines.push(`  특징: ${s.keywordTags.join(", ")}`);
  const machines = [
    s.machines.class1 && `1종 ${s.machines.class1}대`,
    s.machines.class2 && `2종 ${s.machines.class2}대`,
  ].filter(Boolean);
  if (machines.length) lines.push(`  연습 장비: ${machines.join(", ")}`);
  if (s.passRate) lines.push(`  합격률: ${s.passRate}%`);
  if (s.averageDurationDays) lines.push(`  평균 취득 기간: ${s.averageDurationDays}일`);
  if (s.convenience) lines.push(`  편의시설: ${s.convenience}`);
  const certified = s.instructors.filter((i) => i.certifications.length).length;
  if (certified) lines.push(`  자격 보유 강사: ${certified}명`);
  const reviews = s.reviews
    .filter((r) => (reviewFor === "training" ? r.forTraining : r.forLicense))
    .filter((r) => isMeaningfulReview(r.text))
    .slice(0, 2);
  for (const r of reviews) lines.push(`  수강생 후기: "${cut(r.text.replace(/\s+/g, " "), 140)}"`);
  return lines.join("\n");
}

function pricingLines(title: string, plans: PricingPlan[]): string[] {
  if (!plans.length) return [];
  return [
    `${title} (모든 금액 ${vatLabel(DRIVINGZONE_PRICE_VAT_INCLUDED)}, 괄호는 할인 전 정가)`,
    ...plans.map(
      (p) =>
        `- ${p.group} · ${p.name}: ${p.options
          .map(
            (o) =>
              `${o.label ? `${o.label} ` : ""}${won(o.price)}${o.originPrice && o.originPrice > o.price ? `(정가 ${won(o.originPrice)})` : ""}`,
          )
          .join(" / ")}`,
    ),
  ];
}

/**
 * 매장 사진을 본문 어디에나 써도 자연스러운 글 유형(요금제·매장을 직접 소개하는 글).
 * 그 밖의 유형에서는 매장 사진을 드라이빙존 안내 섹션에만 쓰고, 본문 이미지는 주제 삽화로 채운다.
 */
const DRIVINGZONE_PHOTO_ANYWHERE_TYPES = new Set(["cost", "recommend"]);

export function drivingzoneFacts(
  stores: Store[],
  pricing: Partial<Record<PricingCategory, PricingPlan[]>>,
  topic: Topic,
  channel: ChannelDef,
): Pick<Facts, "text" | "candidates" | "images"> {
  const reviewFor =
    channel.id === "dztraining-blog" || topic.articleType === "training" ? "training" : "license";
  const direct = stores.filter((s) => s.type === "direct").length;
  const parts: string[] = [
    `드라이빙존 실내운전연습장 지점 ${stores.length}곳 (직영 ${direct}곳, 가맹 ${stores.length - direct}곳)`,
  ];
  // 드라이빙존 채널은 지역 글을 쓰지 않는다(channels.ts regional=false). 이 채널에 맞는 후기가
  // 많은 지점을 대표로 보여 주고, 전체 지점 목록을 함께 준다.
  const relevant = (s: Store) =>
    s.reviews.filter((r) => (reviewFor === "training" ? r.forTraining : r.forLicense)).length;
  const detailed = [...stores].sort((a, b) => relevant(b) - relevant(a)).slice(0, 3);
  parts.push(
    "대표 지점 상세:",
    ...detailed.map((s) => storeLine(s, true, reviewFor)),
    "전체 지점 목록:",
    ...stores.map((s) => storeLine(s, false, reviewFor)),
  );
  parts.push(
    ...pricingLines("면허 취득 요금제", pricing.license ?? []),
    ...pricingLines("운전연수 요금제", pricing.training ?? []),
  );
  return {
    text: parts.join("\n"),
    candidates: stores.map((s) => s.name),
    images: drivingzonePhotos(detailed, topic.articleType),
  };
}

function drivingzonePhotos(stores: Store[], articleType: string): ImageCandidate[] {
  const subjects = stores.map((s) => ({
    subject: `드라이빙존 ${s.name} 매장 사진`,
    photos: s.photos,
  }));
  if (DRIVINGZONE_PHOTO_ANYWHERE_TYPES.has(articleType)) return collectPhotos(subjects, 2, 4);
  const mention = ["드라이빙존", ...stores.map((s) => s.name)];
  return collectPhotos(subjects, 1, 2).map((i) => ({ ...i, sectionMustMention: mention }));
}

// ── 조립 ─────────────────────────────────────────────────────────────────

export async function buildFacts(
  db: Database,
  sources: AppConfig["sources"],
  topic: Topic,
  channel: ChannelDef,
): Promise<Facts> {
  const warnings: string[] = [];
  const times: string[] = [];
  let body: Pick<Facts, "text" | "candidates" | "images">;

  if (channel.brand === "drivingplus") {
    const academies = await fetchAcademies(db, sources);
    times.push(academies.fetchedAt);
    if (academies.staleReason)
      warnings.push(`학원 자료 갱신 실패, 이전 자료 사용: ${academies.staleReason}`);
    body = academyFacts(academies.value, topic);
  } else {
    const categories: PricingCategory[] =
      channel.id === "dztraining-blog"
        ? ["training"]
        : channel.id === "drivingzone-blog"
          ? ["license"]
          : ["license", "training"];
    const [stores, ...prices] = await Promise.all([
      fetchStores(db, sources),
      ...categories.map((c) => fetchPricing(db, sources, c)),
    ]);
    times.push(stores.fetchedAt, ...prices.map((p) => p.fetchedAt));
    for (const r of [stores, ...prices]) {
      if (r.staleReason)
        warnings.push(`드라이빙존 자료 갱신 실패, 이전 자료 사용: ${r.staleReason}`);
    }
    const pricing = Object.fromEntries(categories.map((c, i) => [c, prices[i]?.value ?? []]));
    body = drivingzoneFacts(stores.value, pricing, topic, channel);
  }

  const asOf = times.sort()[0] ?? new Date().toISOString();
  return {
    text: body.text ? `자료 기준일: ${day(asOf)}\n${body.text}` : "",
    candidates: body.candidates,
    images: body.images,
    asOf,
    warnings,
  };
}
