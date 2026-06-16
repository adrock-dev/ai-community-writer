# Adrock Content Ops — Current Structure

Adrock 회사용 기준은 **NestJS API + Next.js 사내 관리자**입니다. Electron, Python FastAPI/Jinja, Python worker/runtime, PoC 산출물은 제거했습니다.

## 주요 폴더

```text
apps/
  api-nest/      NestJS API + worker. 기존 SQLite DB(data/admin.db) 사용
  admin-next/    Next.js 사내 운영 UI. /api/admin/* 프록시로 Nest API 호출
integration/
  nextjs-community-kit/  공개 사이트에서 /api/v1/* 콘텐츠를 가져오는 Next.js 키트
docs/
  admin-json-api.md      관리자 JSON API 명세
  *.md                  콘텐츠 운영 전략/프롬프트/이미지 전략 문서
data/                   로컬 SQLite DB 위치(ignored)
```

## 실행

```bash
./dev.sh
```

수동 실행:

```bash
cd apps/api-nest
API_WORKER=1 npm run dev

cd ../admin-next
SEO_API_BASE_URL=http://127.0.0.1:8765 npm run dev
```

- API: `http://127.0.0.1:8765`
- 사내 관리자: `http://localhost:3001`

## 검증

```bash
cd apps/api-nest && npm run typecheck && npm run build
cd ../admin-next && npm run typecheck && npm run build
```
