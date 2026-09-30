import type { Hono } from "hono";
import { html } from "hono/html";
import { type AppContext, COLLECT_KIND, GENERATE_KIND } from "../app.ts";
import { CHANNELS, findChannel } from "../channels.ts";
import { regionLabel } from "../keywords/regions.ts";
import { loadSearchadCredentials, SearchadClient } from "../keywords/searchad.ts";
import { ARTICLE_TYPES, articleTypeLabel } from "../topics/intent.ts";
import {
  addManualTopics,
  copyTopic,
  lookupKeywordVolume,
  parseTarget,
  type TopicTarget,
  targetValue,
  topicTargets,
} from "../topics/reuse.ts";
import {
  getTopic,
  listTopics,
  setTopicProgress,
  setTopicStatus,
  TOPIC_STATUSES,
  type Topic,
  type TopicStatus,
} from "../topics/store.ts";
import { badge, page, statusTone, TOPIC_STATUS_LABEL } from "./layout.ts";

const NOTICES: Record<string, string> = {
  queued: "생성을 예약했습니다. 생성 간격·사용량 한도에 맞춰 순서대로 작성합니다.",
  collect: "키워드 수집을 작업 큐에 넣었습니다. 잠시 뒤 새로고침하세요.",
  status: "상태를 바꿨습니다.",
  copied:
    "다른 채널에 주제를 만들고 생성을 예약했습니다. 그 채널을 고르면 볼 수 있습니다. 이미 있던 주제면 그 주제로 예약합니다.",
  added: "주제를 추가했습니다. 고른 채널마다 주제가 하나씩 생깁니다.",
  addedQueued: "주제를 추가하고 생성을 예약했습니다.",
};

const ORIGIN_LABEL: Record<string, string> = { copied: "복사", manual: "직접 추가" };

/** 이 주제를 옮겨 쓸 수 있는 채널·섹션. 지역 주제는 지역 글을 쓰는 채널로만. */
function copyTargets(t: Topic) {
  return topicTargets().filter(
    (x) =>
      !(x.channelId === t.channelId && x.sectionCode === t.sectionCode) &&
      (!t.region || x.regional),
  );
}

function copyForm(t: Topic) {
  const targets = copyTargets(t);
  if (!targets.length) return "";
  return html`<form class="inline copyto" method="post" action="/topics/${t.id}/copy">
    <select name="target" aria-label="다른 채널">
      ${targets.map((x) => html`<option value="${targetValue(x)}">${x.label}</option>`)}
    </select>
    <button class="small">다른 채널로 예약</button>
  </form>`;
}

function manualForm() {
  return html`<section class="card">
  <details>
    <summary><b>주제 직접 추가</b> <span class="muted">검색 키워드로 나오지 않는 주제(예: 운전면허학원 가기 전 드라이빙존 연습)를 여러 채널에 한 번에 만듭니다</span></summary>
    <form method="post" action="/topics/manual" style="margin-top:12px">
      <div class="field"><label>대표 키워드 (제목·설명에 들어갈 검색어)</label>
        <input type="text" name="primaryKeyword" required placeholder="예) 운전면허 시뮬레이터"></div>
      <div class="field"><label>보조 키워드 (쉼표로 구분, 선택)</label>
        <input type="text" name="secondaryKeywords" placeholder="예) 운전면허학원 비용, 기능시험 연습"></div>
      <div class="field"><label>글 유형</label>
        <select name="articleType">
          <option value="">대표 키워드로 판정</option>
          ${ARTICLE_TYPES.map((t) => html`<option value="${t.type}">${t.label}</option>`)}
        </select></div>
      <div class="field"><label>글 방향 (프롬프트에 들어갑니다. 숫자·조건은 유의사항에 있는 것만 글에 씁니다)</label>
        <textarea name="brief" rows="3" placeholder="예) 학원은 시간당 단가가 높으니 기본 조작은 드라이빙존에서 익히고, 학원은 실차 감각을 익히는 용도로 가라고 안내한다"></textarea></div>
      <div class="field"><label>채널 (여러 개 선택 가능)</label>
        <div class="targets">
          ${topicTargets().map((x) => html`<label class="check"><input type="checkbox" name="target" value="${targetValue(x)}"> ${x.label}</label>`)}
        </div></div>
      <label class="check"><input type="checkbox" name="queue" value="1"> 추가하고 바로 생성 예약</label>
      <div style="margin-top:10px"><button type="submit" class="primary">추가</button>
        <span class="muted">30일 검색 수는 수집 기록에서 찾고, 없으면 네이버 검색광고 API로 조회합니다(없으면 0).</span></div>
    </form>
  </details>
</section>`;
}

