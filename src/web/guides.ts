import type { Hono } from "hono";
import { html } from "hono/html";
import { CHANNELS } from "../channels.ts";
import type { Database } from "../db/database.ts";
import {
  addGuideRule,
  deleteGuideRule,
  exportGuideFiles,
  GUIDES_DIR,
  type GuideRule,
  guideFilesInSync,
  guideScopes,
  importGuideFiles,
  listGuideRules,
  loadGuideRules,
  renderGuideRules,
  updateGuideRule,
} from "../guides.ts";
import { page } from "./layout.ts";

// 유의사항(작성 가이드) 설정 화면: /settings/guides
// 폼 제출만으로 동작한다(스크립트는 삭제 확인에만 사용).

const NOTICES: Record<string, string> = {
  added: "규칙을 추가했습니다.",
  saved: "저장했습니다.",
  deleted: "삭제했습니다.",
  exported: "guides 폴더에 저장했습니다. git 에 커밋·push 하면 다른 PC 에서 받을 수 있습니다.",
  unchanged: "파일과 이미 같아 바꾼 파일이 없습니다.",
  imported: "guides 폴더의 파일로 규칙을 모두 바꿨습니다.",
};

function ruleRow(rule: GuideRule) {
  const scopes = guideScopes();
  return html`<form class="rule ${rule.enabled ? "" : "off"}" method="post" action="/settings/guides/${rule.id}">
  <input type="text" name="group" value="${rule.group}" placeholder="묶음 (예: 교육 운영)" list="groups">
  <div>
    <textarea name="text" rows="2" required>${rule.text}</textarea>
    <details class="muted"><summary>적용 범위 바꾸기</summary>
      <select name="scope">${scopes.map((s) => html`<option value="${s.scope}" ${s.scope === rule.scope ? "selected" : ""}>${s.label}</option>`)}</select>
    </details>
  </div>
  <label class="check"><input type="checkbox" name="enabled" value="1" ${rule.enabled ? "checked" : ""}> 사용</label>
  <div class="actions">
    <button type="submit">저장</button>
    <button type="submit" class="danger" formaction="/settings/guides/${rule.id}/delete"
      onclick="return confirm('이 규칙을 삭제할까요?')">삭제</button>
  </div>
</form>`;
}

/** 파일 동기화 카드. 규칙은 DB 에 있고, guides/*.md 를 거쳐 git 으로 다른 PC 와 주고받는다. */
function syncCard(inSync: boolean) {
  return html`<section class="card" id="sync">
  <header><h2>파일 동기화 (git)</h2>
    <span class="badge ${inSync ? "" : "danger"}">${inSync ? "guides 폴더와 같음" : "guides 폴더와 다름"}</span></header>
  <p class="muted">규칙은 이 PC 의 DB 에 저장됩니다. 다른 PC 와 맞추려면 <b>파일에 저장</b> → <code>guides/</code> 를 git 에 커밋·push →
  다른 PC 에서 <code>git pull</code> → <b>파일에서 불러오기</b> 순서로 합니다.</p>
  <form method="post" action="/settings/guides/export" style="display:inline">
    <button type="submit" class="primary">파일에 저장 (DB → guides/)</button></form>
  <form method="post" action="/settings/guides/import" style="display:inline">
    <button type="submit" class="danger"
      onclick="return confirm('guides 폴더의 파일로 이 PC 의 규칙을 모두 바꿉니다. 이 PC 에서만 고친 규칙은 사라집니다. 계속할까요?')">파일에서 불러오기 (guides/ → DB, 전부 교체)</button></form>
</section>`;
}

