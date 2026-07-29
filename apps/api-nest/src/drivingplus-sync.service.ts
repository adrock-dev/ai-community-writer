import { Inject, Injectable, Logger } from "@nestjs/common";
import { DbService } from "./db.service.js";
import { CancelledError, DrivingplusApiService } from "./drivingplus-api.service.js";
import { RegionDirectoryService } from "./region-directory.service.js";

type StartResult = { ok: true; run_id: string } | { ok: false; error: string };

export interface AcademySyncOptions {
  includeReviews?: boolean;
  reviewLimit?: number;
  reviewSort?: "new" | "point";
  includeBlogReviews?: boolean;
  blogReviewLimit?: number;
}

/**
 * 원천(DrivingPlus) 학원 동기화를 백그라운드로 돌린다.
 *
 * 왜 HTTP 응답 안에서 안 기다리는가: 블로그리뷰를 포함하면 학원 380곳에 12분 넘게 걸리는데,
 * Node fetch 는 헤더를 300초 안에 못 받으면 UND_ERR_HEADERS_TIMEOUT 으로 끊는다(실측 301초).
 * 관리자 UI 는 Next 프록시를 거치며 이 fetch 를 쓰므로 응답이 절대 도착하지 못한다.
 * 더 나쁜 건 서버 쪽 핸들러는 계속 돈다는 점이다 — 화면엔 실패로 보이는데 동기화는 완료되고,
 * 운영자가 다시 누르면 원천에 이중 부하가 걸린다.
 *
 * 왜 jobs 큐(워커)를 안 쓰는가: 워커는 잡을 하나씩 claim 하므로 12분짜리 동기화가 들어가면
 * 그동안 글 생성이 통째로 밀린다. 동기화는 원천 I/O 대기가 대부분이라 워커 슬롯을 잡을 이유가 없다.
 */
@Injectable()
export class DrivingplusSyncService {
  private readonly logger = new Logger(DrivingplusSyncService.name);

  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(DrivingplusApiService) private readonly drivingplus: DrivingplusApiService,
    @Inject(RegionDirectoryService) private readonly regionDirectory: RegionDirectoryService,
  ) {}

  /** 학원 동기화를 시작하고 run_id 를 즉시 돌려준다. */
  startAcademySync(domain: string, opts: AcademySyncOptions = {}): StartResult {
    // 같은 원천을 두드리므로 도메인이 달라도 동시에 돌리지 않는다.
    const running = this.db.findRunningSyncRun();
    if (running) {
      return { ok: false, error: `이미 진행 중인 동기화가 있습니다(${running.domain}). 끝나거나 취소된 뒤 다시 시도하세요.` };
    }
    const runId = this.db.createSyncRun(domain, "academies");
    void this.runAcademySync(runId, domain, opts);
    return { ok: true, run_id: runId };
  }

  private async runAcademySync(runId: string, domain: string, opts: AcademySyncOptions): Promise<void> {
    try {
      // 셔틀 운행 지역은 학원 동기화 시점에 계산해 저장한다. 사전이 없으면 지역이 비므로 먼저 확보한다
      // (이미 최신이면 원천을 호출하지 않는다). 실패해도 학원 동기화는 계속 진행한다.
      this.db.updateSyncRun(runId, { step: "지역 사전 확인 중" });
      await this.regionDirectory.ensure().catch(() => null);

      const rows = await this.drivingplus.fetchAcademies({
        includeReviews: opts.includeReviews,
        reviewLimit: opts.reviewLimit,
        reviewSort: opts.reviewSort,
        includeBlogReviews: opts.includeBlogReviews,
        blogReviewLimit: opts.blogReviewLimit,
        onStep: (step, total) => this.db.updateSyncRun(runId, { step, count_done: 0, ...(total === undefined ? {} : { count_total: total }) }),
        onProgress: (done, total) => this.db.updateSyncRun(runId, { count_done: done, count_total: total }),
        shouldCancel: () => this.db.isSyncCancelRequested(runId),
      });

      // 여기까지 왔으면 전 학원의 조회가 끝났다. 저장은 한 트랜잭션이라 중간 취소가 없다.
      this.db.updateSyncRun(runId, { step: "저장 중" });
      const result = this.db.upsertDrivingplusAcademies(domain, rows as unknown as Parameters<DbService["upsertDrivingplusAcademies"]>[1], {
        blogReviewsAttempted: Boolean(opts.includeBlogReviews),
      });
      this.db.updateSyncRun(runId, { status: "done", step: "완료", count_done: result.upserted, result, finished: true });
      this.logger.log(`학원 동기화 완료(${domain}): upserted=${result.upserted} reviews=${result.review_count} blogReviews=${result.blog_review_count} preserved=${result.blog_review_preserved}`);
    } catch (error) {
      if (error instanceof CancelledError) {
        // 취소는 실패가 아니다. 그리고 절반짜리 목록으로 저장하지 않았으므로 DB 는 그대로다.
        this.db.updateSyncRun(runId, { status: "cancelled", step: "취소됨", finished: true });
        this.logger.log(`학원 동기화 취소(${domain})`);
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.db.updateSyncRun(runId, { status: "error", step: "실패", error: message, finished: true });
      this.logger.error(`학원 동기화 실패(${domain}): ${message}`);
    }
  }
}
