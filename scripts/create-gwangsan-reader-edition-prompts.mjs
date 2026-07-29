#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const rawRoot = resolve(root, "deliverables/gwangsan-driving-academies-model-comparison");
const outputRoot = resolve(root, "deliverables/gwangsan-driving-academies-reader-edition");
const source = JSON.parse(readFileSync(join(rawRoot, "manifest.json"), "utf8"));
const academies = source.selection.academies.map(({ reviews, ...academy }) => academy);
source.selection.academies = academies;
const models = ["gpt-5.6-luna", "gpt-5.5"];
const articles = [
  { slug: "01-distance-and-commute", focus: "생활 동선과 실제 이동 확인을 중심으로 학원을 고르는 방법" },
  { slug: "02-registration-checklist", focus: "처음 등록하기 전 전화로 확인할 항목과 일정 계획" },
];

mkdirSync(outputRoot, { recursive: true });
writeFileSync(join(outputRoot, "manifest.json"), `${JSON.stringify({
  version: "reader-edition-v1",
  createdAt: new Date().toISOString(),
  sourceManifest: "../gwangsan-driving-academies-model-comparison/manifest.json",
  models,
  articles,
  selectedAcademies: academies,
}, null, 2)}\n`, "utf8");

for (const model of models) {
  const modelDir = join(outputRoot, model);
  mkdirSync(modelDir, { recursive: true });
  for (const article of articles) {
    writeFileSync(join(modelDir, `${article.slug}.prompt.txt`), promptFor(model, article), "utf8");
  }
}

function promptFor(model, article) {
  return `당신은 초보 운전자에게 친절하게 설명하는 한국 지역 블로그 에디터입니다. 아래 사실만 사용하여 완전한 HTML 블로그 게시글 한 편을 작성하세요.\n\n글의 중심: ${article.focus}\n생성 모델 식별: ${model}\n\n필수 형식:\n- 응답은 <!doctype html>로 시작하는 완전한 HTML만 출력합니다. 코드펜스나 작성 설명은 절대 넣지 마세요.\n- <h1>은 정확히 \"광주광역시 광산구 운전면허학원 BEST5\"입니다.\n- <head>에는 고유한 title, meta description, canonical, Open Graph 태그를 넣습니다. canonical은 https://example.com/gwangsan-driving-academies/${article.slug} 입니다.\n- JSON-LD Article과 ItemList를 포함합니다. 이 데이터는 head에만 두고, 본문에서는 기술 메타데이터를 설명하지 마세요.\n- 본문에는 아래 다섯 학원 모두를 비교표와 개별 설명에 넣습니다.\n- 글 마지막에는 <section id=\"comparison-criteria\"><h2>비교 기준</h2>을 넣고, 독자 관점의 세 항목만 자연스럽게 정리합니다: 생활 동선, 필요한 면허 과정, 등록 전 전화 확인.\n\n독자 경험 규칙:\n- 독자가 알아야 할 정보만 씁니다. \"원천 데이터\", \"고정 시드\", \"후보 수\", \"표본\", \"생성 기준\", \"모델\", \"위도\", \"경도\", \"알고리즘\"이라는 말과 정확한 기준 좌표는 본문에 절대 쓰지 마세요.\n- 거리는 \"광산구 생활권 기준 약 Nkm 직선거리\"처럼 간단히 쓰고, 실제 도로 거리·이동 시간과 다를 수 있으니 지도 앱으로 확인하라고 한 번만 안내하세요.\n- 수강료, 운영시간, 현재 셔틀, 예약 가능 여부, 합격률, 합격 보장은 확인하지 못한 사실이므로 만들거나 단정하지 마세요. 대신 독자가 전화로 무엇을 물어볼지 알려주세요.\n- 일부 후기 내용은 \"후기 일부에서는\"처럼 제한해 표현하고, 평가 점수나 특정 경험을 전체 서비스 품질로 일반화하지 마세요.\n- 순위처럼 단정하지 말고, 어떤 생활 동선·면허 과정에 맞는지 비교하세요.\n\n확인된 학원 정보:\n${JSON.stringify(source.selection.academies, null, 2)}\n`;
}
