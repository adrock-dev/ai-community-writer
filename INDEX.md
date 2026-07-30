# Adrock Driving Content Ops — Current Structure

Adrock 회사용 기준은 **운전면허·운전학원 도메인 전용 NestJS API + Next.js 사내 관리자**입니다.
관리자는 운전 도메인을 만들고, 지역/키워드 축을 기반으로 슬롯을 생성한 뒤, 검증된 학원 데이터만 사용해 콘텐츠를 작성합니다.

## 주요 폴더

```text
apps/
  api-nest/      NestJS API + worker. SQLite DB(data/admin.db) 사용
  admin-next/    Next.js 사내 운영 UI. /api/admin/* 프록시로 Nest API 호출
integration/
  nextjs-community-kit/  공개 사이트에서 /api/v1/* 콘텐츠를 가져오는 Next.js 키트
docs/
  admin-json-api.md      관리자 JSON API 명세
scripts/
  verify-company-clean.mjs  회사 제출/운전 도메인 전용 흔적 검증
```

## 운전 도메인 기본값

- 기본 업종은 `driving`이며, 작업환경의 업종 레지스트리(`settings/verticals`)에서 업종을 추가·선택할 수 있습니다. 단 전용 프리셋·템플릿·품질 게이트는 아직 `driving`만 특화돼 있습니다(MVP).
- 새 도메인은 **디자인 자동 매칭(`auto`)**으로 시작합니다 — 글마다 그 글유형의 기본 디자인(`default_design`)을 적용합니다(`docs/design-template-mapping.md`). `local-guide`는 아무 것도 지정되지 않았을 때의 최종 폴백입니다.
- 생성 시 운전학원 지역/키워드 축 프리셋이 도메인에 자동 적용됩니다(의도/페르소나/수식어는 글유형별 데이터로 관리).
- 글 작성은 학원명·주소·전화·사진·리뷰처럼 확인된 데이터만 사용하고, 가격·셔틀·합격률은 데이터가 있을 때만 단정합니다.

## 실행

```bash
./dev.sh
```

- API: `http://127.0.0.1:8765`
- 사내 관리자: `http://localhost:3001` 또는 사용 중이면 다음 빈 포트

## 검증

커밋 전 필수 게이트와 그 이유는 `CLAUDE.md`가 기준입니다. 요약하면:

```bash
npm run verify:company-clean   # pre-commit 훅이 자동 실행
npm run verify:copy-sync      # pre-commit 훅이 자동 실행
npm run typecheck
npm run test
npm run qa:posts
npm run audit:all             # 의존성 취약점(수동)
```

`npm run build`는 배포 전에만 돌립니다. **`npm run dev`가 떠 있는 동안에는 돌리지 마세요** — `next dev`와 `.next` 청크를 공유해 관리자 화면이 통째로 깨집니다(복구: dev 정지 → `rm -rf apps/admin-next/.next` → 재시작). 타입만 확인할 목적이면 `typecheck`로 충분합니다.
