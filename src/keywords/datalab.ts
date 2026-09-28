// 네이버 데이터랩 검색어 트렌드(선택). 검색광고 API는 최근 30일 절대량만 주므로,
// 추세(최근 4주 / 이전 8주 평균 비율)를 점수에 반영할 때만 쓴다.
// naver.datalabClientId/Secret이 없으면 추세 없이 진행한다.

export interface DatalabCredentials {
  clientId: string;
  clientSecret: string;
}

function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 주간 ratio 배열에서 최근 4주 평균 / 이전 8주 평균. 데이터가 모자라면 undefined. */
export function trendRatio(ratios: number[]): number | undefined {
  if (ratios.length < 12) return undefined;
  const recent = ratios.slice(-4);
  const before = ratios.slice(-12, -4);
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const base = avg(before);
  if (base <= 0) return undefined;
  return Math.round((avg(recent) / base) * 100) / 100;
}

/**
 * 키워드 그룹별 추세. 한 요청에 5그룹까지라 나눠 보낸다.
 * groups: { 그룹명: [키워드...] } (그룹명은 대표 키워드)
 */
export async function fetchTrends(
  creds: DatalabCredentials,
  groups: Record<string, string[]>,
  opts: { fetch?: typeof fetch; now?: Date } = {},
): Promise<Record<string, number | undefined>> {
  const doFetch = opts.fetch ?? fetch;
  const end = opts.now ?? new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 7 * 13);
  const names = Object.keys(groups);
  const out: Record<string, number | undefined> = {};
  for (let i = 0; i < names.length; i += 5) {
    const batch = names.slice(i, i + 5);
    const res = await doFetch("https://openapi.naver.com/v1/datalab/search", {
      method: "POST",
      headers: {
        "X-Naver-Client-Id": creds.clientId,
        "X-Naver-Client-Secret": creds.clientSecret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        startDate: ymd(start),
        endDate: ymd(end),
        timeUnit: "week",
        keywordGroups: batch.map((name) => ({
          groupName: name,
          keywords: (groups[name] ?? [name]).slice(0, 20),
        })),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`데이터랩 API ${res.status} ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as { results?: { title: string; data: { ratio: number }[] }[] };
    for (const r of body.results ?? []) out[r.title] = trendRatio(r.data.map((d) => d.ratio));
  }
  return out;
}
