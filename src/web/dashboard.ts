import type { Hono } from "hono";
import { html } from "hono/html";
import type { AppContext } from "../app.ts";
import { articleCounts } from "../articles/review.ts";
import { page, shortTime } from "./layout.ts";

export function mountDashboard(app: Hono, ctx: AppContext): void {
  app.get("/", (c) => {
    const articles = articleCounts(ctx.db);
    const jobs = ctx.queue.counts();
    const candidates =
      ctx.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM topics WHERE status = 'candidate'")?.n ??
      0;
    const pace = ctx.pacer.blockedUntil();
    const stat = (href: string, label: string, n: number) =>
      html`<a class="stat" href="${href}"><span class="muted">${label}</span><b>${n.toLocaleString()}</b></a>`;

    const body = html`
<h1>대시보드</h1>
<p class="lead">주제 선택 → 생성 예약 → 검수·승인 → 내보내기 순서로 진행합니다.</p>
<div class="stats">
  ${stat("/articles?status=review", "검수 대기", articles.review)}
  ${stat("/articles?status=draft", "초안 (문제 남음)", articles.draft)}
  ${stat("/articles?status=approved", "승인 (내보내기 전)", articles.approved)}
  ${stat("/articles?status=exported", "내보냄 (발행 전)", articles.exported)}
  ${stat("/topics", "주제 후보", candidates)}
  ${stat("/jobs", "대기 작업", jobs.queued + jobs.running)}
</div>
<section class="card">
  <header><h2>글 생성 상태</h2><span class="muted">${pace ? `다음 생성 가능: ${shortTime(pace.until.toISOString())} (${pace.reason})` : "지금 생성 가능"}</span></header>
  <div class="table-wrap"><table>
    <tr><th>LLM</th><th>상태</th><th>사용률</th></tr>
    ${ctx.llm.status().map(
      (s) => html`<tr>
        <td>${s.provider}</td>
        <td>${s.blockedUntil ? html`<span class="badge warn">${shortTime(s.blockedUntil)}까지 쉼</span> <span class="muted">${s.reason}</span>` : html`<span class="badge ok">사용 가능</span>`}</td>
        <td>${s.usage.map((u) => `${u.name} ${u.usedPercent}%`).join(" · ") || html`<span class="muted">아직 기록 없음</span>`}</td>
      </tr>`,
    )}
  </table></div>
  ${jobs.failed ? html`<p class="muted">실패한 작업 ${jobs.failed}건 — <a href="/jobs">작업 화면</a>에서 원인을 확인하세요.</p>` : ""}
</section>`;
    return c.html(page("대시보드", body, { current: "/" }));
  });
}
