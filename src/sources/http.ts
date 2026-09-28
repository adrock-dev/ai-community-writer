import type { Database } from "../db/database.ts";

/** `{ code, message, data }` 형태 응답의 data를 돌려준다. api.drive와 api.drivingzone 공통. */
export async function getData<T>(url: string, timeoutSec: number): Promise<T> {
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(timeoutSec * 1000),
  });
  if (!res.ok) throw new Error(`${url} 응답 ${res.status}`);
  const body = (await res.json()) as { code?: number; message?: string; data?: T };
  if (body.data === undefined)
    throw new Error(`${url} 응답에 data가 없습니다 (${body.message ?? ""})`);
  return body.data;
}

export interface Cached<T> {
  value: T;
  fetchedAt: string;
  /** 새로 받지 못해 오래된 캐시를 돌려줬다면 그 이유. */
  staleReason?: string;
}

/**
 * source_cache에 TTL 동안 보관한다. 새로 받다 실패하면 오래된 캐시라도 돌려주고
 * staleReason에 이유를 남긴다(캐시도 없으면 오류).
 */
export async function cached<T>(
  db: Database,
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
  now: Date = new Date(),
): Promise<Cached<T>> {
  const row = db.get<{ fetched_at: string; payload: string }>(
    "SELECT fetched_at, payload FROM source_cache WHERE key = ?",
    [key],
  );
  if (row && now.getTime() - new Date(row.fetched_at).getTime() < ttlMs) {
    return { value: JSON.parse(row.payload) as T, fetchedAt: row.fetched_at };
  }
  try {
    const value = await load();
    const fetchedAt = now.toISOString();
    db.run(
      "INSERT INTO source_cache (key, fetched_at, payload) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET fetched_at = excluded.fetched_at, payload = excluded.payload",
      [key, fetchedAt, JSON.stringify(value)],
    );
    return { value, fetchedAt };
  } catch (error) {
    if (!row) throw error;
    return {
      value: JSON.parse(row.payload) as T,
      fetchedAt: row.fetched_at,
      staleReason: error instanceof Error ? error.message : String(error),
    };
  }
}
