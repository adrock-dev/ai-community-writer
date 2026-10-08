import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { html } from "hono/html";
import type { AppConfig } from "../config.ts";
import { readEnvFile } from "../keywords/searchad.ts";
import { navState, page } from "./layout.ts";

// 관리 화면 로그인. 인증 파일(server.credentialsFile)에 아이디·비밀번호가 있으면 모든 화면·API에 로그인을 요구한다.
// 없으면 예전처럼 로그인 없이 열리지만, 그때는 127.0.0.1 에서만 서버를 열 수 있다(assertSafeHost).
// 세션은 메모리에만 두므로 서버를 다시 시작하면 다시 로그인한다. 비밀번호를 바꾸면 재시작해야 적용된다.

export const LOGIN_USER_KEY = "WRITER_LOGIN_USER";
export const LOGIN_PASSWORD_KEY = "WRITER_LOGIN_PASSWORD";

const COOKIE = "aiw_session";
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;
/** 로그인 없이 여는 경로. 생성 삽화는 서식 복사로 붙여 넣은 에디터에서도 보여야 한다. */
const PUBLIC_PATHS = [/^\/login$/, /^\/images\/[^/]+$/];

export interface LoginCredentials {
  user: string;
  password: string;
}

/** 로그인 아이디·비밀번호. 환경 변수가 우선이고 없으면 인증 파일. 둘 다 있어야 켜진다. */
export function loadLoginCredentials(config: AppConfig): LoginCredentials | undefined {
  const file = readEnvFile(config.server.credentialsFile);
  const user = process.env[LOGIN_USER_KEY] || file[LOGIN_USER_KEY] || "";
  const password = process.env[LOGIN_PASSWORD_KEY] || file[LOGIN_PASSWORD_KEY] || "";
  return user && password ? { user, password } : undefined;
}

const LOOPBACK_HOSTS = ["127.0.0.1", "localhost", "::1"];

/** 로그인 없이 바깥에 열려는 설정을 막는다. 문제가 있으면 오류 문구를 돌려준다. */
export function unsafeHostError(config: AppConfig, login: LoginCredentials | undefined): string {
  if (login || LOOPBACK_HOSTS.includes(config.server.host)) return "";
  return (
    `server.host 가 ${config.server.host} 인데 로그인 정보가 없습니다. ` +
    `${config.server.credentialsFile} 에 ${LOGIN_USER_KEY}=… 와 ${LOGIN_PASSWORD_KEY}=… 를 적거나 ` +
    `server.host 를 127.0.0.1 로 두세요.`
  );
}

/** 길이와 상관없이 같은 시간에 비교한다. */
function same(a: string, b: string): boolean {
  const hash = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(hash(a), hash(b));
}

/** 다른 사이트로 보내지 않도록 이 서버 안의 경로만 받는다. */
function safeNext(next: string | undefined): string {
  return next?.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

function clientIp(c: Context): string {
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown"; // 테스트(app.request)처럼 소켓이 없는 요청
  }
}

function loginPage(next: string, error?: string) {
  return page(
    "로그인",
    html`<section class="card" style="max-width:360px;margin:40px auto">
  <header><h2>로그인</h2></header>
  <form method="post" action="/login">
    <input type="hidden" name="next" value="${next}">
    <div class="field"><label>아이디</label><input type="text" name="user" autocomplete="username" required autofocus></div>
    <div class="field"><label>비밀번호</label><input type="password" name="password" autocomplete="current-password" required></div>
    <button class="primary">로그인</button>
  </form>
</section>`,
    { error, hideNav: true },
  );
}

export function mountAuth(app: Hono, login: LoginCredentials | undefined): void {
  navState.logout = Boolean(login);
  if (!login) return;

  const sessions = new Map<string, number>(); // 토큰 → 만료 시각
  const failures = new Map<string, { count: number; until: number }>(); // IP → 실패 횟수·잠금 해제 시각

  app.use("*", async (c, next) => {
    if (PUBLIC_PATHS.some((p) => p.test(c.req.path))) return next();
    const token = getCookie(c, COOKIE);
    const expires = token ? sessions.get(token) : undefined;
    if (token && expires && expires > Date.now()) return next();
    if (token) sessions.delete(token);
    if (c.req.path.startsWith("/api/") || c.req.path === "/health") {
      return c.json({ error: "로그인이 필요합니다" }, 401);
    }
    const back = c.req.method === "GET" ? c.req.path + new URL(c.req.url).search : "/";
    return c.redirect(`/login?next=${encodeURIComponent(back)}`, 303);
  });

  app.get("/login", (c) => c.html(loginPage(safeNext(c.req.query("next")))));

  app.post("/login", async (c) => {
    const form = await c.req.parseBody();
    const next = safeNext(String(form.next ?? ""));
    const ip = clientIp(c);
    const now = Date.now();
    const record = failures.get(ip);
    if (record && record.until > now) {
      return c.html(
        loginPage(next, "로그인 실패가 많아 15분 동안 막았습니다. 잠시 뒤 다시 시도하세요."),
        429,
      );
    }
    const ok =
      same(String(form.user ?? ""), login.user) &&
      same(String(form.password ?? ""), login.password);
    if (!ok) {
      const count = (record && record.until === 0 ? record.count : 0) + 1;
      failures.set(
        ip,
        count >= MAX_FAILURES ? { count: 0, until: now + LOCK_MS } : { count, until: 0 },
      );
      console.warn(`[writer] 로그인 실패 (${ip})`);
      return c.html(loginPage(next, "아이디 또는 비밀번호가 맞지 않습니다."), 401);
    }
    failures.delete(ip);
    for (const [t, exp] of sessions) if (exp <= now) sessions.delete(t);
    const token = randomBytes(32).toString("hex");
    sessions.set(token, now + SESSION_MS);
    setCookie(c, COOKIE, token, {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: SESSION_MS / 1000,
    });
    return c.redirect(next, 303);
  });

  app.post("/logout", (c) => {
    const token = getCookie(c, COOKIE);
    if (token) sessions.delete(token);
    deleteCookie(c, COOKIE, { path: "/" });
    return c.redirect("/login", 303);
  });
}
