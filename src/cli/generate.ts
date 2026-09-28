// 글 1편을 바로 생성한다 (생성 간격·일일 한도는 무시, LLM 사용량 한도는 지킨다).
//   npm run generate -- --topic=12
//   npm run generate -- --channel=dztraining-blog [--section=blog_training] [--type=training]
//   --dry  프롬프트만 출력하고 LLM은 호출하지 않는다
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createContext } from "../app.ts";
import { getArticle } from "../articles/store.ts";
import { findChannel, findSection } from "../channels.ts";
import { loadConfig } from "../config.ts";
import { loadGuideRules } from "../guides.ts";
import { codexImageGenerator } from "../images/generator.ts";
import { PROJECT_ROOT } from "../paths.ts";
import { avoidList } from "../similarity/fingerprint.ts";
import { getTopic, listTopics } from "../topics/store.ts";
import { buildFacts } from "../writer/facts.ts";
import { generateArticle } from "../writer/generate.ts";
import { composePrompt } from "../writer/prompt.ts";

const arg = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const dry = process.argv.includes("--dry");

const ctx = createContext(loadConfig());
try {
  let topicId = Number(arg("topic"));
  if (!topicId) {
    const channelId = arg("channel");
    if (!channelId) throw new Error("--topic=<id> 또는 --channel=<채널 id>를 지정하세요");
    const type = arg("type");
    const topic = listTopics(ctx.db, {
      channelId,
      sectionCode: arg("section"),
      status: "candidate",
      limit: 1000,
    }).find((t) => !type || t.articleType === type);
    if (!topic)
      throw new Error("조건에 맞는 주제 후보가 없습니다. npm run collect를 먼저 실행하세요");
    topicId = topic.id;
  }
  const topic = getTopic(ctx.db, topicId);
  if (!topic) throw new Error(`주제 #${topicId}가 없습니다`);
  console.log(
    `[generate] 주제 #${topic.id} ${topic.primaryKeyword} (${topic.channelId}/${topic.sectionCode}, ${topic.articleType})`,
  );

  if (dry) {
    const channel = findChannel(topic.channelId)!;
    const facts = await buildFacts(ctx.db, ctx.config.sources, topic, channel);
    const { prompt, files } = composePrompt({
      topic,
      channel,
      section: findSection(topic.channelId, topic.sectionCode)!,
      guides: loadGuideRules(ctx.db, channel.id),
      facts,
      avoid: avoidList(ctx.db, channel.id, topic.articleType),
      images: facts.images,
      today: new Date(),
    });
    console.log(
      `[generate] 프롬프트 파일: ${files.join(", ")} (${prompt.length.toLocaleString()}자)\n`,
    );
    console.log(prompt);
  } else {
    const result = await generateArticle(
      {
        db: ctx.db,
        config: ctx.config,
        llm: ctx.llm,
        images: codexImageGenerator(ctx.config.llm),
        log: (m) => console.log(`[generate] ${m}`),
      },
      topic.id,
    );
    const article = getArticle(ctx.db, result.articleId)!;
    const dir = join(PROJECT_ROOT, "output", "articles");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${article.id}-${article.channelId}.md`);
    writeFileSync(
      file,
      [
        `<!-- 글 #${article.id} · ${article.status} · ${article.provider} ${article.model} -->`,
        `<!-- 설명: ${article.summary} -->`,
        `<!-- 키워드: ${article.keywords.join(", ")} -->`,
        ...article.qualityIssues.map((i) => `<!-- 남은 문제: ${i} -->`),
        "",
        article.body,
        "",
      ].join("\n"),
    );
    console.log(`\n[generate] 저장: ${file}`);
    console.log(
      `[generate] 상태: ${result.status} · 시도 ${result.attempts}회 · 남은 문제 ${result.issues.length}건`,
    );
  }
} finally {
  ctx.db.close();
}
