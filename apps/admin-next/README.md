# Adrock Next.js 사내 관리자 앱

NestJS `apps/api-nest` 서버를 API 백엔드로 사용하는 Adrock 운전면허·운전학원 콘텐츠 운영 UI입니다.

## 실행

보통은 저장소 루트에서 한 번에 띄웁니다(`.env` 자동 로드, 포트가 사용 중이면 다음 빈 포트로 자동 변경).

```bash
./dev.sh
```

따로 띄우려면 저장소 루트 기준으로 터미널 두 개를 씁니다.

```bash
# 터미널 1 — NestJS API + 워커
cd apps/api-nest
npm install
API_WORKER=1 npm run dev

# 터미널 2 — Next 사내 관리자
cd apps/admin-next
cp .env.example .env.local
npm install
npm run dev
```

`.env.local`:

```bash
SEO_API_BASE_URL=http://127.0.0.1:8765
# Nest API 의 ADMIN_PASSWORD 와 같은 값을 넣는다(다르면 관리자 API 가 전부 401)
ADMIN_API_TOKEN=
```

주석은 값 뒤가 아니라 **줄 앞**에 씁니다 — 같은 형식을 Docker 가 `env_file` 로 읽을 때는
`KEY=value  # 설명`의 주석까지 값으로 삼기 때문입니다(`DEPLOY.md` 참고).

Next 앱은 `/api/admin/*` route handler로 Nest API의 `/api/admin/*`를 프록시합니다. 브라우저는 Next 서버만 호출하므로 CORS/토큰 노출을 최소화합니다.

## 포함 화면

사이드바는 **소유 단위**로 나뉩니다 — 대시보드(전체) / 콘텐츠 운영(도메인) / 자료 관리(업종) / 설정(전역).

- 대시보드 `/`: 도메인 생성, 도메인 카드, 최근 작업 큐(도메인 교차)
- 도메인 상세 `/t/[domain]`: 탭 8개 — 개요 · 원천 데이터 · 글 공통 설정 · 글유형/디자인 · 글 생성 · 작업 큐 · 검수·내보내기 · 설정
- 글 생성 `/t/[domain]/generate` · 작업 큐 `/t/[domain]/jobs` · 검수·내보내기 `/t/[domain]/posts`
- 격리 검수 `/t/[domain]/drafts`: 품질 게이트 미통과 글 확인/발행/반려
- 글 상세 `/t/[domain]/post/[postId]`: 렌더 HTML 미리보기, Markdown/HTML 다운로드, 「이 글의 근거」
- 운전학원 자료 `/academies`(+ `/academies/[externalId]`): 원천 동기화·AI 심층조사·검토 승인. **업종 단위라 도메인을 모릅니다**
- 작업환경 `/settings` · 연동 설정 `/integrations` · 도메인 없음 안내 `/need-domain`

작업 큐는 3초 폴링이며 상태·진행바·payload/result를 보여줍니다.

## 검증

루트에서 돌립니다(커밋 전 필수 게이트의 정본은 `CLAUDE.md`).

```bash
npm run typecheck
npm run verify:copy-sync   # 화면 안내 문구가 코드와 어긋났는지 — pre-commit 훅이 자동 실행
npm audit
```

`npm run build`는 배포 산출물이 필요할 때만 돌립니다. **`./dev.sh`가 떠 있는 동안에는 돌리지 마세요** —
`next dev`와 `.next` 청크를 공유해 관리자 화면이 통째로 깨집니다(복구: dev 정지 → `rm -rf .next` → 재시작).

화면 안내 문구를 새로 쓰거나 고칠 때는 `docs/ui-copy-inventory.md`에서 그 문장이 어떤 코드에 매달려
있는지 확인하세요. 파일을 고치면 편집 훅이 매달린 문구를 알려줍니다.
