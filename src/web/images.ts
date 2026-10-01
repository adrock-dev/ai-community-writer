import type { Hono } from "hono";
import { html } from "hono/html";
import { CHANNELS } from "../channels.ts";
import { type AppConfig, IMAGE_STYLES, type ImageStyleSetting } from "../config.ts";
import type { Database } from "../db/database.ts";
import {
  hasSavedImageStyles,
  IMAGE_STYLE_LABEL,
  imageStyleFor,
  imageStyleSettings,
  isImageStyle,
  resetImageStyles,
  saveImageStyles,
} from "../images/style.ts";
import { page } from "./layout.ts";

// 삽화 설정 화면: /settings/images
// 생성 삽화(실제 사진이 모자랄 때 만드는 이미지)의 화풍을 채널별로 고른다. 저장하면 다음 글부터 적용된다.

const NOTICES: Record<string, string> = {
  saved: "저장했습니다. 다음에 생성하는 글부터 적용됩니다.",
  reset: "화면 저장 값을 지웠습니다. 이제 config.json 값을 씁니다.",
};

function styleSelect(name: string, current: ImageStyleSetting | "", inherit?: string) {
  return html`<select name="${name}">
  ${inherit === undefined ? "" : html`<option value="" ${current === "" ? "selected" : ""}>공통 값 따름 (${inherit})</option>`}
  ${IMAGE_STYLES.map((s) => html`<option value="${s}" ${s === current ? "selected" : ""}>${IMAGE_STYLE_LABEL[s]}</option>`)}
</select>`;
}

export function mountImageSettings(app: Hono, db: Database, config: AppConfig): void {
  app.get("/settings/images", (c) => {
    const settings = imageStyleSettings(db, config);
    const saved = hasSavedImageStyles(db);
    const body = html`
<h1>삽화 설정</h1>
<p class="lead">학원·지점의 실제 사진이 모자랄 때 만드는 삽화의 화풍입니다. 실제 사진에는 영향이 없습니다.
글자·로고·얼굴을 넣지 않는 조건은 화풍과 상관없이 붙습니다. "섞어서"는 글마다 사진풍·일러스트 중 하나를 고르고, 한 글 안에서는 같은 화풍을 씁니다.</p>
<section class="card">
  <header><h2>화풍</h2>
    <span class="badge">${saved ? "화면에서 저장한 값 사용 중" : "config.json 값 사용 중"}</span></header>
  <form method="post" action="/settings/images">
    <div class="table-wrap"><table>
      <thead><tr><th>적용 범위</th><th>화풍</th><th>지금 적용</th></tr></thead>
      <tbody>
        <tr><td><b>공통</b> (채널별 값이 없을 때)</td><td>${styleSelect("style", settings.style)}</td>
          <td>${IMAGE_STYLE_LABEL[settings.style]}</td></tr>
        ${CHANNELS.map(
          (ch) => html`<tr><td>${ch.label}</td>
          <td>${styleSelect(`channel:${ch.id}`, settings.styleByChannel[ch.id] ?? "", IMAGE_STYLE_LABEL[settings.style])}</td>
          <td>${IMAGE_STYLE_LABEL[imageStyleFor(settings, ch.id)]}</td></tr>`,
        )}
      </tbody>
    </table></div>
    <p><button type="submit" class="primary">저장</button></p>
  </form>
  ${
    saved
      ? html`<form method="post" action="/settings/images/reset">
    <button type="submit" class="danger"
      onclick="return confirm('화면에서 저장한 화풍을 지우고 config.json 값으로 돌아갈까요?')">config.json 값으로 되돌리기</button></form>`
      : ""
  }
</section>`;
    return c.html(
      page("삽화 설정", body, {
        current: "/settings/images",
        notice: NOTICES[c.req.query("done") ?? ""],
      }),
    );
  });

  app.post("/settings/images", async (c) => {
    const form = await c.req.parseBody();
    if (!isImageStyle(form.style)) return c.text("공통 화풍 값이 올바르지 않습니다", 400);
    const styleByChannel: Record<string, ImageStyleSetting> = {};
    for (const ch of CHANNELS) {
      const value = form[`channel:${ch.id}`];
      if (value === undefined || value === "") continue;
      if (!isImageStyle(value)) return c.text(`${ch.label} 화풍 값이 올바르지 않습니다`, 400);
      styleByChannel[ch.id] = value;
    }
    saveImageStyles(db, { style: form.style, styleByChannel });
    return c.redirect("/settings/images?done=saved", 303);
  });

  app.post("/settings/images/reset", (c) => {
    resetImageStyles(db);
    return c.redirect("/settings/images?done=reset", 303);
  });
}
