# Adrock API Nest

Adrock 회사용 운전면허·운전학원 콘텐츠 운영 백엔드인 NestJS API/워커입니다. SQLite DB(`data/admin.db`)를 사용합니다.

## 기본 성격

- 도메인 업종은 `driving`만 허용합니다.
- 새 도메인은 운전학원 지역/키워드 프리셋과 `local-guide` 디자인으로 시작합니다.
- 콘텐츠 생성은 검증된 학원 데이터 기반으로만 작성되며, 가격·셔틀·합격률 같은 민감 정보는 데이터가 있을 때만 단정합니다.

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
