// 사용량 한도 판정. CLI는 남은 사용량 API를 따로 주지 않으므로
//   - 호출 결과에 실린 사용률(Claude rate_limit_event, Codex 세션 로그 rate_limits)로 미리 멈추고
//   - 그래도 한도에 걸리면 오류 문구에서 해제 시각을 읽어 그때까지 멈춘다.

export interface UsageWindow {
  /** 예: five_hour, seven_day, primary(300m) */
  name: string;
  usedPercent: number;
  /** ISO 시각. 알 수 없으면 undefined. */
  resetsAt?: string;
}

const LIMIT_PATTERN =
  /usage limit|rate[ _-]?limit|too many requests|\b429\b|quota|limit reached|hit your .{0,20}limit|out of (?:credits|usage)/i;

export function looksRateLimited(text: string): boolean {
  return LIMIT_PATTERN.test(text);
}

const UNIT_MS: Record<string, number> = { d: 86_400_000, h: 3_600_000, m: 60_000, s: 1000 };

function unitOf(word: string): number | undefined {
  const w = word.toLowerCase();
  if (w.startsWith("d") || w === "일") return UNIT_MS.d;
  if (w.startsWith("h") || w === "시간") return UNIT_MS.h;
  if (w.startsWith("mi") || w === "m" || w === "분") return UNIT_MS.m;
  if (w.startsWith("s") || w === "초") return UNIT_MS.s;
  return undefined;
}

/** "3:45 PM", "17:30" 같은 시각을 now 이후 가장 가까운 로컬 시각으로. */
function nextClock(now: Date, hour: number, minute: number, meridiem?: string): Date {
  let h = hour % 12;
  if (!meridiem) h = hour;
  else if (meridiem.toLowerCase() === "pm") h += 12;
  const at = new Date(now);
  at.setHours(h, minute, 0, 0);
  if (at <= now) at.setDate(at.getDate() + 1);
  return at;
}

/** 한도 오류 문구에서 해제 시각을 읽는다. 읽지 못하면 undefined. */
export function parseResetTime(text: string, now: Date = new Date()): Date | undefined {
  // Claude 구형: "Claude AI usage limit reached|1759064400"
  const epoch = /\|(\d{10})(?:\D|$)/.exec(text) ?? /resets?_?at["':\s]+(\d{10})/i.exec(text);
  if (epoch?.[1]) return new Date(Number(epoch[1]) * 1000);

  const iso = /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2}))/.exec(
    text,
  );
  if (iso?.[1] && looksRateLimited(text)) return new Date(iso[1]);

  // "try again in 2 days 3 hours 4 minutes", "resets in 45m"
  const rel = /(?:in|after)\s+((?:\d+\s*[a-z가-힣]+[\s,]*(?:and\s+)?)+)/i.exec(text);
  if (rel?.[1]) {
    let ms = 0;
    for (const m of rel[1].matchAll(/(\d+)\s*([a-z가-힣]+)/gi)) {
      const unit = unitOf(m[2] ?? "");
      if (unit) ms += Number(m[1]) * unit;
    }
    if (ms > 0) return new Date(now.getTime() + ms);
  }

  // "try again at 4:41 PM", "resets 5pm", "resets at 17:30"
  const clock = /(?:at|resets?)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i.exec(text);
  if (clock?.[1] && (clock[2] || clock[3])) {
    return nextClock(now, Number(clock[1]), Number(clock[2] ?? 0), clock[3]);
  }
  return undefined;
}

/**
 * 사용률이 기준 이상인 창이 있으면 그 창이 풀리는 시각을 돌려준다(여러 개면 가장 늦은 것).
 * 해제 시각을 모르면 fallback을 쓴다.
 */
export function pauseUntilForUsage(
  usage: UsageWindow[],
  pauseAtPercent: number,
  fallback: Date,
): Date | undefined {
  let until: Date | undefined;
  for (const w of usage) {
    if (w.usedPercent < pauseAtPercent) continue;
    const at = w.resetsAt ? new Date(w.resetsAt) : fallback;
    if (!until || at > until) until = at;
  }
  return until;
}
