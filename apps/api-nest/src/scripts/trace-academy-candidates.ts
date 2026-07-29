import { runReadonlyCandidateTrace } from "../academy-candidate-trace.js";

function argument(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : "";
  if (!value || value.startsWith("--")) throw new Error(`--${name} is required`);
  return value;
}

const trace = await runReadonlyCandidateTrace({
  dbPath: argument("db"),
  domain: argument("domain"),
  targetRegion: argument("region"),
  slotSeed: process.argv.includes("--slot-seed") ? argument("slot-seed") : undefined,
});
console.log(JSON.stringify(trace, null, 2));
