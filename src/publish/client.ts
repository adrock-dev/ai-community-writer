// 작성 도구 전용 발행 API 호출 (api.drive / api.drivingzone 공통: X-Writer-Key 헤더, ResCommonDto 응답).

export class PublishError extends Error {
  override name = "PublishError";
  readonly status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
  }
}

export type FetchLike = typeof fetch;

export class WriterApi {
  private readonly baseUrl: string;
  private readonly key: string;
  private readonly timeoutSec: number;
  private readonly fetchImpl: FetchLike;

  constructor(baseUrl: string, key: string, timeoutSec: number, fetchImpl: FetchLike = fetch) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.key = key;
    this.timeoutSec = timeoutSec;
    this.fetchImpl = fetchImpl;
  }

  async get<T>(path: string): Promise<T | undefined> {
    const res = await this.request(path, { method: "GET" });
    if (res.status === 404) return undefined;
    return this.read<T>(res, path);
  }

  async put<T>(path: string, body: unknown): Promise<T> {
    const res = await this.request(path, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return this.read<T>(res, path);
  }

  async uploadImage(
    path: string,
    file: { data: Uint8Array; name: string; type: string },
  ): Promise<{ upfileId: number; url: string }> {
    const form = new FormData();
    form.append("image", new Blob([file.data], { type: file.type }), file.name);
    const res = await this.request(path, { method: "POST", body: form });
    return this.read(res, path);
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers: { ...(init.headers as Record<string, string>), "X-Writer-Key": this.key },
        signal: AbortSignal.timeout(this.timeoutSec * 1000),
      });
    } catch (error) {
      throw new PublishError(`${this.baseUrl} 연결 실패: ${(error as Error).message}`);
    }
  }

  private async read<T>(res: Response, path: string): Promise<T> {
    const text = await res.text();
    let json: { data?: T; message?: string | string[] } | undefined;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    if (!res.ok || json?.data === undefined) {
      const message = Array.isArray(json?.message) ? json.message.join(", ") : json?.message;
      const hint =
        res.status === 401
          ? " (발행 API 키가 맞지 않습니다)"
          : res.status === 503
            ? " (대상 서버에서 작성 API가 꺼져 있습니다)"
            : "";
      throw new PublishError(
        `${path} ${res.status}: ${message || text.slice(0, 200) || "응답 없음"}${hint}`,
        res.status,
      );
    }
    return json.data;
  }
}
