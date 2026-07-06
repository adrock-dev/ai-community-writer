import type { DesignTemplateId } from "./types";
import { applyBrandToDesignSpec } from "./brand-color";

export interface DesignThemeSpec {
  accent: string;
  soft: string;
  pageBg: string;
  topCta: string;
  bottomCta: string;
  label: string;
}

const BASE_DESIGN_SPECS: Record<DesignTemplateId, DesignThemeSpec> = {
  editorial: { accent: "#5132d7", soft: "#f2efff", pageBg: "#ffffff", topCta: "지금 바로 비교·예약", bottomCta: "상담/예약하러 가기", label: "브랜드 매거진" },
  comparison: { accent: "#2563eb", soft: "#dbeafe", pageBg: "#ffffff", topCta: "BEST 한눈에 비교", bottomCta: "내게 맞는 곳 찾기", label: "BEST 비교 블로그" },
  "local-guide": { accent: "#059669", soft: "#dcfce7", pageBg: "#ffffff", topCta: "내 주변에서 찾기", bottomCta: "가까운 곳 예약하기", label: "지역 추천 블로그" },
  checklist: { accent: "#ca8a04", soft: "#fef3c7", pageBg: "#ffffff", topCta: "체크리스트 저장", bottomCta: "준비 시작하기", label: "체크리스트 블로그" },
  conversion: { accent: "#111827", soft: "#ede9fe", pageBg: "#ffffff", topCta: "비용 상담 신청", bottomCta: "지금 예약하기", label: "예약 전환 블로그" },
  custom: { accent: "#5132d7", soft: "#f2efff", pageBg: "#ffffff", topCta: "자세히 보기", bottomCta: "문의하기", label: "커스텀" },
};

export function resolveDesignId(value: string | null | undefined): DesignTemplateId {
  return value && value in BASE_DESIGN_SPECS ? value as DesignTemplateId : "local-guide";
}

export function getDesignTheme(designId: string | null | undefined, brandColor?: string | null): DesignThemeSpec {
  const id = resolveDesignId(designId);
  return applyBrandToDesignSpec(BASE_DESIGN_SPECS[id], brandColor);
}
