export const DEFAULT_DRIVINGPLUS_API_BASE_URL = "https://api.drivingplus.me";

export function adminApiBaseUrl(): string {
  return String(
    process.env.SEO_API_BASE_URL ||
      `http://${process.env.ADMIN_HOST || "127.0.0.1"}:${process.env.ADMIN_PORT || 8765}`,
  ).replace(/\/$/, "");
}

export function drivingplusApiBaseUrl(): string {
  return String(process.env.DRIVINGPLUS_API_BASE_URL || DEFAULT_DRIVINGPLUS_API_BASE_URL).replace(/\/$/, "");
}

/**
 * 저장된 설정을 읽는 함수. DbService 가 init 에서 자기 자신을 등록한다.
 *
 * 왜 이렇게 돌리나: 수집 스위치는 `admin.db` 의 app_settings 에 두는 게 맞는데(색인 설정·업종
 * 레지스트리와 같은 자리), 이 스위치를 보는 쪽 중 하나인 AcademyResearchService 는 admin.db 를
 * **의도적으로 모른다**(academy_research.db 와 완전 분리가 원칙). 거기에 DbService 를 주입하면
 * 그 원칙이 깨진다. 그래서 읽기 함수만 등록받아, 스위치를 보는 쪽은 DB 를 몰라도 되게 한다.
 *
 * 등록 전(CLI 초기화 직전, 일부 단위 테스트)에는 환경변수만 본다.
 */
let readStoredSetting: ((key: string) => string | null) | null = null;
export function registerSettingsReader(reader: (key: string) => string | null): void {
  readStoredSetting = reader;
}

export const BLOG_REVIEW_SYNC_SETTING_KEY = "blog_review_sync";

/**
 * 원천 블로그리뷰 수집 스위치. **기본 꺼짐.**
 *
 * 원천은 네이버 블로그 검색으로 학원명을 느슨하게 매칭해 오배정이 섞인다(2026-07-27 실측 539건:
 * 55건은 학원 고유명이 글 어디에도 없고, 같은 글 18건이 이름이 비슷한 학원 2~3곳에 중복 배정).
 * 글 생성에서는 이미 뺐고(`389ce0d`), 수집까지 멈춰 낡은 자료가 더 쌓이지 않게 한다.
 *
 * 지우지 않고 스위치로 둔 이유: 블로그 글 자체를 검증해 올바른 것만 쓰는 방향을 검토 중이라,
 * 그 판별이 생기면 다시 켜야 한다. 이미 수집된 자료는 그대로 보존된다(학원 상세 화면 참고용).
 *
 * 우선순위: 관리자 설정(app_settings) → 환경변수 `DRIVINGPLUS_BLOG_REVIEW_SYNC` → 꺼짐.
 * 관리자 설정을 앞에 두는 이유는 재시작 없이 켜고 끄기 위해서다 — 기동 중인 API 는 시작 시점의
 * `.env` 를 들고 있어서, 환경변수만으로는 재시작해야 하고 그러면 진행 중인 글 생성이 죽는다.
 *
 * **이 스위치는 "수집" 만 켠다.** 켜도 생성 프롬프트(389ce0d)와 T01 품질 게이트(bfe5881)에는
 * 닿지 않는다. 검증된 블로그리뷰만 글에 쓰는 방법이 생기면 전역 스위치가 아니라 레코드별 검증
 * 상태를 관문으로 둔다(조사값이 status 로 거르는 것과 같은 방식).
 */
export function blogReviewSyncEnabled(): boolean {
  const stored = readStoredSetting?.(BLOG_REVIEW_SYNC_SETTING_KEY);
  if (stored === "1") return true;
  if (stored === "0") return false;
  const raw = String(process.env.DRIVINGPLUS_BLOG_REVIEW_SYNC ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on";
}
