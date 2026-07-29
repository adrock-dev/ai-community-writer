#!/usr/bin/env node
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";

const root = resolve(new URL("..", import.meta.url).pathname);
const dbPath = resolve(root, "data/admin.db");
const outputRoot = resolve(root, "deliverables/gwangsan-driving-academies-model-comparison");
const domain = "app.drivingplus.me";
const target = { region: "광주광역시 광산구", latitude: 35.139524, longitude: 126.793688 };
const seed = "gwangsan-gu|driving-academy|2026-07-21";
const models = ["gpt-5.6-luna", "gpt-5.5"];
const writePromptsOnly = process.argv.includes("--write-prompts");
const angles = [
  { slug: "01-distance-and-commute", focus: "거리와 생활 동선을 우선하는 초보자의 선택 가이드" },
  { slug: "02-license-course", focus: "1종·2종 보통부터 대형·2종 소형까지 필요한 면허 과정을 확인하는 가이드" },
  { slug: "03-first-lesson-anxiety", focus: "첫 수업의 긴장과 강습 방식이 걱정되는 초보자를 위한 가이드" },
  { slug: "04-registration-checklist", focus: "등록 전 전화로 확인할 항목과 일정 계획을 중심으로 한 가이드" },
  { slug: "05-compare-and-decide", focus: "다섯 곳을 비교한 뒤 내 상황에 맞는 최종 선택을 돕는 가이드" },
];

if (!existsSync(dbPath)) throw new Error(`원천 DB를 찾을 수 없습니다: ${dbPath}`);
const db = new DatabaseSync(dbPath, { readOnly: true });
const academies = selectAcademies(db);
mkdirSync(outputRoot, { recursive: true });

