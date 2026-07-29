# T01 읽기 전용 후보 trace

## 제공 도구

`apps/api-nest/src/scripts/trace-academy-candidates.ts`는 기존 SQLite 파일을 `node:sqlite`의 `{ readOnly: true }`로 연다. `DbService.init()`을 호출하지 않고 실제 `DbService.listAcademies()`/`getSeoRegion()`과 실제 candidate selection module만 호출한다.

```text
node apps/api-nest/dist/scripts/trace-academy-candidates.js \
  --db /absolute/path/admin.db --domain example.test --region "예시시" \
  --slot-seed T01_example
```

이 도구는 DB가 존재하지 않으면 오류를 내며 생성하지 않는다. academies, slots, posts, 설정, 프롬프트, 캐시에 쓰지 않는다.

출력 계약:

```json
{
  "targetRegion": "",
  "configuredMinimum": 2,
  "candidatePoolLimit": 7,
  "bodyCandidateLimit": 5,
  "nearbyRadiusKm": 20,
  "farRadiusKm": 50,
  "regionLikeCandidates": [],
  "supplementCandidates": [],
  "farCandidates": [],
  "duplicatesRemoved": [],
  "excludedCandidates": [],
  "mergedCandidatePool": [],
  "finalBodyCandidates": []
}
```

후보는 academy ID/name, stored region, address, 좌표, 직선거리, retrieval source/rank만 출력한다. API key나 외부 API는 사용하지 않는다.

## 실행 검증

`test/readonly-candidate-trace.test.ts`가 fixture DB를 먼저 만들고 동일 파일을 read-only trace로 다시 열었다.

- direct 1 + 20km supplement 1: `regionLikeCandidates=[direct]`, `supplementCandidates=[near]`, `farCandidates=[]`, body sample은 두 후보.
- direct/20km 0 + 30/44km: `farCandidates=[far-a, far-b]`, body sample도 동일.
- trace 전후 `academies` 행 수는 동일했다.

운영/개발 DB의 실제 내용을 조회하지 않았다. 이 작업 환경에서는 fixture DB trace만 실행했으며, 운영 데이터에 대한 값은 추측하지 않는다.
