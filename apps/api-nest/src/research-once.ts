import "reflect-metadata";
import { AcademyResearchDbService } from "./academy-research-db.service.js";
import { AcademyResearchService } from "./academy-research.service.js";
import { DrivingplusApiService } from "./drivingplus-api.service.js";

/**
 * 조사 배치를 API 프로세스 **밖에서** 돌린다.
 *
 * 조사는 지금까지 API 안의 떠 있는 Promise 로만 돌았다. API 는 `tsx watch` 라
 * `apps/api-nest/src` 아래 파일이 하나라도 저장되면 재시작하며 배치가 그 자리에서 죽는다 —
 * 2026-07-27~28 이틀에만 세 번 끊겼다(26/30 · 27/100 · 8/30). 여러 세션이 같은 저장소를
 * 편집하는 동안에는 사실상 완주할 수 없다.
 *
 * 글 생성 워커에는 이미 같은 우회로가 있다(`worker:once`). 조사에도 둔다.
 * 이 프로세스는 watch 대상이 아니므로 남이 코드를 저장해도 죽지 않는다.
 *
 *   npm run research:once            # 미조사분 30곳(기본)
 *   npm run research:once -- 100     # 100곳
 *   npm run research:once -- 100 codex
 *
 * 저장 위치·재개 방식은 관리자 화면에서 돌릴 때와 완전히 같다(같은 서비스를 부른다).
 * 중단돼도 이미 저장된 학원은 남고, 다시 실행하면 미조사분부터 이어간다.
 */
const limit = Math.max(1, Math.min(5000, Number(process.argv[2] ?? 30) || 30));
const providerArg = String(process.argv[3] ?? "").trim();
const provider = providerArg === "codex" || providerArg === "claude" ? providerArg : "auto";

const db = new AcademyResearchDbService();
await db.onModuleInit();
const service = new AcademyResearchService(db, new DrivingplusApiService());

const started = await service.startRegionResearch(undefined, { provider, limit });
if (!started.ok || !started.run_id) {
  console.error(`시작 실패: ${started.error ?? "원인 미상"}`);
  process.exit(1);
}
console.log(`조사 시작 — 대상 ${started.count}곳 · provider=${provider} · run=${started.run_id}`);
console.log("이 프로세스를 켜 둔 동안은 코드를 저장해도 배치가 죽지 않습니다.\n");

// startRegionResearch 는 백그라운드로 던지고 즉시 반환한다(HTTP 응답을 막지 않기 위함).
// CLI 는 끝까지 지켜야 하므로 run 상태를 폴링해 진행을 찍고, 끝나면 종료 코드로 알린다.
const POLL_MS = 15000;
let lastDone = -1;
for (;;) {
  await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  const run = db.getRun(started.run_id);
  if (!run) break;
  const done = Number(run.count_done ?? 0);
  if (done !== lastDone) {
    lastDone = done;
    const tally = (() => { try { return JSON.parse(String(run.result ?? "{}")); } catch { return {}; } })();
    // 실패가 있으면 사유를 함께 찍는다. 곳수만 보이면 왜 무너졌는지 알 수 없어
    // 100곳 중 56곳이 연속 실패했을 때 원인을 사후에 추적할 수 없었다.
    const reason = Number(tally.failed ?? 0) > 0 && tally.last_error ? `  ← ${String(tally.last_error).slice(0, 90)}` : "";
    console.log(`  ${done}/${run.count_total} — 저장 ${tally.saved ?? 0} · 소스없음 ${tally.no_sources ?? 0} · 실패 ${tally.failed ?? 0}${reason}`);
  }
  if (run.status !== "running") {
    console.log(`\n${run.status === "done" ? "완료" : run.status === "cancelled" ? "취소됨" : "중단"} — ${done}/${run.count_total}${run.error ? ` (${run.error})` : ""}`);
    process.exit(run.status === "done" ? 0 : 1);
  }
}
