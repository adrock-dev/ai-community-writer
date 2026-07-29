import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DbService } from "../db.service.js";
import { buildT01DataGatedContext } from "../t01-data-gated.js";
import { buildT01LegacyPlusContext } from "../t01-legacy-plus.js";
import { buildPosteditContext, finalizePostedit, posteditFactDiff, posteditPrompt, posteditQualityIssues } from "../t01-legacy-plus-postedit.js";
import { neutralT01QualityIssues } from "../neutral-quality-evaluator.js";
import { normalizeGeneratedMarkdown } from "../worker.service.js";
import { runLlm } from "../llm-runner.js";

type Row = Record<string, any>;
const args = new Map(process.argv.slice(2).flatMap((v,i,a)=>v.startsWith("--")?[[v.slice(2),a[i+1]||""]]:[]));
const need=(key:string)=>{const value=String(args.get(key)||"").trim();if(!value)throw new Error(`--${key} is required`);return value;};
const snapshotPath=resolve(need("snapshot-file")), draftPath=resolve(need("draft")), output=resolve(need("output")), dbPath=resolve(args.get("db")||"data/admin.db"), model=need("model"), provider=args.get("provider")||"codex", timeoutSec=Number(args.get("timeout")||600);
for(const dir of ["snapshots","locked-facts","drafts","postedit-prompts","postedit-raw","final/legacy-plus-postedit","fact-diff","quality","metrics"])mkdirSync(resolve(output,dir),{recursive:true});
const snapshot=JSON.parse(readFileSync(snapshotPath,"utf8")) as Row; const draft=readFileSync(draftPath,"utf8"); const readonly=new DatabaseSync(dbPath,{readOnly:true}); const db=new DbService();(db as any).db=readonly;
try {
 const base=snapshot.legacyPlusTypedFacts as any; const ids=base.candidates.map((c:Row)=>c.academyId); const rows=db.all(`SELECT * FROM academies WHERE domain=? AND external_id IN (${ids.map(()=>"?").join(",")})`,["app.drivingplus.me",...ids]); const byId=new Map(rows.map((r:Row)=>[String(r.external_id||r.id),r])); const ordered=ids.map((id:string)=>byId.get(String(id))); if(ordered.some((r:any)=>!r))throw new Error("snapshot candidates unavailable");
 const v2=buildT01DataGatedContext(snapshot.targetRegion,ordered as Row[],snapshot.selectionTrace,String(snapshot.slotSeed||""),["가까운","상담전확인"]); if(JSON.stringify(ids)!==JSON.stringify(v2.candidates.map(c=>c.academyId)))throw new Error("candidate order changed");
 const plus=buildT01LegacyPlusContext(v2,String(snapshot.slotSeed||"")); const context=buildPosteditContext(v2,plus.selectedReviews); const prompt=posteditPrompt(draft,context);
 write("snapshots/postedit.json",JSON.stringify(snapshot,null,2)+"\n");write("locked-facts/postedit.json",JSON.stringify(context.lockedFacts,null,2)+"\n");write("drafts/legacy-plus.md",draft);write("postedit-prompts/postedit.md",prompt);
 const result=await runLlm(prompt,{provider,model,timeoutSec,executionProfile:"content_generation"}); const raw=String(result.summary||"").trim(); const final=finalizePostedit(normalizeGeneratedMarkdown(raw,{},"app.drivingplus.me")); const diff=posteditFactDiff(draft,final,context); const issues=posteditQualityIssues(final,draft,context); const neutral=neutralT01QualityIssues(final,v2);
 write("postedit-raw/postedit.md",raw);write("final/legacy-plus-postedit/postedit.md",final);write("fact-diff/postedit.json",JSON.stringify(diff,null,2)+"\n");write("quality/postedit.json",JSON.stringify({result,issues,neutral,repairAttempts:0},null,2)+"\n");write("metrics/summary.json",JSON.stringify({targetRegion:snapshot.targetRegion,slotSeed:snapshot.slotSeed,candidateIds:ids,provider,model,timeoutSec,posteditResult:{ok:result.ok,durationSec:result.duration_sec,usage:result.usage||null,hardFailures:issues.filter(i=>i.severity==="hard_failure"),neutral},reviewCount:context.lockedFacts.selectedReviews.length,cost:"not_measured_chatgpt_cli"},null,2)+"\n"); console.log(JSON.stringify({ok:result.ok,diff,issues,neutral},null,2));
} finally {readonly.close();}
function write(path:string,value:string){writeFileSync(resolve(output,path),value,"utf8");}
