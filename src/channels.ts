// 발행 채널과 채널별 섹션(게시판) 정의.
// 섹션을 추가할 때는 해당 채널의 sections 배열에 항목 하나만 더하면 된다.

/** 채널별 출력 형식. drivingplus는 Markdown, drivingzone 계열은 에디터 HTML, 카페는 붙여넣기용 원고. */
export type OutputFormat = "markdown" | "html" | "cafe-text";

/** 유의사항을 공유하는 운영 브랜드. 주제 감점·유사도 기준도 브랜드 단위로 본다. */
export const BRANDS = ["drivingplus", "drivingzone"] as const;
export type BrandId = (typeof BRANDS)[number];

/**
 * 섹션 안의 칸(필터) 배정 규칙. 운전면허PLUS `community_filter.code` 에 대응한다.
 * 위에서부터 보고 처음 맞는 규칙을 쓴다. `types`·`keywords` 가 모두 없으면 기본 칸이다.
 */
export interface SectionFilterRule {
  code: string;
  label: string;
  /** 이 글 유형이면 이 칸 */
  types?: readonly string[];
  /** 대표 키워드에 이 단어가 있으면 이 칸 */
  keywords?: readonly string[];
}

export interface SectionDef {
  /** 대상 시스템의 섹션/게시판 코드 (community_section.code, article board type 등). */
  code: string;
  label: string;
  /** 이 섹션에 배정할 주제 영역. 주제 배정과 프롬프트에 쓴다. */
  focus: string[];
  /** 칸(필터) 배정 규칙. 대상 시스템에 칸이 없으면 생략. */
  filters?: readonly SectionFilterRule[];
}

/** 품질 게이트 기준. 본문 글자 수는 Markdown 기호를 뺀 글자 기준. */
export interface ChannelQuality {
  minChars: number;
  maxChars: number;
  minH2: number;
  requireFaq: boolean;
  requireTable: boolean;
  /** 본문 이미지 최소 장수 */
  minImages: number;
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
  /**
   * 지역 기반 글을 쓰는 채널인가. 켜면 지역 키워드("강남운전연수")를 지역 주제로 만들고,
   * 근거 자료를 그 지역으로 좁히고, 발행 때 노출 대상(audience)을 지역으로 지정한다.
   * 끄면 지역 키워드는 주제 후보에서 뺀다. 운전면허PLUS 커뮤니티만 켠다(2026-09-28 결정).
   */
  regional: boolean;
  /**
   * 자동 발행 대상. community = api.drive 커뮤니티(섹션·칸), blog = api.drivingzone 게시판
   * (섹션 코드 = board type), none = 원고만(카페).
   */
  autoPublish: "community" | "blog" | "none";
  /**
   * 색 강조(`==문구==`)의 글자색. 사이트 브랜드 색(web.* globals.css)을 쓴다.
   * 빈 문자열이면 굵게로 바꾼다(운전면허PLUS는 Markdown 이라 색을 표현하지 않는다).
   */
  highlightColor: string;
  quality: ChannelQuality;
  sections: SectionDef[];
}

export const CHANNELS = [
  {
    id: "drivingplus-community",
    brand: "drivingplus",
    label: "운전면허PLUS 커뮤니티",
    siteUrl: "https://app.drivingplus.me/community",
    format: "markdown",
    focus: ["운전학원 찾기·비교·추천", "학원 연수", "운전면허 시험 정보"],
    regional: true,
    autoPublish: "community",
    highlightColor: "",
    quality: {
      minChars: 1800,
      maxChars: 4200,
      minH2: 3,
      requireFaq: true,
      requireTable: true,
      minImages: 2,
    },
    sections: [
      {
        code: "drive_story",
        label: "운전이야기",
        focus: ["운전학원 찾기·비교·추천·비용", "학원 연수(장롱면허·초보운전)"],
        filters: [{ code: "driving_info", label: "운전정보" }],
      },
      {
        code: "exam_procedure_guide",
        label: "시험절차&안내",
        focus: ["운전면허 시험 절차", "면허 종류"],
        filters: [
          { code: "theory_exam", label: "학과시험", keywords: ["필기", "학과"] },
          { code: "skill_test", label: "기능시험", keywords: ["기능", "장내"] },
          { code: "road_test", label: "도로주행", keywords: ["도로주행"] },
          { code: "examinee_guide", label: "응시안내" },
        ],
      },
      {
        // 시험장·면허 업무 글. 시험장 안내 탭(test_center_guide)은 글이 아니라 시험장 목록이라
        // 글을 올려도 보이지 않는다 — 취득꿀팁에 칸 두 개를 더해 올린다(2026-09-28 결정).
        code: "license_tips",
        label: "취득꿀팁",
        focus: ["운전면허 시험장 정보", "면허 업무(적성검사·갱신·재발급)"],
        filters: [
          {
            code: "test_center",
            label: "시험장",
            types: ["test_center"],
            keywords: ["시험장"],
          },
          { code: "license_care", label: "면허관리" },
        ],
      },
    ],
  },
  {
    id: "drivingzone-blog",
    brand: "drivingzone",
    label: "드라이빙존 블로그",
    siteUrl: "https://drivingzone.co.kr/story/blog",
    format: "html",
    focus: ["운전면허 취득"],
    regional: false,
    autoPublish: "blog",
    // web.drivingzone --color-main-orange
    highlightColor: "#ff5500",
    quality: {
      minChars: 2200,
      maxChars: 5000,
      minH2: 4,
      requireFaq: true,
      requireTable: true,
      minImages: 2,
    },
    sections: [{ code: "blog", label: "블로그", focus: ["운전면허 취득"] }],
  },
  {
    id: "dztraining-blog",
    brand: "drivingzone",
    label: "드라이빙존 연수 블로그",
    siteUrl: "https://www.dztraining.co.kr/blog",
    format: "html",
    focus: ["장롱면허", "운전 연수"],
    regional: false,
    autoPublish: "blog",
    // web.dztraining --color-main-blue
    highlightColor: "#1474fa",
    quality: {
      minChars: 2200,
      maxChars: 5000,
      minH2: 4,
      requireFaq: true,
      requireTable: false,
      minImages: 2,
    },
    sections: [{ code: "blog_training", label: "연수 블로그", focus: ["장롱면허", "운전 연수"] }],
  },
  {
    id: "drivingzone-cafe",
    brand: "drivingzone",
    label: "드라이빙존 카페",
    siteUrl: "",
    format: "cafe-text",
    focus: ["운전면허 취득", "장롱면허", "운전 연수"],
    regional: false,
    autoPublish: "none",
    // 서식 복사(HTML)용. 카페 텍스트 원고에서는 표시만 걷는다.
    highlightColor: "#ff5500",
    quality: {
      minChars: 800,
      maxChars: 2200,
      minH2: 0,
      requireFaq: false,
      requireTable: false,
      minImages: 2,
    },
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

/** 글의 칸(필터) 코드. 규칙이 없는 섹션이면 빈 배열. */
export function resolveFilterCodes(
  section: SectionDef,
  articleType: string,
  primaryKeyword: string,
): string[] {
  const keyword = primaryKeyword.replace(/\s+/g, "");
  const rule = section.filters?.find((r) => {
    if (!r.types && !r.keywords) return true;
    return (
      (r.types?.includes(articleType) ?? false) ||
      (r.keywords?.some((k) => keyword.includes(k)) ?? false)
    );
  });
  return rule ? [rule.code] : [];
}
