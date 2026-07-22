import { Injectable, Logger } from "@nestjs/common";
import { DbService } from "./db.service.js";
import { DrivingplusApiService } from "./drivingplus-api.service.js";

/**
 * 전역 행정구역 사전(region_directory)의 준비·갱신을 담당한다.
 *
 * 이 사전은 도메인별 운영 선택이 아니라 사실 참조라서 운영자가 결정할 것이 없다.
 * 그래서 도메인을 만들 때 자동으로 준비되고, 관리자는 필요할 때 수동 갱신만 할 수 있다.
 *
 * 원천이 죽어 있어도 도메인 생성과 글 생성은 계속되어야 한다. 사전이 비면 셔틀의 지역
 * 매칭만 건너뛰고 정류장·이용 조건은 그대로 나간다.
 */
@Injectable()
export class RegionDirectoryService {
  private readonly logger = new Logger(RegionDirectoryService.name);
  /** 같은 프로세스에서 동시 요청이 겹쳐도 원천을 두 번 때리지 않는다. */
  private inFlight: Promise<{ fetched: number; upserted: number; skipped: number } | null> | null = null;

  constructor(private readonly db: DbService, private readonly drivingplus: DrivingplusApiService) {}

  /** 행정구역은 수년 단위로만 바뀐다. 이 기간 안에 받은 사전은 다시 받지 않는다. */
  private static readonly FRESH_DAYS = 30;

  private isFresh(): boolean {
    const status = this.db.regionDirectoryStatus();
    if (!status.total || !status.synced_at) return false;
    const syncedAt = Date.parse(String(status.synced_at).replace(" ", "T") + "Z");
    if (!Number.isFinite(syncedAt)) return true;
    return Date.now() - syncedAt < RegionDirectoryService.FRESH_DAYS * 24 * 60 * 60 * 1000;
  }

  /** 비어 있거나 오래됐을 때만 원천을 호출한다. 이미 최신이면 아무것도 하지 않는다. */
  async ensure(): Promise<{ fetched: number; upserted: number; skipped: number } | null> {
    if (this.isFresh()) return null;
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.sync().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  /** 최신 여부와 무관하게 다시 받는다(관리자 수동 갱신·CLI). */
  async sync(): Promise<{ fetched: number; upserted: number; skipped: number }> {
    const rows = await this.drivingplus.fetchSeoRegions("all");
    return this.db.upsertRegionDirectory(rows as unknown as Parameters<DbService["upsertRegionDirectory"]>[0]);
  }

  /**
   * 도메인 생성 같은 요청 경로에서 쓴다. 실패해도 예외를 올리지 않는다.
   * 사전을 못 받았다고 도메인 생성이 막히면 안 된다.
   */
  ensureInBackground(reason: string): void {
    void this.ensure()
      .then((result) => {
        if (result) this.logger.log(`지역 사전 준비 완료(${reason}): upserted=${result.upserted} skipped=${result.skipped}`);
      })
      .catch((error: unknown) => {
        this.logger.warn(`지역 사전 준비 실패(${reason}): ${error instanceof Error ? error.message : String(error)}. 셔틀 지역 매칭만 비활성화되고 나머지 생성은 계속된다.`);
      });
  }
}
