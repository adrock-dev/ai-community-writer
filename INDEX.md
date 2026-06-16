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

- 업종은 `driving`만 노출/허용합니다.
- 새 도메인은 `local-guide` 디자인을 기본으로 사용합니다.
- 생성 시 운전학원 지역/키워드/의도/페르소나/수식어 프리셋이 자동 적용됩니다.
- 글 작성은 학원명·주소·전화·사진·리뷰처럼 확인된 데이터만 사용하고, 가격·셔틀·합격률은 데이터가 있을 때만 단정합니다.

## 실행

```bash
./dev.sh
```

- API: `http://127.0.0.1:8765`
- 사내 관리자: `http://localhost:3001` 또는 사용 중이면 다음 빈 포트

## 검증

```bash
npm run typecheck
npm run build
npm run audit:all
npm run verify:company-clean
```
