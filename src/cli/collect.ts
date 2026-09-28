// 키워드 수집을 바로 실행하고 섹션별 상위 주제를 보여준다: `npm run collect`
import { runCollect } from "../app.ts";
import { CHANNELS } from "../channels.ts";
import { loadConfig } from "../config.ts";
import { Database } from "../db/database.ts";
import { regionLabel } from "../keywords/regions.ts";
import { resolvePath } from "../paths.ts";
import { articleTypeLabel } from "../topics/intent.ts";
import { listTopics } from "../topics/store.ts";

const config = loadConfig();
const db = new Database(resolvePath(config.dbPath));
const top = Number(process.argv.find((a) => /^--top=\d+$/.test(a))?.slice(6) ?? 10);

try {
  const summary = await runCollect(config, db, (m) => console.log(`[collect] ${m}`));
  for (const w of summary.warnings) console.log(`[collect] ! ${w}`);

  for (const channel of CHANNELS) {
    for (const section of channel.sections) {
      const topics = listTopics(db, {
        channelId: channel.id,
        sectionCode: section.code,
        status: "candidate",
        limit: top,
      });
      if (!topics.length) continue;
      console.log(`\n■ ${channel.label} / ${section.label} (${section.code})`);
      for (const t of topics) {
        const region = t.region ? ` [${regionLabel(t.region)}]` : "";
        const trend = t.trend === null ? "" : ` 추세 ${t.trend}`;
        const more = t.secondaryKeywords.slice(0, 3).join(", ");
        console.log(
          `  ${t.score.toFixed(2).padStart(5)}  ${t.primaryKeyword}${region} · ${articleTypeLabel(t.articleType)} · 30일 ${t.volume.toLocaleString()}회${trend}${more ? ` · ${more}` : ""}`,
        );
      }
    }
  }
  const failed = summary.sections.filter((s) => s.error);
  process.exitCode = failed.length ? 1 : 0;
} finally {
  db.close();
}
