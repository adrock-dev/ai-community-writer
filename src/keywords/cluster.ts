import type { KeywordStat } from "./searchad.ts";

// 같은 검색 의도의 키워드 묶기. 형태소 분석기 없이
//   - 공백을 뺀 문자열이 같으면 같은 키워드
//   - 같은 지역(또는 둘 다 지역 없음)이고 같은 글 유형(intent)끼리,
//     지역명을 뺀 나머지의 글자 2-gram Jaccard ≥ threshold
//     (유형 조건이 없으면 "운전연수"가 "운전연수비용"을 흡수해 비용 주제가 사라진다)
// 이면 한 묶음으로 본다. 검색 수가 큰 키워드부터 대표(head)가 되고, 이후 키워드는 대표와만 비교한다.

export const compactKeyword = (s: string) => s.replace(/\s+/g, "").toLowerCase();

export function bigrams(s: string): Set<string> {
  const k = compactKeyword(s);
  const out = new Set<string>();
  if (k.length === 1) out.add(k);
  for (let i = 0; i < k.length - 1; i++) out.add(k.slice(i, i + 2));
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export interface ClusterInput extends KeywordStat {
  /** 지역 키(regionKey). 지역이 없으면 빈 문자열. 같은 키끼리만 묶는다. */
  region: string;
  /** 키워드에 실제로 쓰인 지역 별칭 (비교 전에 뺀다). */
  regionAlias: string;
  /** 글 유형. 같은 유형끼리만 묶는다. */
  intent: string;
}

export interface KeywordCluster {
  head: ClusterInput;
  members: ClusterInput[];
  region: string;
  volume: number;
}

export function clusterKeywords(keywords: ClusterInput[], threshold = 0.5): KeywordCluster[] {
  // 띄어쓰기만 다른 키워드("운전 연수" / "운전연수")는 검색 수가 따로 집계되므로 버리지 않고
  // 같은 묶음에 더한다(2-gram이 같아 자연히 합쳐진다).
  const sorted = [...keywords].sort(
    (a, b) => b.total - a.total || a.keyword.localeCompare(b.keyword),
  );

  const clusters: (KeywordCluster & { grams: Set<string> })[] = [];
  for (const k of sorted) {
    const core = k.regionAlias
      ? compactKeyword(k.keyword).replace(compactKeyword(k.regionAlias), "")
      : k.keyword;
    const grams = bigrams(core);
    const target = clusters.find(
      (c) =>
        c.region === k.region && c.head.intent === k.intent && jaccard(c.grams, grams) >= threshold,
    );
    if (target) {
      target.members.push(k);
      target.volume += k.total;
    } else {
      clusters.push({ head: k, members: [k], region: k.region, volume: k.total, grams });
    }
  }
  return clusters.map(({ grams: _, ...c }) => c);
}

/** 대표 키워드를 뺀 보조 키워드. 띄어쓰기만 다른 중복은 한 번만. */
export function secondaryKeywords(cluster: KeywordCluster, limit = 8): string[] {
  const seen = new Set([compactKeyword(cluster.head.keyword)]);
  const out: string[] = [];
  for (const m of [...cluster.members].sort((a, b) => b.total - a.total)) {
    const key = compactKeyword(m.keyword);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m.keyword);
    if (out.length >= limit) break;
  }
  return out;
}
