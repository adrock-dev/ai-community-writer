import type { AppConfig } from "../config.ts";
import type { Database } from "../db/database.ts";
import { type Cached, cached, getData } from "./http.ts";

// api.drivingzone 지점(실내운전연습장) 데이터. `GET /v1/store`(목록) + `GET /v1/store/:id`(상세).
// 공개 API 응답에 대표자명·사업자번호·SMS 수신 번호 같은 비공개 정보가 섞여 있으므로
// 허용한 필드만 옮긴다(화이트리스트). 강사는 이름을 빼고 직급·소개·자격만 쓴다.

export interface Store {
  id: number;
  /** 지점명 (예: 강남역점). 브랜드명은 붙이지 않는다. */
  name: string;
  /** direct(직영) / chain(가맹) */
  type: string;
  address: string;
  /** 예: 삼성역 1번 출구에서 422m */
  locationHint: string;
  lat: number | null;
  lng: number | null;
  phone: string;
  naverUrl: string;
  openingDate: string;
  convenience: string;
  paymentInfo: string;
  keywordTags: string[];
  /** 값이 0이면 미집계로 보고 null. */
  passRate: number | null;
  averageDurationDays: number | null;
  cumulativeSignups: number | null;
  maxCapacity: number | null;
  machines: { class1: number | null; class2: number | null };
  hours: string[];
  hoursNote: string;
  subways: string[];
  instructors: { position: string; intro: string; licenses: string[]; certifications: string[] }[];
  reviews: { text: string; forLicense: boolean; forTraining: boolean; date: string }[];
  photos: string[];
}

const DAY_LABEL: Record<string, string> = {
  MON: "월",
  TUE: "화",
  WED: "수",
  THU: "목",
  FRI: "금",
  SAT: "토",
  SUN: "일",
};

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown) => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};
const positive = (v: unknown) => {
  const n = num(v);
  return n && n > 0 ? n : null;
};
const decode = (v: unknown) => {
  const s = str(v);
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};
const hhmm = (t: unknown) => str(t).slice(0, 5);

export function normalizeStore(raw: any): Store | undefined {
  const id = num(raw?.id);
  const name = str(raw?.name);
  if (id === null || !name || (raw.status && raw.status !== "enable")) return undefined;
  return {
    id,
    name,
    type: str(raw.type),
    address: str(raw.roadAddress) || str(raw.address),
    locationHint: str(raw.summaryAddress),
    lat: num(raw.latitude),
    lng: num(raw.longitude),
    phone: str(raw.phoneNumber),
    naverUrl: decode(raw.naverUrl),
    openingDate: str(raw.openingDate),
    convenience: str(raw.convenience),
    paymentInfo: str(raw.paymentInfo),
    keywordTags: str(raw.keywordTags)
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    passRate: positive(raw.passRate),
    averageDurationDays: positive(raw.averageDurationDays),
    cumulativeSignups: positive(raw.cumulativeSignups),
    maxCapacity: positive(raw.maxCapacity),
    machines: { class1: num(raw.machineCountClass1), class2: num(raw.machineCountClass2) },
    hours: (raw.weeklyHours ?? []).map(
      (h: any) =>
        `${DAY_LABEL[str(h?.dayOfWeek)] ?? str(h?.dayOfWeek)} ${hhmm(h?.openTime)}~${hhmm(h?.closeTime)}`,
    ),
    hoursNote: str(raw.operatingHoursNote),
    subways: (raw.subways ?? []).map((s: any) => str(s?.detail)).filter(Boolean),
    instructors: (raw.instructors ?? []).map((i: any) => ({
      position: str(i?.position),
      intro: str(i?.intro),
      licenses: str(i?.licenses)
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean),
      certifications: [
        i?.isAcademicInstructorCertified ? "학과 강사" : "",
        i?.isPracticalInstructorCertified ? "기능 강사" : "",
        i?.isExaminerCertified ? "기능검정원" : "",
      ].filter(Boolean),
    })),
    reviews: (raw.reviews ?? [])
      .filter((r: any) => str(r?.reviewText))
      .map((r: any) => ({
        text: str(r.reviewText),
        forLicense: Boolean(r.isLicense),
        forTraining: Boolean(r.isTraining),
        date: str(r.createdAt).slice(0, 10),
      })),
    photos: (raw.photoPaths ?? (raw.photoPath ? [raw.photoPath] : [])).filter(
      (p: unknown) => typeof p === "string",
    ),
  };
}

export async function fetchStores(
  db: Database,
  sources: AppConfig["sources"],
): Promise<Cached<Store[]>> {
  const base = `${sources.drivingzoneApi}/v1/store`;
  return cached(
    db,
    `drivingzone:stores:${sources.drivingzoneApi}`,
    sources.cacheTtlHours * 3_600_000,
    async () => {
      const list = await getData<{ stores?: { id: number }[] }>(
        `${base}?limit=1000`,
        sources.timeoutSec,
      );
      const stores: Store[] = [];
      // 목록에는 후기·운영시간·강사가 없어 지점별 상세를 받는다 (지점 수가 적어 순차 처리).
      for (const { id } of list.stores ?? []) {
        const detail = await getData<unknown>(`${base}/${id}`, sources.timeoutSec);
        const store = normalizeStore(detail);
        if (store) stores.push(store);
      }
      return stores;
    },
  );
}
