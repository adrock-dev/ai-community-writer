import "reflect-metadata";
import { DbService } from "./db.service.js";
import { DrivingplusApiService } from "./drivingplus-api.service.js";
import { RegionDirectoryService } from "./region-directory.service.js";

/**
 * 전역 행정구역 사전 동기화 1회 실행.
 *
 * 평소에는 도메인 생성 시 자동으로 준비되므로 이 스크립트를 쓸 일이 없다.
 * 행정구역이 개편됐을 때나, 기동 중인 서버와 다른 원천 endpoint 로 받아야 할 때 쓴다.
 *
 * 사용: npm run sync:region-directory
 */
async function main(): Promise<void> {
  const db = new DbService();
  db.init();
  const service = new RegionDirectoryService(db, new DrivingplusApiService());
  const before = db.regionDirectoryStatus();
  console.log(`[region-directory] 현재 ${before.total}건 (최근 동기화 ${before.synced_at ?? "없음"})`);
  const result = await service.sync();
  const after = db.regionDirectoryStatus();
  console.log(`[region-directory] fetched=${result.fetched} upserted=${result.upserted} skipped=${result.skipped}`);
  console.log(`[region-directory] 총 ${after.total}건 · 레벨별 ${JSON.stringify(after.by_level)}`);
}

await main();
