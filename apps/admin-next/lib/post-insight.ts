import { api } from "@/lib/api";

// 「이 글이 무엇을 근거로 썼나」. lib/api.ts 에 넣지 않은 이유는 그 파일을 여러 세션이
// 동시에 만지기 때문이다 — 읽기 전용 한 갈래라 섞을 이유도 없다.

export interface PostInsight {
  post_id: string;
  /** 생성 시점 근거가 저장돼 있나. 옛 글은 false — 재계산하면 그때와 다른 값이 나온다. */
  has_snapshot: boolean;
  used: { academies: number; quotes: number; images: number; chars: number };
  /** 프롬프트로 나갔지만 본문이 안 쓴 조사 근거. */
  unused: Array<{ academy: string; label: string; value: string }>;
  /** 「검토 필요」라 애초에 나가지 못한 값. 이쪽이 진짜 아쉬운 자리다. */
  blocked: Array<{ academy: string; field: string; label: string; value: string; note: string }>;
}

export const getPostInsight = (postId: string) =>
  api<PostInsight>(`/post-insight/${encodeURIComponent(postId)}`);
