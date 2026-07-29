export type DomainMenuFrom = "manage" | "generate" | "review";

export const DOMAIN_GATE_COPY: Record<DomainMenuFrom, { menu: string; title: string; body: string }> = {
  manage: {
    menu: "도메인 관리",
    title: "도메인 관리를 하려면 운영 도메인이 필요합니다",
    body: "사이트 도메인을 먼저 등록하면 기획, 축, 후보, 설정을 관리할 수 있습니다.",
  },
  generate: {
    menu: "글 생성",
    title: "글 생성을 하려면 운영 도메인이 필요합니다",
    body: "도메인을 만든 뒤 원천 데이터 동기화 → 후보 생성 → 테스트 작성 순서로 진행하세요.",
  },
  review: {
    menu: "검수·보내기",
    title: "검수·보내기를 하려면 운영 도메인이 필요합니다",
    body: "도메인을 만든 뒤 생성된 글을 미리보기, export, 색인 요청으로 마무리할 수 있습니다.",
  },
};

export function isDomainMenuFrom(value: string | null): value is DomainMenuFrom {
  return value === "manage" || value === "generate" || value === "review";
}

export function needDomainHref(from: DomainMenuFrom) {
  return `/need-domain?from=${from}`;
}
