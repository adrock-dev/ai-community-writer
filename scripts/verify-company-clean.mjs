#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const join = (...parts) => parts.join("");
const forbidden = [
  join("pattern", "-", "lab"),
  join("ten", "ant"),
  join("ten", "ants"),
  join("Ten", "ant"),
  join("테", "넌", "트"),
  join("driving", "teacher"),
  join("keyword", "_", "extract"),
  join("/Users/simjaehyeong/Desktop/", "pluck"),
  join("/api/admin/", "ten", "ants"),
  join("/", "ten", "ants"),
  join("s", "aa", "s"),
  join("S", "aa", "S"),
  join("sa", "ss"),
  join("SA", "SS"),
  // 레거시 프롬프트의 "1인칭 의견 흉내" 지시(글쓴이가 직접 써본 것처럼 추천하게 만드는
  // 표현)를 막는 항목이다. 두 글자 맨 단어로 두면 "~별로 다를 수 있습니다"처럼 정상적인
  // 한국어 문장이 전부 걸려 게이트가 상시 실패했다(추적 파일 3건 포함 227건).
  // 아래 목록의 다른 항목과 마찬가지로, 이 파일 자신이 걸리지 않도록 문자열을 쪼개 둔다.
  join("개", "인", "적", "으", "로"),
  join("programmatic", "-", "seo", "-", "tool"),
  join("Programmatic", " SEO", " Admin"),
  join("SEO", " Admin"),
  join("사업", "준비"),
  join("car", "-", "mapping"),
  join("E", "C", "U"),
  join("튜", "닝"),
  join("헬", "스"),
  join("치", "과"),
];
const allowedFiles = new Set([
  // Package manager lockfiles can include third-party optional peer dependency metadata.
  "apps/admin-next/package-lock.json",
  "apps/api-nest/package-lock.json",
]);
const files = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], { encoding: "utf8" })
  .trim()
  .split("\n")
  .filter(Boolean)
  .concat(
    execFileSync("git", ["ls-files"], { encoding: "utf8" })
      .trim()
      .split("\n")
      .filter(Boolean),
  )
  .filter((file, index, all) => all.indexOf(file) === index)
  .filter((file) => !allowedFiles.has(file));
const hits = [];
for (const file of files) {
  if (!existsSync(file)) continue;
  const text = readFileSync(file, "utf8");
  for (const term of forbidden) {
    if (text.includes(term)) hits.push(`${file}: contains ${term}`);
  }
}
if (hits.length) {
  console.error("Company clean verification failed:");
  for (const hit of hits) console.error(`- ${hit}`);
  process.exit(1);
}
console.log(`Company clean verification passed (${files.length} files checked).`);
