import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * 관리자 화면에 띄우는 가이드 문서 목록.
 *
 * **문서 내용을 여기 복사하지 않는다.** 저장소의 `docs/*.md` 를 그대로 읽어 렌더한다 —
 * 복사하는 순간 두 벌이 되고, 코드를 고칠 때 한쪽만 낡는다(이 저장소가 화면 안내멘트에서
 * 이미 겪은 문제다). 단일 소스이므로 `npm run verify:doc-sync` 가 이 화면까지 함께 지켜 준다.
 *
 * 여기 없는 문서는 화면에 뜨지 않는다. `CLAUDE.md`·`HANDOFF.md` 처럼 저장소를 여는 사람
 * 대상 문서는 일부러 뺐다 — 운영자가 볼 자리가 아니고, 코드 경로 서술이 대부분이다.
 */
export type GuideMeta = {
  slug: string;
  title: string;
  file: string;
  audience: "운영자" | "개발자";
  summary: string;
};

export const GUIDES: GuideMeta[] = [
  {
    slug: "admin-ui",
    title: "관리자 화면 안내",
    file: "docs/admin-ui-guide.md",
    audience: "운영자",
    summary: "메뉴·탭·영역이 각각 무엇을 하는 곳인지, 어떤 순서로 쓰는지.",
  },
  {
    slug: "generation-prompt",
    title: "글 생성 프롬프트 안내",
    file: "docs/generation-prompt-guide.md",
    audience: "개발자",
    summary: "프롬프트가 어떤 층으로 조립되는지와, 무엇을 고치면 글이 달라지는지.",
  },
];

export const findGuide = (slug: string): GuideMeta | undefined => GUIDES.find((g) => g.slug === slug);

/**
 * 저장소 루트 기준으로 문서를 읽는다.
 *
 * Next 는 `apps/admin-next` 에서 도므로 두 단계 위가 저장소 루트다. 배포 이미지에 `docs/` 가
 * 빠지면 문서만 안 뜨고 화면은 살아 있어야 하므로, 없을 때는 예외 대신 null 을 돌려준다.
 */
export function readGuide(meta: GuideMeta): string | null {
  const path = join(process.cwd(), "..", "..", meta.file);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}
