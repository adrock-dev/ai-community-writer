/**
 * 발행글 상세용 JSON-LD(구조화 데이터) 생성.
 *
 * schema.org Article + BreadcrumbList 를 @graph 로 묶어 반환한다.
 * - canonical URL 은 사이트 기준(SITE_BASE_URL) + /community/{slug} 로 조립(sitemap 과 동일 패턴).
 * - FAQPage 는 현재 생성 포맷이 Q/A 페어를 강제하지 않아 신뢰성 있게 추출 불가 → 포함하지 않는다.
 * - LocalBusiness 는 posts 응답에 학원 주소/좌표가 없어(이름만) 완전한 노드를 만들 수 없어 생략한다.
 */

import type { PostDetail, SiteConfig } from "./content-api";

const SITE_BASE = (process.env.SITE_BASE_URL ?? "").replace(/\/$/, "");

/** SQLite CURRENT_TIMESTAMP("YYYY-MM-DD HH:MM:SS", UTC) → ISO 8601. 파싱 실패 시 원본 유지. */
function toIso(value: string): string {
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? value : d.toISOString();
}

/**
 * 상세 페이지에 넣을 JSON-LD 객체를 만든다.
 * SITE_BASE_URL 미설정 시 canonical URL 을 조립할 수 없으므로 null 을 반환(주입 생략).
 */
export function buildPostJsonLd(post: PostDetail, site: SiteConfig | null): Record<string, unknown> | null {
  if (!SITE_BASE) return null;
  const url = `${SITE_BASE}/community/${post.slug}`;
  const images = Object.values(post.images ?? {}).filter(Boolean);
  const publisherName = site?.display_name || site?.domain || undefined;
  // author 는 사이트 조직(이름+홈 URL), publisher 는 여기에 로고까지(Article 은 publisher.logo 를 권장).
  // 로고는 site.logo_url 이 설정됐을 때만 넣는다(없으면 생략 — 날조하지 않는다).
  const org = publisherName ? { "@type": "Organization", name: publisherName, ...(SITE_BASE ? { url: SITE_BASE } : {}) } : undefined;
  const publisher = org ? { ...org, ...(site?.logo_url ? { logo: { "@type": "ImageObject", url: site.logo_url } } : {}) } : undefined;

  const article: Record<string, unknown> = {
    "@type": "Article",
    headline: post.title,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    url,
    inLanguage: "ko-KR",
    ...(post.meta_description ? { description: post.meta_description } : {}),
    ...(post.generated_at ? { datePublished: toIso(post.generated_at), dateModified: toIso(post.generated_at) } : {}),
    ...(images.length ? { image: images } : {}),
    ...(post.region ? { articleSection: post.region } : {}),
    ...(org ? { author: org, publisher } : {}),
  };

  const breadcrumb = {
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "홈", item: SITE_BASE },
      { "@type": "ListItem", position: 2, name: "커뮤니티", item: `${SITE_BASE}/community` },
      { "@type": "ListItem", position: 3, name: post.title, item: url },
    ],
  };

  return { "@context": "https://schema.org", "@graph": [article, breadcrumb] };
}
