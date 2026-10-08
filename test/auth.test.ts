import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AppContext } from "../src/app.ts";
import { parseConfig } from "../src/config.ts";
import { Database } from "../src/db/database.ts";
import { LlmClient } from "../src/llm/client.ts";
import { Pacer } from "../src/queue/pacer.ts";
import { JobQueue } from "../src/queue/queue.ts";
import { createApp } from "../src/server.ts";
import { loadLoginCredentials, unsafeHostError } from "../src/web/auth.ts";

const LOGIN = { user: "admin", password: "s3cret-pass" };

function setup(login = LOGIN) {
  const db = new Database(":memory:");
  const config = parseConfig({});
  const queue = new JobQueue(db);
  const ctx = {
    db,
    config,
    queue,
    pacer: new Pacer(db, queue, config.pacing, "generate"),
    llm: new LlmClient(db, config.llm, async () => ({ kind: "error", message: "unused" })),
    handlers: {},
  } as unknown as AppContext;
  return createApp(ctx, login);
}

const form = (fields: Record<string, string>, cookie = "") => ({
  method: "POST",
  body: new URLSearchParams(fields),
  headers: { "content-type": "application/x-www-form-urlencoded", cookie },
});

/** 로그인해서 세션 쿠키(name=value)를 돌려준다. */
async function signIn(app: ReturnType<typeof setup>): Promise<string> {
  const res = await app.request("/login", form({ ...LOGIN, next: "/articles" }));
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).toBe("/articles");
  const cookie = res.headers.get("set-cookie") ?? "";
  expect(cookie).toMatch(/HttpOnly/i);
  expect(cookie).toMatch(/SameSite=Lax/i);
  return cookie.split(";")[0]!;
}

describe("관리 화면 로그인", () => {
  it("로그인하지 않으면 화면은 로그인으로 보내고 API는 401, 삽화는 연다", async () => {
    const app = setup();
    const res = await app.request("/topics?status=queued");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(
      `/login?next=${encodeURIComponent("/topics?status=queued")}`,
    );
    expect((await app.request("/api/articles")).status).toBe(401);
    expect((await app.request("/health")).status).toBe(401);
    expect((await app.request("/articles/1/approve", form({}))).headers.get("location")).toBe(
      "/login?next=%2F",
    );
    expect((await app.request("/images/없음.png")).status).toBe(404); // 로그인 없이 통과(파일이 없을 뿐)
    const login = await (await app.request("/login")).text();
    expect(login).toContain('name="password"');
    expect(login).not.toContain("로그아웃");
  });

  it("맞는 아이디·비밀번호로 로그인하면 화면이 열리고, 로그아웃하면 다시 막힌다", async () => {
    const app = setup();
    const cookie = await signIn(app);
    const res = await app.request("/articles", { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("로그아웃");

    await app.request("/logout", form({}, cookie));
    expect((await app.request("/articles", { headers: { cookie } })).status).toBe(303);
  });

  it("틀린 비밀번호는 거절하고, 5번 틀리면 맞는 비밀번호도 잠시 막는다", async () => {
    const app = setup();
    for (let i = 0; i < 5; i++) {
      const res = await app.request("/login", form({ user: "admin", password: "wrong" }));
      expect(res.status).toBe(401);
      expect(res.headers.get("set-cookie")).toBeNull();
    }
    expect((await app.request("/login", form(LOGIN))).status).toBe(429);
  });

  it("로그인 뒤 이동 주소는 이 서버 안의 경로만 받는다", async () => {
    const app = setup();
    for (const next of ["https://evil.example", "//evil.example", "/\\evil.example"]) {
      const res = await app.request("/login", form({ ...LOGIN, next }));
      expect(res.headers.get("location")).toBe("/");
    }
  });

  it("로그인 정보 없이 바깥(0.0.0.0)에 열려고 하면 막는다", () => {
    const open = parseConfig({ server: { host: "0.0.0.0" } });
    expect(unsafeHostError(open, undefined)).toMatch(/WRITER_LOGIN_PASSWORD/);
    expect(unsafeHostError(open, LOGIN)).toBe("");
    expect(unsafeHostError(parseConfig({}), undefined)).toBe("");
  });

  it("로그인 정보를 못 찾으면 파일 위치와 빠진 키를 알려 주고, 메모장 UTF-16 파일도 읽는다", () => {
    const dir = mkdtempSync(join(tmpdir(), "auth-"));
    const file = join(dir, "writer.env");
    const config = parseConfig({ server: { host: "0.0.0.0", credentialsFile: file } });

    writeFileSync(`${file}.txt`, "WRITER_LOGIN_USER=a\n");
    expect(unsafeHostError(config, loadLoginCredentials(config))).toMatch(
      /writer\.env\.txt 가 있습니다/,
    );

    writeFileSync(file, "WRITER_LOGIN_USER=a\nWRITER_LOGIN_PASSWORD=\n");
    const error = unsafeHostError(config, loadLoginCredentials(config));
    expect(error).toMatch(/WRITER_LOGIN_PASSWORD 값이 없습니다/);
    expect(error).not.toContain("=a");

    const utf16 = "\uFEFFWRITER_LOGIN_USER=관리자\r\nWRITER_LOGIN_PASSWORD=비밀\r\n";
    writeFileSync(file, Buffer.from(utf16, "utf16le"));
    expect(loadLoginCredentials(config)).toEqual({ user: "관리자", password: "비밀" });
  });
});
