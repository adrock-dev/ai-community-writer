import "reflect-metadata";
import { DbService } from "./db.service.js";
import { DrivingplusApiService } from "./drivingplus-api.service.js";
import { RegionDirectoryService } from "./region-directory.service.js";
import { blogReviewSyncEnabled } from "./runtime-config.js";

/**
 * 학원 동기화 1회 실행(worker-once 와 같은 CLI 진입점 패턴).
 *
 * 기동 중인 API 프로세스는 시작 시점의 .env 를 들고 있어서, DRIVINGPLUS_API_BASE_URL 을
 * 바꾼 뒤 관리자 엔드포인트로 동기화하면 예전 base URL 로 붙는다. 이 스크립트는 현재
 * 셸의 환경변수로 붙으므로 서버를 재시작하지 않고 동기화할 수 있다.
 *
 * 사용: npm run sync:academies -- <domain>
 * 지역(seo_regions)·축(axes)은 건드리지 않는다. academies 만 upsert 한다.
 */
async function main(): Promise<void> {
  const domain = String(process.argv[2] || "").trim();
  if (!domain) throw new Error("도메인을 인자로 넘기세요: npm run sync:academies -- <domain>");

  const db = new DbService();
  db.init();
  if (!db.getDomain(domain)) throw new Error(`등록되지 않은 도메인입니다: ${domain}`);

  const api = new DrivingplusApiService();
  console.log(`[sync] base=${api.baseUrl} domain=${domain}`);

  // 셔틀 운행 지역은 이 시점에 계산해 저장하므로 지역 사전이 먼저 있어야 한다.
  const ensured = await new RegionDirectoryService(db, api).ensure().catch(() => null);
  if (ensured) console.log(`[sync] 지역 사전 준비: upserted=${ensured.upserted}`);

  const rows = await api.fetchAcademies({
    includeReviews: true,
    reviewLimit: 5,
    reviewSort: "point",
    // 관리자 화면과 같은 스위치를 본다(기본 꺼짐). runtime-config blogReviewSyncEnabled 주석 참고.
    includeBlogReviews: blogReviewSyncEnabled(),
    blogReviewLimit: 3,
  });
  const withField = (key: keyof (typeof rows)[number]) =>
    rows.filter((row) => {
      const value = row[key];
      return Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined;
    }).length;
  console.log(`[sync] fetched=${rows.length} educationPerformance=${withField("educationPerformance")} shuttleBuses=${withField("shuttleBuses")} operateHour=${withField("operateHour")} licenseTypes=${withField("licenseTypes")}`);

  const result = db.upsertDrivingplusAcademies(domain, rows as unknown as Parameters<DbService["upsertDrivingplusAcademies"]>[1], {
    blogReviewsAttempted: blogReviewSyncEnabled(),
  });
  console.log(`[sync] upserted=${result.upserted} skipped=${result.skipped} reviews=${result.review_count} blogReviews=${result.blog_review_count} warnings=${result.warnings.length}`);
  for (const warning of result.warnings.slice(0, 10)) console.log(`  ! ${warning}`);
}

await main();
