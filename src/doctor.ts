// 설치·설정 점검: `npm run doctor` (실제 LLM 호출까지 보려면 `npm run doctor -- --llm`)
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { createContext } from "./app.ts";
import { CHANNELS } from "./channels.ts";
import { type AppConfig, loadConfig } from "./config.ts";
import { loadGuideRules } from "./guides.ts";
import { loadDatalabCredentials } from "./keywords/datalab.ts";
import { readEnvFile } from "./keywords/searchad.ts";
import { resolveCommand } from "./llm/command.ts";
import { runProcess } from "./llm/process.ts";
import { resolvePath } from "./paths.ts";

let failed = 0;
const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const warn = (msg: string) => console.log(`  ! ${msg}`);
const bad = (msg: string) => {
  failed++;
  console.log(`  ✗ ${msg}`);
};

async function checkCli(config: AppConfig) {
  console.log("\n[LLM CLI]");
  let found = 0;
  for (const provider of config.llm.order) {
    const command = config.llm[provider].command;
    const spec = resolveCommand(command, ["--version"]);
    if (!spec) {
      warn(`${provider}: '${command}'를 PATH에서 찾지 못함`);
      continue;
    }
    const r = await runProcess(spec, "", { timeoutMs: 30_000, cwd: tmpdir(), env: process.env });
    if (r.code === 0) {
      found++;
      ok(`${provider}: ${r.stdout.trim().split("\n")[0]} (${spec.file})`);
    } else warn(`${provider}: 실행 실패 ${r.spawnError ?? r.stderr.trim().slice(0, 200)}`);
  }
  if (!found) bad("사용할 수 있는 LLM CLI가 없습니다. README의 준비물을 확인하세요");
}

async function checkSource(name: string, url: string, timeoutSec: number) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutSec * 1000) });
    if (res.ok) ok(`${name}: ${url}`);
    else bad(`${name}: ${url} 응답 ${res.status}`);
  } catch (error) {
    bad(`${name}: ${url} 연결 실패 (${(error as Error).message})`);
  }
}

async function main() {
  console.log("[환경]");
  const major = Number(process.versions.node.split(".")[0]);
  if (major >= 24) ok(`Node ${process.versions.node}`);
  else bad(`Node ${process.versions.node} — 24 이상이 필요합니다`);
  ok(`OS ${process.platform}`);

  let config: AppConfig;
  try {
    config = loadConfig();
    ok(`설정 로드 (원천 데이터: ${config.sources.profile})`);
  } catch (error) {
    bad((error as Error).message);
    process.exit(1);
  }

  await checkCli(config);

  console.log("\n[네이버]");
  const searchad = resolvePath(config.naver.searchadEnvFile);
  if (existsSync(searchad)) ok(`검색광고 API 인증 파일: ${searchad}`);
  else warn(`검색광고 API 인증 파일 없음: ${searchad} (키워드 수집 단계에서 필요)`);
  // 값은 출력하지 않고 있는지만 알린다.
  if (loadDatalabCredentials(config.naver, readEnvFile)) ok("데이터랩 API 키: 있음 (추세 반영)");
  else warn("데이터랩 API 키 없음 — 추세 없이 30일 검색 수로만 점수 계산 (README 참고)");

  console.log("\n[원천 데이터 API]");
  await checkSource("api.drive", `${config.sources.drivingplusApi}/v1/zipcode/si-do-list`, 15);
  await checkSource("api.drivingzone", `${config.sources.drivingzoneApi}/v1/region`, 15);

  console.log("\n[작성 가이드]");
  const guideCtx = createContext(config);
  for (const ch of CHANNELS) ok(`${ch.id}: 규칙 ${loadGuideRules(guideCtx.db, ch.id).length}개`);
  guideCtx.db.close();

  if (process.argv.includes("--llm")) {
    console.log("\n[LLM 호출 시험]");
    const ctx = createContext(config);
    try {
      const r = await ctx.llm.generate("다른 말 없이 OK라고만 답하세요.", { timeoutSec: 180 });
      ok(
        `${r.provider} 응답 "${r.text.trim().slice(0, 40)}" (${Math.round(r.durationMs / 1000)}초)`,
      );
    } catch (error) {
      bad((error as Error).message);
    }
    for (const s of ctx.llm.status()) {
      const usage =
        s.usage.map((u) => `${u.name} ${u.usedPercent}%`).join(", ") || "사용률 정보 없음";
      console.log(
        `    ${s.provider}: ${usage}${s.blockedUntil ? ` — ${s.reason}, ${s.blockedUntil}까지 쉼` : ""}`,
      );
    }
    ctx.db.close();
  }

  console.log(failed ? `\n문제 ${failed}건` : "\n모든 점검 통과");
  process.exit(failed ? 1 : 0);
}

void main();
