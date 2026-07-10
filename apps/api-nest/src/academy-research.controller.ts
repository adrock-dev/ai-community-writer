import { Body, Controller, Get, Headers, HttpException, Inject, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { checkAuth } from "./admin.controller.js";
import { AcademyResearchDbService } from "./academy-research-db.service.js";
import { AcademyResearchService } from "./academy-research.service.js";
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
    return { count: items.length, region: region || null, items };
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

  // DrivingPlus 지역 동기화(base + 리뷰 원문)
  @Post("sync")
  async sync(@Req() req: Request, @Headers() headers: Record<string, string>, @Body() body: Row) {
    checkAuth(req, headers);
    return this.service.syncAll({ reviewLimit: Number(body?.review_limit) || 5, blogReviewLimit: Number(body?.blog_review_limit) || 5 });
  }

  // 전체 AI 조사 시작(a, 백그라운드) — run_id 반환
  @Post("research/region")
  async researchRegion(@Req() req: Request, @Headers() headers: Record<string, string>, @Body() body: Row) {
    checkAuth(req, headers);
    const provider = parseResearchProvider(body?.provider);
    const result = await this.service.startRegionResearch(undefined, { provider });
    if (!result.ok) throw new HttpException(result.error || "failed", 409);
    return result;
  }

  // 상세(집계)
  @Get(":externalId")
  detail(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("externalId") externalId: string) {
    checkAuth(req, headers);
    const full = this.db.getFull(externalId);
    if (!full) throw new HttpException("academy not found", 404);
    return full;
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