export function mountGuideSettings(app: Hono, db: Database, guidesDir: string = GUIDES_DIR): void {
  app.get("/settings/guides", (c) => {
    const all = listGuideRules(db);
    const groups = [...new Set(all.map((r) => r.group).filter(Boolean))];
    const body = html`
<h1>유의사항 설정</h1>
<p class="lead">글을 생성할 때 반드시 지켜야 하는 운영 규칙과 사실입니다. 생성 프롬프트에 그대로 들어가고, 품질 검사에서 숫자 근거로도 씁니다.
넓은 범위부터 겹쳐 적용됩니다: 공통 → 브랜드 전체 → 채널.</p>
${syncCard(guideFilesInSync(db, guidesDir))}
<datalist id="groups">${groups.map((g) => html`<option value="${g}">`)}</datalist>
${guideScopes().map((s) => {
  const rules = all.filter((r) => r.scope === s.scope);
  return html`<section class="card" id="${s.scope}">
  <header><h2>${s.label}</h2><span class="muted">${rules.filter((r) => r.enabled).length}개 사용 중</span></header>
  ${rules.map((r) => ruleRow(r))}
  <form class="rule" method="post" action="/settings/guides">
    <input type="hidden" name="scope" value="${s.scope}">
    <input type="text" name="group" placeholder="묶음 (선택)" list="groups">
    <textarea name="text" rows="2" required placeholder="예) 드라이빙존 교육시간은 1일 1회 최대 1시간 30분 교육 가능"></textarea>
    <span></span>
    <div class="actions"><button type="submit" class="primary">추가</button></div>
  </form>
</section>`;
})}
<section class="card">
  <header><h2>채널별 최종 적용 미리보기</h2><span class="muted">생성 프롬프트에 들어가는 형태</span></header>
  ${CHANNELS.map(
    (ch) => html`<details><summary>${ch.label}</summary>
    <pre class="preview">${renderGuideRules(loadGuideRules(db, ch.id)) || "(적용되는 규칙 없음)"}</pre></details>`,
  )}
</section>`;
    return c.html(
      page("유의사항 설정", body, {
        current: "/settings/guides",
        notice: NOTICES[c.req.query("done") ?? ""],
      }),
    );
  });

  const back = (scope: string, done: string) =>
    `/settings/guides?done=${done}#${encodeURIComponent(scope)}`;

  app.post("/settings/guides", async (c) => {
    const form = await c.req.parseBody();
    const scope = String(form.scope ?? "");
    try {
      addGuideRule(db, { scope, group: String(form.group ?? ""), text: String(form.text ?? "") });
    } catch (error) {
      return c.text((error as Error).message, 400);
    }
    return c.redirect(back(scope, "added"), 303);
  });

  // /settings/guides/:id 보다 먼저 등록해야 export·import 가 규칙 번호로 잡히지 않는다.
  app.post("/settings/guides/export", (c) => {
    const changed = exportGuideFiles(db, guidesDir);
    return c.redirect(
      `/settings/guides?done=${changed.length ? "exported" : "unchanged"}#sync`,
      303,
    );
  });

  app.post("/settings/guides/import", (c) => {
    try {
      importGuideFiles(db, guidesDir);
    } catch (error) {
      return c.text((error as Error).message, 400);
    }
    return c.redirect("/settings/guides?done=imported#sync", 303);
  });

  app.post("/settings/guides/:id", async (c) => {
    const form = await c.req.parseBody();
    const scope = String(form.scope ?? "");
    try {
      const ok = updateGuideRule(db, Number(c.req.param("id")), {
        scope,
        group: String(form.group ?? ""),
        text: String(form.text ?? ""),
        enabled: form.enabled === "1",
      });
      if (!ok) return c.text("규칙을 찾을 수 없습니다", 404);
    } catch (error) {
      return c.text((error as Error).message, 400);
    }
    return c.redirect(back(scope, "saved"), 303);
  });

  app.post("/settings/guides/:id/delete", async (c) => {
    const form = await c.req.parseBody();
    deleteGuideRule(db, Number(c.req.param("id")));
    return c.redirect(back(String(form.scope ?? "common"), "deleted"), 303);
  });

  // 화면 외 사용(추후 UI·스크립트)을 위한 JSON
  app.get("/api/guides", (c) => {
    const channel = c.req.query("channel");
    return c.json(channel ? loadGuideRules(db, channel) : listGuideRules(db));
  });
}
