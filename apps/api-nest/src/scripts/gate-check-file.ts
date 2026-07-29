/**
 * 생성 결과 Markdown 파일 하나에 런타임 품질 게이트를 돌린다(읽기 전용).
 * 프롬프트 실험 결과가 실제 게이트를 통과하는지 보려는 용도.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { articleQualityIssues, postSurfaceQualityIssues } from "../quality-gate.js";

const args = new Map(process.argv.slice(2).flatMap((value, index, all) => value.startsWith("--") ? [[value.slice(2), all[index + 1] || ""]] : []));
const markdown = readFileSync(resolve(required("file")), "utf8");
const facts = readFileSync(resolve(required("facts-file")), "utf8");
const domain = args.get("domain") || "app.drivingplus.me";
const images = Object.fromEntries(Array.from(facts.matchAll(/\[IMAGE:([A-Za-z0-9_-]+)\]/g)).map((match) => [match[1]!, match[1]!]));

console.log(JSON.stringify({
  file: args.get("file"),
  articleIssues: articleQualityIssues(markdown, facts, images, [], domain),
  surfaceIssues: postSurfaceQualityIssues(
    { body_markdown: markdown, title: markdown.split("\n", 1)[0]?.replace(/^#\s+/, "") ?? "" },
    Number(args.get("min-chars") || 2600),
    Number(args.get("candidates") || 0),
    [],
    domain,
  ),
}, null, 2));

function required(name: string): string {
  const value = String(args.get(name) || "").trim();
  if (!value) throw new Error(`--${name} is required`);
  return value;
}
