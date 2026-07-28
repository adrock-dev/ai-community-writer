import { Body, Controller, Get, Headers, HttpException, Inject, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { checkAuth } from "./admin.controller.js";
import { AcademyResearchDbService } from "./academy-research-db.service.js";
import { AcademyResearchService } from "./academy-research.service.js";
import { knownFactsFromSource } from "./academy-research-known-facts.js";
import type { ResearchProviderPreference } from "./academy-research-llm.js";

type Row = Record<string, any>;

// 학원 심층조사 전용 관리자 API. 기존 도메인 라우트(api/admin/*)와 경로를 분리해 충돌 방지.
@Controller("api/admin/academy-research")
export class AcademyResearchController {
  constructor(
    @Inject(AcademyResearchDbService) private readonly db: AcademyResearchDbService,
    @Inject(AcademyResearchService) private readonly service: AcademyResearchService,
  ) {}

  // 목록(부산 파일럿: region=부산). 조사 여부 요약 포함.
  @Get("list")
  list(@Req() req: Request, @Headers() headers: Record<string, string>, @Query("region") region?: string, @Query("q") q?: string) {
    checkAuth(req, headers);
    const items = this.db.listBase({ region: region || undefined, q: q || undefined, limit: 5000 });
    // hidden = 최신 동기화 목록에 없어 제외된 학원 수(삭제하지 않고 보관만 한다).
    return { count: items.length, region: region || null, items, hidden: this.db.countInactive() };
  }

  // 검증상태 정의(확장 가능)
  @Get("status-defs")
  statusDefs(@Req() req: Request, @Headers() headers: Record<string, string>) {
    checkAuth(req, headers);
    return { items: this.db.listStatusDefs() };
  }

  // 조사 실행 이력(진행률 폴링용)
  @Get("runs")
  runs(@Req() req: Request, @Headers() headers: Record<string, string>, @Query("limit") limit?: string) {
    checkAuth(req, headers);
    return { items: this.db.listRuns(Number(limit) || 30) };
  }

  @Get("runs/:runId")
  run(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("runId") runId: string) {
    checkAuth(req, headers);
    const run = this.db.getRun(runId);
    if (!run) throw new HttpException("run not found", 404);
    return run;
  }

  // 실행 취소 요청. 즉시 끊지 않고 플래그만 세운다 —
  // 실행 루프가 학원 사이에서 확인하므로 처리 중이던 학원은 온전히 끝난다.
  @Post("runs/:runId/cancel")
  cancelRun(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("runId") runId: string) {
    checkAuth(req, headers);
    if (!this.db.getRun(runId)) throw new HttpException("run not found", 404);
    const requested = this.db.requestCancel(runId);
    if (!requested) throw new HttpException("이미 종료된 실행입니다.", 409);
    return { ok: true, run_id: runId };
  }

  // DrivingPlus 전체 동기화(base + 리뷰 원문). 백그라운드로 돌고 run_id 를 즉시 반환한다 —
  // 응답을 끝까지 기다리면 그 사이 API 재시작·창 닫기만으로 요청이 끊긴다.
  @Post("sync")
  sync(@Req() req: Request, @Headers() headers: Record<string, string>, @Body() body: Row) {
    checkAuth(req, headers);
    const result = this.service.startSync({ reviewLimit: Number(body?.review_limit) || 5 });
    if (!result.ok) throw new HttpException(result.error || "failed", 409);
    return result;
  }

  // 블로그리뷰만 별도 실행. 원천의 블로그리뷰 조회가 학원당 10초라 기본정보 갱신과 묶으면
  // 급한 갱신까지 그 속도에 끌려간다.
  @Post("sync/blog-reviews")
  syncBlogReviews(@Req() req: Request, @Headers() headers: Record<string, string>, @Body() body: Row) {
    checkAuth(req, headers);
    const result = this.service.startBlogSync({ blogReviewLimit: Number(body?.blog_review_limit) || 5 });
    if (!result.ok) throw new HttpException(result.error || "failed", 409);
    return result;
  }

  // 전체 AI 조사 시작(a, 백그라운드) — run_id 반환
  @Post("research/region")
  async researchRegion(@Req() req: Request, @Headers() headers: Record<string, string>, @Body() body: Row) {
    checkAuth(req, headers);
    const provider = parseResearchProvider(body?.provider);
    const result = await this.service.startRegionResearch(undefined, {
      provider,
      refreshAll: body?.refresh_all === true,
      limit: parseLimit(body?.limit),
      offset: parseOffset(body?.offset),
    });
    if (!result.ok) throw new HttpException(result.error || "failed", 409);
    return result;
  }

  // 검토 대기 목록(학원 가로질러 필드 단위). :externalId 보다 먼저 선언해야 경로가 안 먹힌다.
  @Get("review-queue")
  reviewQueue(
    @Req() req: Request,
    @Headers() headers: Record<string, string>,
    @Query("status") status?: string,
    @Query("q") q?: string,
    @Query("limit") limit?: string,
  ) {
    checkAuth(req, headers);
    const statuses = String(status || "needs_review,ai_draft").split(",").map((s) => s.trim()).filter(Boolean);
    return this.db.listReviewQueue({ statuses, q: q || undefined, limit: Number(limit) || 200 });
  }

  // 상세(집계)
  @Get(":externalId")
  detail(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("externalId") externalId: string) {
    checkAuth(req, headers);
    const full = this.db.getFull(externalId);
    if (!full) throw new HttpException("academy not found", 404);
    // 원천이 답을 가진 항목은 조사에서 빠져 조사값이 빈다. 화면에 원천 사실을 함께 내려주지 않으면
    // "조사가 실패했다" 로 읽힌다. 생성 프롬프트에 들어가는 것과 같은 문장을 쓴다(표현 어긋남 방지).
    const known = knownFactsFromSource(parseRawJson(full.base?.raw_json));
    return { ...full, source_facts: known.lines };
  }

  // 단건 동기화(기본정보/리뷰 새로고침)
  @Post(":externalId/sync")
  async syncOne(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("externalId") externalId: string) {
    checkAuth(req, headers);
    return this.service.syncOne(externalId);
  }

  // 단건 AI 조사(b, 동기)
  @Post(":externalId/research")
  async researchOne(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("externalId") externalId: string, @Body() body: Row) {
    checkAuth(req, headers);
    const provider = parseResearchProvider(body?.provider);
    const result = await this.service.researchOne(externalId, { method: "b_single", provider });
    // 소스 못 찾음은 실패가 아니라 명시적 상태로 반환.
    if (!result.ok && !result.no_sources) throw new HttpException(result.error || "failed", 400);
    return result;
  }

  // 조사 필드 수동편집
  @Patch(":externalId/field")
  updateField(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("externalId") externalId: string, @Body() body: Row) {
    checkAuth(req, headers);
    const field = String(body?.field || "").trim();
    if (!field) throw new HttpException("field is required", 400);
    const ok = this.db.updateResearchField(externalId, field, body?.value ?? null);
    if (!ok) throw new HttpException(`허용되지 않는 필드: ${field}`, 400);
    return { ok: true, external_id: externalId, field };
  }

  // 필드별 검증상태 토글/출처 설정
  @Patch(":externalId/field-meta")
  setFieldMeta(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("externalId") externalId: string, @Body() body: Row) {
    checkAuth(req, headers);
    const fieldKey = String(body?.field_key || "").trim();
    if (!fieldKey) throw new HttpException("field_key is required", 400);
    this.db.setFieldMeta(externalId, fieldKey, {
      status: body?.status ? String(body.status) : undefined,
      source_url: body?.source_url ? String(body.source_url) : undefined,
      source_name: body?.source_name ? String(body.source_name) : undefined,
      confidence: body?.confidence ? String(body.confidence) : undefined,
      verified_by: body?.verified_by ? String(body.verified_by) : undefined,
      note: body?.note ? String(body.note) : undefined,
    });
    return { ok: true, external_id: externalId, field_key: fieldKey };
  }
}

function parseResearchProvider(value: unknown): ResearchProviderPreference {
  if (value == null || value === "") return "auto";
  if (value === "auto" || value === "codex" || value === "claude") return value;
  throw new HttpException("provider must be auto, codex or claude", 400);
}

// 이번 실행에서 조사할 학원 수 상한. 학원 1곳이 수집+LLM 으로 1분 안팎이라
// 전체를 한 번에 돌리면 몇 시간이 걸린다. 나눠 돌릴 수 있게 받는다.
function parseLimit(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) throw new HttpException("limit must be a positive number", 400);
  return Math.min(5000, Math.trunc(n));
}

function parseOffset(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new HttpException("offset must be zero or positive number", 400);
  return Math.trunc(n);
}

// raw_json 은 TEXT 라 문자열로 온다. 손상된 값이 상세 조회를 막지 않게 한다.
function parseRawJson(value: unknown): unknown {
  if (value == null) return null;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return null; }
}
