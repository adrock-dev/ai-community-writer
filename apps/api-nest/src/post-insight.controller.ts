import { Controller, Get, Headers, HttpException, Inject, Param, Req } from "@nestjs/common";
import type { Request } from "express";
import { checkAuth } from "./admin.controller.js";
import { AcademyResearchDbService } from "./academy-research-db.service.js";
import { DbService } from "./db.service.js";
import { RESEARCH_FIELD_LABEL } from "./academy-research-article-fields.js";

/**
 * 「이 글이 무엇을 근거로 썼나」.
 *
 * 상세 화면은 생성 메타(provider·비용·시각)만 보여줘서, 검수자가 "왜 이 사실이 글에
 * 없지" 를 물어도 답할 데가 없었다. 특히 조사값은 검토 필요로 내려가면 조용히 빠지는데,
 * 그게 화면 어디에도 드러나지 않았다 — 오늘 학장자동차운전전문학원의 "자체 시험장 보유"
 * 가 광고 문구(부산 최초로)와 엉켜 통째로 빠졌고, 글만 봐서는 알 수 없었다.
 *
 * 별도 컨트롤러인 이유: admin.controller 는 이미 크고 여러 세션이 동시에 만진다.
 * 이 기능은 읽기 전용 한 갈래라 섞을 이유가 없다.
 */
@Controller("api/admin/post-insight")
export class PostInsightController {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(AcademyResearchDbService) private readonly researchDb: AcademyResearchDbService,
  ) {}

  @Get(":postId")
  insight(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("postId") postId: string) {
    checkAuth(req, headers);
    const post = this.db.getPost(postId);
    if (!post) throw new HttpException("post not found", 404);

    const body = String(post.body_markdown ?? "");
    const names: string[] = safeJson(post.academy_names) ?? [];
    const snapshot = String(post.facts_snapshot ?? "");

    return {
      post_id: postId,
      // 생성 시점 근거가 없으면 옛 글이다. 재계산해 보여주면 그때와 다른 값을 그때 값인 척
      // 보여주게 되므로, 없다는 사실을 그대로 알린다.
      has_snapshot: Boolean(snapshot),
      used: {
        academies: names.length,
        quotes: (body.match(/^>/gm) ?? []).length,
        images: Number(post.image_count ?? 0) || (body.match(/\[IMAGE:/g) ?? []).length,
        chars: body.length,
      },
      // 프롬프트로 나갔지만 본문이 안 쓴 조사 근거. "아쉬움" 이 아니라 사실이다 —
      // 흔한 편의시설처럼 모델이 버리는 게 맞는 경우가 많다(실측 4건에서 전부 그랬다).
      unused: snapshot ? unusedResearchLines(snapshot, body) : [],
      // 검토 필요라 애초에 나가지 못한 값. 이쪽이 진짜 아쉬운 자리다.
      blocked: this.blockedForAcademies(names),
    };
  }

  /** 이 글에 나온 학원들이 가진 「검토 필요」 값. 글에 실릴 수 있는 항목만 센다. */
  private blockedForAcademies(names: string[]): Array<{ academy: string; field: string; label: string; value: string; note: string }> {
    if (!names.length) return [];
    const out: Array<{ academy: string; field: string; label: string; value: string; note: string }> = [];
    for (const name of names) {
      const base = this.researchDb.get("SELECT external_id FROM academy_base WHERE name = ?", [name]);
      const externalId = String(base?.external_id ?? "");
      if (!externalId) continue;
      const research = this.researchDb.getResearch(externalId) ?? {};
      for (const meta of this.researchDb.listFieldMeta(externalId)) {
        if (String(meta.status) !== "needs_review") continue;
        const field = String(meta.field_key);
        const label = RESEARCH_FIELD_LABEL.get(field);
        if (!label) continue; // 글에 못 쓰는 항목은 빠져도 알릴 일이 아니다
        out.push({ academy: name, field, label, value: String(research[field] ?? ""), note: String(meta.note ?? "") });
      }
    }
    return out;
  }
}

/**
 * 근거 원문에서 「(조사)」 줄만 뽑아, 그 값의 낱말이 본문에 하나도 없으면 안 쓰인 것으로 본다.
 * 완전한 판정은 아니다(모델이 바꿔 쓸 수 있다) — 그래서 화면에서도 단정하지 않고 목록으로만 보인다.
 */
export function unusedResearchLines(snapshot: string, body: string): Array<{ academy: string; label: string; value: string }> {
  const out: Array<{ academy: string; label: string; value: string }> = [];
  for (const line of snapshot.split("\n")) {
    const academy = (line.match(/^\[\d+\]\s*([^/]+)/) ?? [])[1]?.trim() ?? "";
    if (!academy) continue;
    for (const part of line.split(" / ")) {
      const match = part.match(/^([^:]*\(조사\)):\s*(.+)$/);
      if (!match) continue;
      const [, label, value] = match;
      const words = String(value).split(/[,·\s]+/).map((w) => w.trim()).filter((w) => w.length >= 2);
      if (words.length && words.some((w) => body.includes(w))) continue;
      out.push({ academy, label: String(label), value: String(value) });
    }
  }
  return out;
}

function safeJson(value: unknown): any {
  if (value == null) return null;
  try { return JSON.parse(String(value)); } catch { return null; }
}
