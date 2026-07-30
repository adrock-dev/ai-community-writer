export type DomainMenuFrom = "manage" | "generate" | "review" | "jobs";

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
  jobs: {
    menu: "작업 큐",
    title: "작업 큐를 보려면 운영 도메인이 필요합니다",
    body: "작업은 도메인에 등록됩니다. 도메인을 만들고 글 작성을 등록하면 이 화면에서 진행 상태를 확인할 수 있습니다.",
  },
};

export function isDomainMenuFrom(value: string | null): value is DomainMenuFrom {
  return value === "manage" || value === "generate" || value === "review" || value === "jobs";
}

export function needDomainHref(from: DomainMenuFrom) {
  return `/need-domain?from=${from}`;
}
