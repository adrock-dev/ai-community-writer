#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const rawRoot = resolve(root, "deliverables/gwangsan-driving-academies-model-comparison");
const outputRoot = resolve(root, "deliverables/gwangsan-driving-academies-reader-edition");
const models = ["gpt-5.6-luna", "gpt-5.5"];
const pages = [
  { raw: "01-distance-and-commute", output: "01-distance-and-commute" },
  { raw: "04-registration-checklist", output: "02-registration-checklist" },
];

mkdirSync(outputRoot, { recursive: true });
for (const model of models) {
  const modelDir = join(outputRoot, model);
  mkdirSync(modelDir, { recursive: true });
  for (const page of pages) {
    const raw = readFileSync(join(rawRoot, model, `${page.raw}.html`), "utf8");
    writeFileSync(join(modelDir, `${page.output}.html`), readerEdition(raw, page), "utf8");
  }
}

writeFileSync(join(outputRoot, "editorial-note.json"), `${JSON.stringify({
  version: "reader-edition-v1",
  source: "각 모델의 원문 HTML 2편에서 독자에게 불필요한 내부 데이터·재현성 설명만 공통 편집 규칙으로 제거",
  retained: ["모델별 본문 구성과 문체", "학원별 주소·거리·공개 과정·전화 정보", "SEO 메타데이터와 JSON-LD"],
  removedFromVisibleBody: ["고정 시드", "후보 수", "정확한 기준 좌표", "원천 데이터·표본·생성 기준 설명"],
}, null, 2)}\n`, "utf8");

function readerEdition(html, page) {
  let out = html;
  out = out.replace(/<section\b[^>]*\bid=["']generation-criteria["'][^>]*>[\s\S]*?<\/section>/gi, "");
  out = out.replace(/<section\b[^>]*\bid=["']criteria["'][^>]*>[\s\S]*?<\/section>/gi, "");
  out = out.replace(/<section\b[^>]*\bid=["']generationCriteria["'][^>]*>[\s\S]*?<\/section>/gi, "");
  out = out.replace(/광주광역시 광산구 기준 좌표\s*(?:<strong>)?\s*\(?35\.139524\s*,\s*126\.793688\)?\s*(?:<\/strong>)?/g, "광산구 생활권 기준");
  out = out.replace(/\(?35\.139524\s*,\s*126\.793688\)?/g, "광산구 생활권 기준");
  out = out.replace(/원천 데이터/g, "공개 안내 정보");
  out = out.replace(/원천에 남은/g, "공개 안내에 포함된");
  out = out.replace(/5개 표본/g, "5곳");
  out = out.replace(/표본/g, "비교 대상");
  out = out.replace(/비교 대상은 원천에서 제공된 5개 학원을 표본으로 포함했습니다\.?/g, "비교 대상은 5곳의 운전전문학원입니다.");
  out = out.replace(/<\/main>/i, `${comparisonCriteria()}\n    </main>`);
  if (page.raw !== page.output) out = out.replaceAll(`/${page.raw}",`, `/${page.output}",`).replaceAll(`/${page.raw}<`, `/${page.output}<`);
  return out;
}

function comparisonCriteria() {
  return `
      <section id="comparison-criteria" aria-labelledby="comparison-criteria-title">
        <h2 id="comparison-criteria-title">비교 기준</h2>
        <ul>
          <li><strong>생활 동선:</strong> 표의 거리는 광산구 생활권 기준 직선거리이므로, 실제 출발지에서의 도로 이동 시간은 지도 앱으로 한 번 더 확인하세요.</li>
          <li><strong>필요한 면허 과정:</strong> 1종·2종 보통 외에 대형·소형·특수 과정이 필요한 경우에는 현재 개설 여부를 먼저 문의하세요.</li>
          <li><strong>등록 전 전화 확인:</strong> 수강료, 가능한 시작일, 수업 시간, 셔틀·이동 지원, 일정 변경 규정은 학원마다 다를 수 있으니 상담 때 직접 확인하세요.</li>
        </ul>
      </section>`;
}
