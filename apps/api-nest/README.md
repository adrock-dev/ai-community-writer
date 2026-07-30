# Adrock API Nest

Adrock 회사용 운전면허·운전학원 콘텐츠 운영 백엔드인 NestJS API/워커입니다.

SQLite DB는 **두 개**입니다 — 운영 DB `data/admin.db`(`SEO_DB_PATH`)와 학원 심층조사 전용
`data/academy_research.db`(`ACADEMY_RESEARCH_DB_PATH`). 조사 DB를 분리한 이유는 `admin.db`가
테스트로 자주 초기화되는데 조사값은 영구 보존해야 하기 때문입니다. **백업은 두 파일 모두**입니다.

## 기본 성격

- 업종은 DB 업종 레지스트리(`settings/verticals`)로 등록·선택하며 기본값은 `driving`입니다. 등록되지 않은 업종으로는 도메인을 만들 수 없습니다. 단 프리셋·글유형·품질 게이트는 아직 `driving`만 특화돼 있습니다(MVP).
- 새 도메인은 운전학원 지역/키워드 프리셋과 **디자인 자동 매칭(`auto`)**으로 시작합니다 — 글마다 그 글유형의 기본 디자인을 적용합니다(`local-guide`는 아무 것도 지정되지 않았을 때의 폴백).
- 콘텐츠 생성은 검증된 학원 데이터 기반으로만 작성되며, 가격·셔틀·합격률 같은 민감 정보는 데이터가 있을 때만 단정합니다.
- 텍스트 생성은 API 키가 아니라 로컬 `codex`(기본)/`claude` CLI의 OAuth 인증에 의존합니다.

```bash
cd apps/api-nest
npm install
npm run dev
```

기본 주소: `http://127.0.0.1:8765`

워커까지 한 프로세스로 같이 띄우려면:

```bash
API_WORKER=1 npm run dev
```

워커만 별도 실행:

```bash
npm run worker
```
