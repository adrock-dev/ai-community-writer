import type { Article } from "../articles/store.ts";
import { resolveFilterCodes, type SectionDef } from "../channels.ts";

// 발행 요청 본문 만들기 (순수 함수). 대상 API 계약:
//   api.drive       docs/domains/community/api.md §6.4  PUT /v1/writer/community/posts/:sourceKey
//   api.drivingzone docs/writer-api.md                  PUT /v1/writer/articles/:sourceKey

/** 대상 시스템에 남기는 글 식별자. 설치(로컬 DB)마다 다른 접두어를 붙여 DB끼리 섞이지 않게 한다. */
export function sourceKeyFor(installId: string, articleId: number): string {
  return `aiw-${installId}:${articleId}`.toLowerCase();
}

export interface AudienceArea {
  siDo: string;
  siGunGu?: string;
}

/**
 * 주제 지역 키("인천광역시" / "경기도 고양시 일산동구|경기도 고양시 일산서구") → 노출 대상 지역.
 * 첫 토막이 시도, 나머지가 시군구(두 토막일 수 있다).
 */
export function audienceAreas(regionKey: string): AudienceArea[] {
  return regionKey
    .split("|")
    .map((r) => r.trim().split(/\s+/).filter(Boolean))
    .filter((tokens) => tokens.length > 0)
    .map(([siDo, ...rest]) =>
      rest.length ? { siDo: siDo!, siGunGu: rest.join(" ") } : { siDo: siDo! },
    );
}

/**
 * 드라이빙존·연수 블로그 글 주소의 슬러그. 두 사이트의 `slugify(name, id)`(사이트맵·목록 링크)와
 * 같은 결과여야 한다: encodeURIComponent → 소문자 → `-{id}`.
 */
export function blogSlug(title: string, id: number): string {
  return `${encodeURIComponent(title)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase()}-${id}`;
}

/** 본문 속 이미지 주소를 바꾼다(생성 삽화 `/images/x.png` → 업로드한 공개 주소). */
export function replaceUrls(text: string, map: Map<string, string>): string {
  let out = text;
  for (const [from, to] of map) out = out.split(from).join(to);
  return out;
}

export function communityPayload(input: {
  article: Article;
  section: SectionDef;
  primaryKeyword: string;
  content: string;
  regional: boolean;
  thumbUpfileId?: number;
}) {
  const { article, section } = input;
  return {
    sectionCode: section.code,
    filterCodes: resolveFilterCodes(section, article.articleType, input.primaryKeyword),
    title: article.title,
    summary: article.summary,
    content: input.content,
    contentFormat: "md" as const,
    seoKeywords: article.keywords.join(", "),
    hashtags: article.keywords.slice(0, 5),
    status: "published" as const,
    ...(input.thumbUpfileId ? { listThumbnailUpfileId: input.thumbUpfileId } : {}),
    // 지역 글은 운전면허PLUS(regional 채널)만 — 그 외에는 항상 전국
    audienceAreas: input.regional && article.region ? audienceAreas(article.region) : [],
  };
}

export function blogPayload(input: {
  article: Article;
  contentHtml: string;
  thumbUpfileId?: number;
}) {
  const { article } = input;
  return {
    boardType: article.sectionCode,
    title: article.title,
    subTitle: article.summary,
    keywords: article.keywords.join(", "),
    content: input.contentHtml,
    status: "enable" as const,
    ...(input.thumbUpfileId ? { thumbUpfileId: input.thumbUpfileId } : {}),
  };
}
