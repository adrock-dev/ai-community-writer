import type { AppConfig } from "../config.ts";
import type { Database } from "../db/database.ts";
import { type Cached, cached, getData } from "./http.ts";

// api.drive 학원 데이터. `GET /v1/academy/get-all-academy`는 LLM 콘텐츠용으로 만든 공개 API로,
// 실내운전연습장(indoor_academy)까지 모든 유형을 사진·후기·수강료·셔틀·운영시간과 함께 준다.
// 글 근거로 쓸 필드만 골라 정규화한다. 학원의 SEO 문구(seo*, seoContent)는 우리가 만든 홍보 문구라
// 근거 자료로 쓰지 않는다.

export const ACADEMY_TYPES = [
  "academy",
  "exam_academy",
  "license_test_course",
  "indoor_academy",
  "license_center",
] as const;
export type AcademyType = (typeof ACADEMY_TYPES)[number];

export interface AcademyPrice {
  label: string;
  licenseType: string;
  /** license_acquisition(면허 취득) / driving_training(연수) */
  courseType: string;
  amount: number;
  amountMax?: number;
  vatIncluded: boolean | null;
  examFeeIncluded: boolean | null;
  source: string;
  collectedAt: string;
}

export interface Academy {
  id: number;
  name: string;
  type: AcademyType | string;
  address: string;
  lat: number | null;
  lng: number | null;
  phone: string;
  naverPlaceUrl: string;
  licenseTypes: string[];
  prices: AcademyPrice[];
  /** 도로교통공단 교육실적 공시 수강료 (분기 기준). */
  officialFees?: {
    period: string;
    type1Manual: number | null;
    type1Auto: number | null;
    type2Auto: number | null;
    vatIncluded: boolean;
    examFeeIncluded: boolean;
  };
  capacity: number | null;
  graduates: number | null;
  hours: string[];
  hoursNotice: string;
  shuttles: { title: string; direction: string; content: string }[];
  shuttleSummary: string;
  roadCourses: string[];
  reviews: { point: number | null; content: string; date: string }[];
  photos: string[];
}

const DAYS = [
  ["mon", "월"],
  ["tue", "화"],
  ["wed", "수"],
  ["thu", "목"],
  ["fri", "금"],
  ["sat", "토"],
  ["sun", "일"],
  ["holiday", "공휴일"],
] as const;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function hoursOf(oh: any): string[] {
  if (!oh || typeof oh !== "object") return [];
  const lines: string[] = [];
  for (const [key, label] of DAYS) {
    if (oh[`${key}IsHoliday`]) lines.push(`${label} 휴무`);
    else if (oh[`${key}OpenTime`] && oh[`${key}CloseTime`]) {
      lines.push(`${label} ${oh[`${key}OpenTime`]}~${oh[`${key}CloseTime`]}`);
    }
  }
  return lines;
}

export function normalizeAcademy(raw: any): Academy | undefined {
  const id = num(raw?.id);
  const name = str(raw?.title);
  if (id === null || !name) return undefined;
  const edu = raw.educationPerformance;
  const fees = edu?.fees;
  const hasFees = fees && [fees.type1Manual, fees.type1Auto, fees.type2Auto].some((v) => v);
  return {
    id,
    name,
    type: str(raw.type),
    address: str(raw.roadAddress),
    lat: num(raw.roadLatitude),
    lng: num(raw.roadLongitude),
    phone: str(raw.vphone) || str(raw.phone),
    naverPlaceUrl: str(raw.naverPlaceUrl),
    licenseTypes: (raw.licenseTypes ?? []).map((l: any) => str(l?.label)).filter(Boolean),
    prices: (raw.priceObservations ?? [])
      .filter((p: any) => num(p?.amount) && p.confidence !== "low")
      .map(
        (p: any): AcademyPrice => ({
          label: str(p.rawLabel),
          licenseType: str(p.licenseType),
          courseType: str(p.courseType),
          amount: p.amount,
          amountMax: num(p.amountMax) ?? undefined,
          vatIncluded: typeof p.vatIncluded === "boolean" ? p.vatIncluded : null,
          examFeeIncluded: typeof p.examFeeIncluded === "boolean" ? p.examFeeIncluded : null,
          source: str(p.source),
          collectedAt: str(p.collectedAt),
        }),
      ),
    officialFees: hasFees
      ? {
          period: `${edu.year}년 ${edu.quarter}분기`,
          type1Manual: num(fees.type1Manual),
          type1Auto: num(fees.type1Auto),
          type2Auto: num(fees.type2Auto),
          vatIncluded: Boolean(fees.vatIncluded),
          examFeeIncluded: Boolean(fees.examFeeIncluded),
        }
      : undefined,
    capacity: num(edu?.capacity),
    graduates: num(edu?.graduates),
    hours: hoursOf(raw.operateHour),
    hoursNotice: str(raw.operateHour?.notice),
    shuttles: (raw.shuttleBuses ?? []).map((s: any) => ({
      title: str(s?.title),
      direction: str(s?.runDirection),
      content: str(s?.content),
    })),
    shuttleSummary: str(raw.shuttleBusDetail),
    roadCourses: (raw.roadCourses ?? []).map((c: any) => str(c?.title)).filter(Boolean),
    reviews: (raw.reviews ?? [])
      .filter((r: any) => str(r?.content))
      .map((r: any) => ({ point: num(r.point), content: str(r.content), date: str(r.date) })),
    photos: (raw.photos ?? []).filter((p: unknown) => typeof p === "string"),
  };
}

export async function fetchAcademies(
  db: Database,
  sources: AppConfig["sources"],
): Promise<Cached<Academy[]>> {
  const url = `${sources.drivingplusApi}/v1/academy/get-all-academy`;
  return cached(
    db,
    `drivingplus:academies:${sources.drivingplusApi}`,
    sources.cacheTtlHours * 3_600_000,
    async () => {
      const rows = await getData<unknown[]>(url, sources.timeoutSec);
      if (!Array.isArray(rows)) throw new Error(`${url} 응답 data가 배열이 아닙니다`);
      return rows.map(normalizeAcademy).filter((a): a is Academy => Boolean(a));
    },
  );
}
