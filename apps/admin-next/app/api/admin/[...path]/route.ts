import { NextRequest } from "next/server";

const API_BASE = (process.env.SEO_API_BASE_URL ?? "http://127.0.0.1:8765").replace(/\/$/, "");
const ADMIN_TOKEN = process.env.ADMIN_API_TOKEN ?? "";

type RouteContext = { params: Promise<{ path: string[] }> };

async function proxy(request: NextRequest, context: RouteContext): Promise<Response> {
  const params = await context.params;
  const path = params.path.map(encodeURIComponent).join("/");
  const source = new URL(request.url);
  const target = new URL(`${API_BASE}/api/admin/${path}`);
  target.search = source.search;

  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  const cookie = request.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  const browserToken = request.headers.get("x-admin-token") || request.headers.get("authorization");
  if (browserToken) {
    if (browserToken.toLowerCase().startsWith("bearer ")) headers.set("authorization", browserToken);
    else headers.set("x-admin-token", browserToken);
  } else if (ADMIN_TOKEN) {
    headers.set("x-admin-token", ADMIN_TOKEN);
  }

  const method = request.method.toUpperCase();
  const body = method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer();
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method,
      headers,
      body,
      cache: "no-store",
    });
  } catch (err) {
    // 백엔드 Nest API(SEO_API_BASE_URL)에 연결 실패(미기동/다운 등)를 원인이 드러나는 502로 감싼다.
    const detail = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({
        error: "backend_unreachable",
        message: `콘텐츠 API(${API_BASE})에 연결할 수 없습니다. Nest API가 실행 중인지 확인하세요.`,
        detail,
      }),
      { status: 502, headers: { "content-type": "application/json; charset=utf-8" } },
    );
  }

  const outHeaders = new Headers();
  const upstreamType = upstream.headers.get("content-type");
  if (upstreamType) outHeaders.set("content-type", upstreamType);
  return new Response(await upstream.arrayBuffer(), {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders,
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
