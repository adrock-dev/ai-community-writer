# 데이터 이동·재설치 — 무엇이 따라오고 무엇이 사라지는가

저장소를 다른 경로·다른 장비로 옮길 때 **DB 는 git 으로 따라오지 않는다.** 무엇을 다시 만들 수
있고 무엇을 잃는지, 옮기려면 어떻게 하는지를 정리한다.

작성 2026-07-28.

## 1. git 에는 DB 가 없다

`.gitignore` 가 `*.db` · `*.db-wal` · `*.db-shm` 을 전부 제외한다(`data/admin.db*` ·
`data/academy_research.db*` 로 한 번 더 명시). 새 경로에 clone 하면 **빈 DB 로 시작**하고
기동 시 스키마만 새로 만들어진다.

## 2. 복구되는 것과 안 되는 것

| 데이터 | 저장소 | 새 환경에서 | 비용 |
| --- | --- | --- | --- |
| 학원 기본정보·자체 후기 | `academy_research.db` `academy_base`·`academy_reviews` | **동기화로 복구** | 몇 분 |
| 글 생성용 학원 자료(수강료·셔틀·운영시간·면허 종별) | `admin.db` `academies` | **동기화로 복구** | 몇 분 |
| **AI 심층조사값** | `academy_research.db` `academy_research` | **복구 불가 — 다시 조사** | 380곳 ≈ 4~5시간 + LLM 비용 |
| **검증완료 승인** | `academy_research.db` `academy_field_meta.status` | **복구 불가 — 사람이 다시 판단** | 사람 노동 |
| 생성된 글 | `admin.db` `posts` | **복구 불가** | 글당 5~12분 |
| **인수인계 메모** | `admin.db` `admin_notes` | **복구 불가 — 원천이 아예 없다** | 사람 노동 |
| 도메인·축·슬롯·설정 | `admin.db` | 복구 불가(재설정) | — |

핵심은 **원천에서 다시 받을 수 있는 것과 없는 것이 갈린다**는 점이다. 조사값과 승인은 재생성
비용이 크고, 승인은 애초에 사람 판단이라 자동 복구가 불가능하다.

**관리자 가이드는 갈린다 — 문서는 따라오고 메모는 아니다.** 화면(`/guides`)에 함께 보이지만
저장소가 다르다.

| | 어디에 있나 | 옮길 때 |
| --- | --- | --- |
| 가이드 문서 | 저장소 `docs/*.md` | **git 이 따라간다.** 화면은 그 파일을 읽어 렌더할 뿐 사본을 두지 않는다 |
| 인수인계 메모 | `admin.db` `admin_notes` | **DB 를 복사하지 않으면 사라진다** |

메모는 사람이 적은 판단이라 **다시 받아올 원천이 아예 없다.** 조사값은 시간과 비용을 들이면
재생성되지만 메모는 그마저 안 된다. 옮기기 전에 아래 절차로 DB 를 반드시 함께 가져간다.

**DB 를 못 옮기는 상황(초기화·다른 장비에 새로 설치)이라면 메모 화면에서 먼저 내보낸다.**
「설정 › 관리자 가이드 › 인수인계 메모」에 Markdown(사람이 읽는 용)과 JSON(되살리기용) 내보내기가
있다. JSON 을 새 환경에서 「JSON 가져오기」로 올리면 **적은 날짜와 「꼭 볼 것」이 그대로 살아나고**,
제목이 같은 메모는 건너뛰므로 두 번 넣어도 늘어나지 않는다.

## 3. 옮기는 절차

### ⚠️ `-wal` · `-shm` 을 반드시 함께 복사한다

SQLite 는 WAL 모드로 돌아 **최근 쓰기가 `.db` 본 파일이 아니라 `-wal` 에 있다.** 실제로
2026-07-28 시점 `academy_research.db` 는 본 파일 6.9MB 에 `-wal` 이 7.5MB 였다 — `.db` 만
복사했다면 전날 저녁 이후 작업(그라운딩 결과·승인·진행 중 조사)이 통째로 빠졌을 것이다.

```bash
# 1) API 를 먼저 멈춘다. 정상 종료 시 WAL 이 본 파일에 합쳐진다.
#    (조사·동기화 배치가 돌고 있으면 끝나기를 기다리거나 취소한 뒤 멈춘다)

# 2) 세 파일을 함께 복사
cp data/academy_research.db data/academy_research.db-wal data/academy_research.db-shm  <새경로>/data/
cp data/admin.db            data/admin.db-wal            data/admin.db-shm             <새경로>/data/

# 3) 새 경로에서 .env 를 맞춘다(ADMIN_PASSWORD·ADMIN_API_TOKEN·DRIVINGPLUS_API_BASE_URL)
```

`SEO_DB_PATH` · `ACADEMY_RESEARCH_DB_PATH` 로 경로를 바꿔 쓰는 경우 그 값도 함께 맞춘다.

### 복사하지 않고 새로 시작한다면

1. 학원·지역 동기화 — 「운전학원 자료」 화면 또는 `npm run sync:academies -- <domain>`
2. 도메인·축·글유형 재설정
3. 심층조사 재실행 — 100곳씩 나눠서(중단돼도 다시 눌러 이어서 진행된다)
4. 검토·승인 다시 — 「운전학원 자료 → 검토 대기」

## 4. 백업 파일

`data/admin.db.bak-*` 처럼 위험한 작업 전에 수동으로 뜬 백업이 쌓인다. 2026-07-28 정리 시점에
8개 약 54MB 가 남아 있었고, 그중 일부는 **현재 DB 에 없는 글을 담고 있다**(`bak-predelete-20260722`
= 글 26편, 현재 8편). 지우기 전에 반드시 내용을 확인한다.

```bash
# 백업 안에 무엇이 들었는지 세어 보기
node -e 'const s=require("node:sqlite");const db=new s.DatabaseSync(process.argv[1],{readOnly:true});
for (const t of ["posts","academies","slots"]) console.log(t, db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n);' data/admin.db.bak-...
```

읽기조차 안 되는 빈 껍데기와, 본 파일 없이 남은 `-shm`/`-wal` 고아는 지워도 잃을 게 없다.
