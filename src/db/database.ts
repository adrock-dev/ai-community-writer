import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { MIGRATIONS } from "./schema.ts";

export type Row = Record<string, unknown>;
export type Params = SQLInputValue[];

/** node:sqlite 위에 얇은 헬퍼만 얹은 DB. ORM은 쓰지 않는다. */
export class Database {
  readonly raw: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.raw = new DatabaseSync(path);
    this.raw.exec(
      "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;",
    );
    this.migrate();
  }

  run(sql: string, params: Params = []): { changes: number; lastInsertRowid: number } {
    const r = this.raw.prepare(sql).run(...params);
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }

  get<T = Row>(sql: string, params: Params = []): T | undefined {
    return this.raw.prepare(sql).get(...params) as T | undefined;
  }

  all<T = Row>(sql: string, params: Params = []): T[] {
    return this.raw.prepare(sql).all(...params) as T[];
  }

  transaction<T>(fn: () => T): T {
    this.raw.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.raw.exec("COMMIT");
      return result;
    } catch (error) {
      this.raw.exec("ROLLBACK");
      throw error;
    }
  }

  /** 단순 key-value 상태 (생성 간격 등). */
  getState(key: string): string | undefined {
    return this.get<{ value: string }>("SELECT value FROM app_state WHERE key = ?", [key])?.value;
  }

  setState(key: string, value: string): void {
    this.run(
      "INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      [key, value, new Date().toISOString()],
    );
  }

  close(): void {
    this.raw.close();
  }

  /** PRAGMA user_version 기준으로 아직 적용하지 않은 마이그레이션만 순서대로 적용한다. */
  private migrate(): void {
    const current = Number(
      (this.raw.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
    );
    MIGRATIONS.forEach((sql, index) => {
      const version = index + 1;
      if (version <= current) return;
      this.transaction(() => {
        this.raw.exec(sql);
        this.raw.exec(`PRAGMA user_version = ${version}`);
      });
    });
  }
}