const manifest = {
  generatedAt: new Date().toISOString(),
  source: { database: "data/admin.db", domain, syncedAt: "2026-07-20", sourceName: "DrivingPlus" },
  selection: {
    target,
    radiusKm: 20,
    fallbackRadiusKm: 50,
    candidateCount: 15,
    seed,
    algorithm: "20km 이내 exam_academy 후보를 직선거리·이름 순으로 정렬한 뒤 FNV-1a + Mulberry32로 5곳을 표본 추출",
    academies,
  },
  models,
  angles,
};
writeFileSync(join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

for (const model of models) {
  const modelDir = join(outputRoot, model);
  mkdirSync(modelDir, { recursive: true });
  for (const angle of angles) {
    const prompt = buildPrompt({ model, angle, academies });
    if (writePromptsOnly) {
      writeFileSync(join(modelDir, `${angle.slug}.prompt.txt`), prompt, "utf8");
      console.log(JSON.stringify({ model, article: angle.slug, status: "prompt_written" }));
      continue;
    }
    console.error(`starting ${model}/${angle.slug}`);
    const result = await runCodex(model, prompt);
    console.error(`finished ${model}/${angle.slug}: ${result.ok ? "ok" : "failed"}`);
    if (!result.ok) throw new Error(`${model}/${angle.slug} 생성 실패: ${result.error}`);
    const html = normalizeHtml(result.text);
    const problems = validateHtml(html, academies);
    if (problems.length) throw new Error(`${model}/${angle.slug} 형식 검증 실패: ${problems.join(", ")}`);
    writeFileSync(join(modelDir, `${angle.slug}.html`), html, "utf8");
    writeFileSync(join(modelDir, `${angle.slug}.metadata.json`), `${JSON.stringify({ model, angle, usage: result.usage, validation: "passed" }, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ model, article: angle.slug, status: "written", usage: result.usage }));
  }
}

function selectAcademies(database) {
  const rows = database.prepare(`
    select external_id, name, region, address, latitude, longitude, academy_type, phone,
      seo_description, review_json
    from academies
    where domain=? and academy_type='exam_academy' and latitude is not null and longitude is not null
  `).all(domain)
    .map((row) => ({ ...row, distance_km: round1(haversineKm(target.latitude, target.longitude, row.latitude, row.longitude)) }))
    .filter((row) => row.distance_km <= 20)
    .sort((a, b) => a.distance_km - b.distance_km || a.name.localeCompare(b.name, "ko"));
  if (rows.length < 5) throw new Error(`20km 이내 후보가 5곳 미만입니다: ${rows.length}`);
  return seededSample(rows, 5, seed).map((row) => ({
    external_id: row.external_id,
    name: row.name,
    region: row.region,
    address: row.address,
    latitude: row.latitude,
    longitude: row.longitude,
    distance_km: row.distance_km,
    academy_type: row.academy_type,
    phone: row.phone,
    course_summary: courseSummary(row.seo_description),
    reviews: reviewSummary(row.review_json),
  }));
}

function buildPrompt({ model, angle, academies: selected }) {
  return `당신은 한국의 지역 운전면허 콘텐츠 에디터입니다. 아래 원천 데이터만으로, 독립 실행 가능한 HTML 문서 한 편을 작성하세요.\n\n목적: ${angle.focus}\n생성 모델 식별: ${model}\n\n절대 규칙:\n1. 응답은 <!doctype html>로 시작하는 완전한 HTML만 출력합니다. 마크다운 코드펜스나 설명은 절대 넣지 마세요.\n2. <h1>은 정확히 \"광주광역시 광산구 운전면허학원 BEST5\"여야 합니다.\n3. 초보 운전자에게 상세히 설명하는 친절한 선생님 톤을 유지합니다.\n4. 아래 5개 학원은 모두 본문 비교표와 개별 설명에 한 번 이상 포함합니다. 순위·합격률·가격·셔틀·운영시간·후기 평점을 원천에 없는 사실로 만들지 마세요. 비교는 거리, 공개된 과정 설명, 제한된 후기의 경향, 등록 전 확인 항목으로만 합니다.\n5. 거리는 광산구 기준 좌표(35.139524, 126.793688)에서 계산한 직선거리이며 실제 이동 시간·도로 거리가 아님을 분명히 밝힙니다.\n6. 하단에 반드시 <section id=\"generation-criteria\">와 \"생성 기준\" 제목을 넣고, 원천·좌표·20km·15개 후보·고정 시드·5개 표본·검증 한계를 목록으로 요약합니다.\n7. <head>에는 angle별로 고유한 title·meta description·canonical URL·Open Graph 태그를 넣습니다. canonical은 https://example.com/gwangsan-driving-academies/${angle.slug} 로 합니다.\n8. JSON-LD를 최소 두 개 넣습니다: Article 및 ItemList. JSON-LD의 이름·주소·좌표·거리·학원 수는 아래 자료와 일치해야 합니다.\n9. 실제로 확인되지 않은 비용, 예약 가능 여부, 시험장, 합격 보장, 서비스 품질을 단정하거나 추천 순위처럼 표현하지 마세요. 후기 내용은 \"원천에 남은 일부 후기에서는\"처럼 한정해 서술합니다.\n\n원천 데이터:\n${JSON.stringify({ target: { region: target.region, latitude: target.latitude, longitude: target.longitude }, radius_km: 20, candidate_count: 15, selection_seed: seed, academies: selected }, null, 2)}\n`;
}

function runCodex(model, prompt) {
  return new Promise((resolvePromise) => {
    const child = spawn("codex", ["exec", "--json", "--skip-git-repo-check", "--sandbox", "read-only", "-c", 'approval_policy="never"', "--model", model, prompt], {
      cwd: root,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => child.kill("SIGTERM"), 10 * 60 * 1000);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => { clearTimeout(timeout); resolvePromise({ ok: false, error: error.message }); });
    child.on("close", (code) => {
      clearTimeout(timeout);
      let text = "";
      let usage = null;
      for (const line of stdout.split(/\r?\n/)) {
        try {
          const event = JSON.parse(line);
          if (event.type === "item.completed" && event.item?.type === "agent_message") text += event.item.text || "";
          if (event.type === "turn.completed") usage = event.usage || null;
        } catch { /* ignore non-JSON CLI lines */ }
      }
      resolvePromise({ ok: code === 0 && Boolean(text.trim()), text, usage, error: code === 0 ? "empty output" : stderr || `exit ${code}` });
    });
    child.stdin.end();
  });
}

function normalizeHtml(value) {
  return String(value).trim().replace(/^```html\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim() + "\n";
}

function validateHtml(html, selected) {
  const required = ["<!doctype html", "<html", "</html>", "<h1>광주광역시 광산구 운전면허학원 BEST5</h1>", "application/ld+json", "generation-criteria", "생성 기준"];
  const missing = required.filter((item) => !html.toLowerCase().includes(item.toLowerCase()));
  for (const academy of selected) if (!html.includes(academy.name)) missing.push(`academy:${academy.name}`);
  return missing;
}

function courseSummary(value) {
  return String(value || "").replace(/^.*?수강생을 위한\s*/, "").replace(/\s*면허 취득 과정을 운영합니다\.$/, "").trim() || "원천 데이터에 과정 설명 없음";
}

function reviewSummary(raw) {
  try {
    return JSON.parse(raw || "[]").slice(0, 3).map((review) => ({ date: review.date, point: review.point, content: review.content }));
  } catch { return []; }
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const radians = (value) => value * Math.PI / 180;
  const dLat = radians(lat2 - lat1);
  const dLng = radians(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function round1(value) { return Math.round(value * 10) / 10; }

function seededSample(items, count, seedValue) {
  const indexes = items.map((_, index) => index);
  const random = mulberry32(fnv1a(seedValue));
  for (let index = indexes.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [indexes[index], indexes[other]] = [indexes[other], indexes[index]];
  }
  return indexes.slice(0, count).sort((a, b) => a - b).map((index) => items[index]);
}

function fnv1a(value) {
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

function mulberry32(value) {
  return () => {
    value = (value + 0x6D2B79F5) | 0;
    let mixed = Math.imul(value ^ (value >>> 15), 1 | value);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}
