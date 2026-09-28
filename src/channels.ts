// 발행 채널과 채널별 섹션(게시판) 정의.
// 섹션을 추가할 때는 해당 채널의 sections 배열에 항목 하나만 더하면 된다.

/** 채널별 출력 형식. drivingplus는 Markdown, drivingzone 계열은 에디터 HTML, 카페는 붙여넣기용 원고. */
export type OutputFormat = "markdown" | "html" | "cafe-text";

/** 작성 가이드(guides/<brand>.md)를 공유하는 운영 브랜드. */
export const BRANDS = ["drivingplus", "drivingzone"] as const;
export type BrandId = (typeof BRANDS)[number];

export interface SectionDef {
  /** 대상 시스템의 섹션/게시판 코드 (community_section.code, article board type 등). */
  code: string;
  label: string;
  /** 이 섹션에 배정할 주제 영역. 주제 배정과 프롬프트에 쓴다. */
  focus: string[];
}

export interface ChannelDef {
  id: string;
  brand: BrandId;
  label: string;
  /** 공개 사이트 주소. 카페처럼 사이트가 없으면 빈 문자열. */
  siteUrl: string;
  format: OutputFormat;
  /** 채널 전체 주제 영역. */
  focus: string[];
  /** 지역·학원 단위 노출 대상(audience)을 지정할 수 있는 채널인가. */
  supportsAudience: boolean;
  sections: SectionDef[];
}

export const CHANNELS = [
  {
    id: "drivingplus-community",
    brand: "drivingplus",
    label: "운전면허PLUS 커뮤니티",
    siteUrl: "https://app.drivingplus.me/community",
    format: "markdown",
    focus: ["운전학원 찾기·비교·추천", "운전면허 시험 정보"],
    supportsAudience: true,
    sections: [
      { code: "drive_story", label: "드라이브 스토리", focus: ["운전학원 찾기·비교·추천"] },
      { code: "exam_procedure_guide", label: "시험 절차 안내", focus: ["운전면허 시험 절차"] },
      { code: "test_center_guide", label: "시험장 안내", focus: ["운전면허 시험장 정보"] },
    ],
  },
  {
    id: "drivingzone-blog",
    brand: "drivingzone",
    label: "드라이빙존 블로그",
    siteUrl: "https://drivingzone.co.kr/story/blog",
    format: "html",
    focus: ["운전면허 취득"],
    supportsAudience: false,
    sections: [{ code: "blog", label: "블로그", focus: ["운전면허 취득"] }],
  },
  {
    id: "dztraining-blog",
    brand: "drivingzone",
    label: "드라이빙존 연수 블로그",
    siteUrl: "https://www.dztraining.co.kr/blog",
    format: "html",
    focus: ["장롱면허", "운전 연수"],
    supportsAudience: false,
    sections: [{ code: "blog_training", label: "연수 블로그", focus: ["장롱면허", "운전 연수"] }],
  },
  {
    id: "drivingzone-cafe",
    brand: "drivingzone",
    label: "드라이빙존 카페",
    siteUrl: "",
    format: "cafe-text",
    focus: ["운전면허 취득", "장롱면허", "운전 연수"],
    supportsAudience: false,
    sections: [
      { code: "cafe", label: "카페 원고", focus: ["운전면허 취득", "장롱면허", "운전 연수"] },
    ],
  },
] as const satisfies readonly ChannelDef[];

export type ChannelId = (typeof CHANNELS)[number]["id"];

export function findChannel(id: string): ChannelDef | undefined {
  return CHANNELS.find((c) => c.id === id);
}

export function findSection(channelId: string, sectionCode: string): SectionDef | undefined {
  return findChannel(channelId)?.sections.find((s) => s.code === sectionCode);
}