export function mountTopics(app: Hono, ctx: AppContext): void {
  app.get("/topics", (c) => {
    const channelId = c.req.query("channel") || CHANNELS[0].id;
    const channel = findChannel(channelId) ?? CHANNELS[0];
    // 채널을 바꾸면 이전 채널의 섹션 값이 같이 올 수 있다. 이 채널에 없는 섹션이면 모든 섹션으로 본다.
    const sectionQ = c.req.query("section") || "";
    const sectionCode = channel.sections.some((s) => s.code === sectionQ) ? sectionQ : "";
    const statusQ = c.req.query("status") ?? "candidate";
    const status = TOPIC_STATUSES.includes(statusQ as TopicStatus)
      ? (statusQ as TopicStatus)
      : undefined;
    const topics = listTopics(ctx.db, {
      channelId: channel.id,
      sectionCode: sectionCode || undefined,
      status,
      limit: 200,
    });
    const lastCollect = ctx.db.get<{ finished_at: string | null; status: string }>(
      "SELECT finished_at, status FROM jobs WHERE kind = ? ORDER BY id DESC LIMIT 1",
      [COLLECT_KIND],
    );

    const body = html`
<h1>주제</h1>
<p class="lead">네이버 최근 30일 검색 수로 만든 주제 후보입니다. 점수가 높은 순으로 보이며, 생성을 예약하면 워커가 순서대로 씁니다.
주제는 다른 채널에서도 다시 쓸 수 있습니다(같은 주제의 다른 채널 글은 겹치지 않게 피해서 씁니다).</p>
${manualForm()}
<section class="card">
  <header>
    <form class="filters" method="get" action="/topics">
      <select name="channel" onchange="this.form.section.value = ''; this.form.submit()">
        ${CHANNELS.map((ch) => html`<option value="${ch.id}" ${ch.id === channel.id ? "selected" : ""}>${ch.label}</option>`)}
      </select>
      <select name="section" onchange="this.form.submit()">
        <option value="">모든 섹션</option>
        ${channel.sections.map((s) => html`<option value="${s.code}" ${s.code === sectionCode ? "selected" : ""}>${s.label}</option>`)}
      </select>
      <select name="status" onchange="this.form.submit()">
        <option value="">모든 상태</option>
        ${TOPIC_STATUSES.map((s) => html`<option value="${s}" ${s === status ? "selected" : ""}>${TOPIC_STATUS_LABEL[s]}</option>`)}
      </select>
    </form>
    <form method="post" action="/topics/collect" class="inline">
      <span class="muted">${lastCollect ? `마지막 수집: ${lastCollect.finished_at ? new Date(lastCollect.finished_at).toLocaleString("ko-KR") : "진행 중"}` : "아직 수집 기록 없음"}</span>
      <button type="submit">키워드 수집 실행</button>
    </form>
  </header>
  <div class="table-wrap"><table>
    <tr><th>점수</th><th>대표 키워드</th><th>유형</th><th>지역</th><th class="num">30일 검색</th><th>상태</th><th></th></tr>
    ${topics.map(
      (t) => html`<tr>
        <td class="num">${t.score.toFixed(2)}</td>
        <td><b>${t.primaryKeyword}</b> ${ORIGIN_LABEL[t.origin] ? badge(ORIGIN_LABEL[t.origin]!) : ""}<div class="muted">${t.secondaryKeywords.slice(0, 4).join(", ")}</div>
          ${t.brief ? html`<div class="muted">글 방향: ${t.brief}</div>` : ""}</td>
        <td>${articleTypeLabel(t.articleType)}</td>
        <td>${t.region ? regionLabel(t.region) : html`<span class="muted">전국</span>`}</td>
        <td class="num">${t.volume.toLocaleString()}</td>
        <td>${badge(TOPIC_STATUS_LABEL[t.status] ?? t.status, statusTone(t.status))}</td>
        <td class="actions">
          ${t.status !== "queued" ? html`<form class="inline" method="post" action="/topics/${t.id}/generate"><button class="small primary">생성 예약</button></form>` : ""}
          ${t.status === "candidate" ? html`<form class="inline" method="post" action="/topics/${t.id}/status"><input type="hidden" name="status" value="skipped"><button class="small">건너뛰기</button></form>` : ""}
          ${t.status === "skipped" ? html`<form class="inline" method="post" action="/topics/${t.id}/status"><input type="hidden" name="status" value="candidate"><button class="small">되살리기</button></form>` : ""}
          ${copyForm(t)}
        </td>
      </tr>`,
    )}
  </table></div>
  ${topics.length ? "" : html`<p class="muted">조건에 맞는 주제가 없습니다. 키워드 수집을 실행하세요.</p>`}
</section>`;
    return c.html(
      page("주제", body, {
        current: "/topics",
        notice: NOTICES[c.req.query("done") ?? ""],
        error: c.req.query("error"),
      }),
    );
  });

  const back = (
    c: { req: { header(name: string): string | undefined } },
    done: string,
    error?: string,
  ) => {
    const ref = c.req.header("referer");
    const url = new URL(ref?.includes("/topics") ? ref : "http://local/topics");
    url.searchParams.delete("done");
    url.searchParams.delete("error");
    if (error) url.searchParams.set("error", error);
    else url.searchParams.set("done", done);
    return `${url.pathname}${url.search}`;
  };

  const queueTopic = (topic: Topic) => {
    if (topic.status === "queued") return;
    setTopicProgress(ctx.db, topic.id, "queued");
    ctx.queue.enqueue(GENERATE_KIND, { topicId: topic.id });
  };

  app.post("/topics/collect", (c) => {
    ctx.queue.enqueue(COLLECT_KIND);
    return c.redirect(back(c, "collect"), 303);
  });

  app.post("/topics/:id/generate", (c) => {
    const topic = getTopic(ctx.db, Number(c.req.param("id")));
    if (!topic) return c.text("주제가 없습니다", 404);
    queueTopic(topic);
    return c.redirect(back(c, "queued"), 303);
  });

  // 주제를 다른 채널·섹션에 만들고(이미 있으면 그 주제) 생성을 예약한다.
  app.post("/topics/:id/copy", async (c) => {
    const form = await c.req.parseBody();
    const target = parseTarget(String(form.target ?? ""));
    if (!target) return c.redirect(back(c, "", "대상 채널을 고르세요"), 303);
    try {
      const { topic } = copyTopic(ctx.db, Number(c.req.param("id")), target);
      queueTopic(topic);
      return c.redirect(back(c, "copied"), 303);
    } catch (error) {
      return c.redirect(back(c, "", (error as Error).message), 303);
    }
  });

  app.post("/topics/manual", async (c) => {
    const form = await c.req.parseBody({ all: true });
    const list = (v: unknown) => (Array.isArray(v) ? v : v === undefined ? [] : [v]).map(String);
    const targets = list(form.target)
      .map(parseTarget)
      .filter((t): t is TopicTarget => !!t);
    const primaryKeyword = String(form.primaryKeyword ?? "").trim();
    try {
      const volume = await lookupKeywordVolume(ctx.db, primaryKeyword, searchadOrUndefined());
      const { topics } = addManualTopics(ctx.db, {
        primaryKeyword,
        secondaryKeywords: String(form.secondaryKeywords ?? "").split(/[,\n]/),
        articleType: String(form.articleType ?? ""),
        brief: String(form.brief ?? ""),
        targets,
        volume,
      });
      const queue = form.queue === "1";
      if (queue) topics.forEach(queueTopic);
      // 추가한 주제가 보이도록 첫 채널의 모든 상태 목록으로 간다.
      const first = topics[0]!;
      const q = new URLSearchParams({
        channel: first.channelId,
        status: "",
        done: queue ? "addedQueued" : "added",
      });
      return c.redirect(`/topics?${q}`, 303);
    } catch (error) {
      return c.redirect(back(c, "", (error as Error).message), 303);
    }
  });

  /** 인증 파일이 없으면 API 조회 없이 수집 기록만 본다. */
  const searchadOrUndefined = () => {
    try {
      return new SearchadClient(loadSearchadCredentials(ctx.config.naver.searchadEnvFile));
    } catch {
      return undefined;
    }
  };

  app.post("/topics/:id/status", async (c) => {
    const form = await c.req.parseBody();
    const status = form.status === "skipped" ? "skipped" : "candidate";
    setTopicStatus(ctx.db, Number(c.req.param("id")), status);
    return c.redirect(back(c, "status"), 303);
  });
}
