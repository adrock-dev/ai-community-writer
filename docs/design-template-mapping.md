# 글 유형 ↔ 화면 구상/디자인 역할 분리 설계

> ⚠️ **상태(2026-07-13)**: UI 용어가 '화면 구상' → '디자인'으로 통일됨. 글유형별 `default_design` 자동 매칭 개념은 유효하나, 전체 강제·HTML 프리셋·③ 오버라이드 편집기는 제거됨(디자인 변경은 커스텀 글유형 복제로). 최신 상태는 memory `archetype-refactor-roadmap`.

작성일: 2026-07-08

## 1. 배경: 무엇이 문제였나

관리자 `글유형/디자인` 탭에는 두 축이 있다.

- **글 유형(T01~T15, `TEMPLATE_SPECS`)** — 멀티 선택. 슬롯 생성 규칙(주축·페르소나·인텐트·수식어)과
  원본 엑셀/글 패턴 기반 작성법을 결정한다. 즉 "어떤 검색 수요를 노려 무엇을 쓸 것인가"라는 기획 축.
- **화면 구상/디자인(`DESIGN_TEMPLATES`)** — 도메인당 단일 선택. 발행 화면의 시각 테마(CSS, CTA, 컬러)이자,
  생성 프롬프트에 본문 구조 지침(`designStructureGuide`)을 주입한다.

이 구조에는 두 가지 경계 문제가 있었다.

1. **디자인이 이중 역할을 겸한다.** 시각 레이아웃뿐 아니라 "비교표를 첫 H2에", "초반에 체크리스트 배치" 같은
   본문 구조 지침까지 디자인이 결정한다. 본문 구조는 성격상 글 유형에 더 가깝다.
2. **선택 단위가 어긋난다.** 글 유형은 슬롯별(멀티)인데 디자인은 도메인당 하나다. `DESIGN_TEMPLATES.best_for`가
   스스로 유형과의 짝을 명시함에도(comparison ↔ BEST 비교, checklist ↔ 접수/준비물), T01(비교)과 T08(접수)을
   함께 켜면 두 유형 모두 하나의 디자인을 강제받아 프롬프트 안에서 구조 지침이 충돌한다.

## 2. 설계 원칙

- **두 개념은 분리 유지한다.** 글 유형 = 기획(무엇을 쓸 것인가), 디자인 = 표현(어떻게 보일 것인가).
  custom 디자인(화면 구상 메모)과 브랜드 컬러는 도메인·브랜드 수준의 관심사이므로 유형에 합칠 수 없다.
- **디자인 결정을 글(슬롯) 단위로 내린다.** 인프라는 이미 준비돼 있다 — `posts.design_template_id`가 글 단위로
  저장되고, 관리자 미리보기·공개 키트 모두 `post.design_template_id → 도메인 설정` 순으로 폴백한다.
- **기존 동작은 깨지 않는다.** 도메인에 구체 디자인이 저장돼 있으면 지금처럼 모든 글에 그 디자인을 강제한다.

## 3. 글 유형 → 기본 디자인 매핑

`TEMPLATE_SPECS`에 `default_design`을 추가한다.

| 유형 | 이름 | 기본 디자인 | 근거(`best_for`) |
| --- | --- | --- | --- |
| T01 | 지역 운전학원 BEST 비교 | `comparison` | BEST, 추천, 비교 |
| T03 | 운전면허 가이드 총정리 | `editorial` | 초보자 가이드, 총정리 |
| T04 | 면허 종류/옵션 비교 | `comparison` | 옵션 비교 |
| T05 | 비용 및 시간 절약 전략 | `comparison` | 수강료/기간 비교 |
| T06 | 시험 단계 집중 BEST | `comparison` | BEST, 추천 |
| T07 | 지역 허브 총정리 | `local-guide` | 근처/주변/동네 |
| T08 | 운전면허 필기시험 접수 | `checklist` | 접수, 절차 |
| T09 | 운전면허 필기시험 팁 | `checklist` | 시험 팁, 준비물 |
| T10 | 필기시험 앱 추천 | `comparison` | 추천, 비교 |
| T11 | 지역 운전면허시험장 소개 | `local-guide` | 지역, 동선 |
| T12 | 운전면허 취득 총정리 | `editorial` | 총정리 글 |
| T13 | 타겟별 운전면허 준비 | `editorial` | 페르소나 가이드 |
| T14 | 전문학원 단독 소개 | `conversion` | 상담, 예약, 학원 소개 |
| T15 | 지역+시험단계 혼합 | `local-guide` | 지역 검색어 |

## 4. 도메인 디자인 설정에 `auto` 도입

`domains.design_template_id`에 특수값 **`auto`** 를 허용한다(상수 `AUTO_DESIGN_TEMPLATE_ID`).

생성 시 디자인 결정 우선순위(`worker.service.ts`, 슬롯 단위로 계산):

```text
1. 작성 요청 payload.design_template_id   (있으면 그대로, "auto"면 3으로)
2. 도메인 design_template_id              (구체값이면 그대로, "auto"면 3으로)
3. 슬롯 글 유형의 default_design          (매핑 없으면 local-guide)
```

- 결정된 **구체 디자인 id가 posts에 저장**되므로, 렌더링 계층(관리자 미리보기·HTML 다운로드·공개 키트)은
  변경이 필요 없다.
- 도메인 값이 `auto`인 채로 렌더링 폴백에 쓰이는 경우(글에 디자인이 없는 이론상 케이스)는 기존
  `resolveDesignId`/`resolveDesign`이 미지의 값을 기본 디자인으로 폴백하므로 안전하다.
- **새 도메인 기본값은 `auto`** 로 한다(기존: `local-guide`). 기존 도메인은 저장된 값이 유지되므로 동작 불변.

## 5. 관리자 UI 변경 (`글유형/디자인` 탭)

- 글 유형 카드에 **기본 디자인 배지**를 표시해 유형↔디자인 짝을 드러낸다.
- 디자인 선택지 맨 앞에 **"자동 (글 유형별 매칭)"** 카드를 추가한다. 자동 선택 시 미리보기는 켜져 있는
  첫 글 유형의 기본 디자인 기준으로 보여주고, 자동 매칭임을 안내한다.
- 개요·작성 옵션 등에서 도메인 디자인이 `auto`면 "자동(글 유형별)"로 표기한다.
- 저장 결합 완화: 글 유형 0개여도 디자인 설정만 저장할 수 있게 하되, 후보 생성이 불가함을 confirm으로 안내한다.

## 6. 변경 파일

| 파일 | 변경 |
| --- | --- |
| `apps/api-nest/src/constants.ts` | `default_design` 매핑, `AUTO_DESIGN_TEMPLATE_ID`, `defaultDesignForTemplate()` |
| `apps/api-nest/src/worker.service.ts` | 디자인 결정을 잡 단위 → 슬롯 단위로 이동, `resolveGenerationDesign()` |
| `apps/api-nest/src/admin.controller.ts` | 새 도메인 기본 디자인을 `auto`로 |
| `apps/admin-next/lib/types.ts` | `DomainDesignSetting`(`DesignTemplateId \| "auto"`), `TemplateSpec.default_design` |
| `apps/admin-next/lib/design-theme.ts` | `designSettingLabel()` 표시 헬퍼 |
| `apps/admin-next/components/DomainClient.tsx` | 자동 카드, 유형 카드 디자인 배지, 미리보기, 라벨 표기 |
| `apps/admin-next/components/JobCard.tsx` | `auto` 라벨 표기 |

## 7. 호환성 / 마이그레이션

- DB 스키마 변경 없음. `posts.design_template_id`는 항상 구체값이 저장된다(기존과 동일).
- 기존 도메인은 저장된 구체 디자인이 그대로 강제된다 — 동작 변화 없음.
- 품질 게이트(`postSurfaceQualityIssues`, `scripts/qa-posts.mjs`)는 글에 저장된 구체 디자인 id를 읽으므로 영향 없음.

## 8. 남은 과제 (이번 범위 밖)

- `designStructureGuide`(본문 구조 지침)를 디자인에서 글 유형 속성으로 완전히 이관하는 리팩터링.
  현재는 매핑으로 유형에 맞는 구조 지침이 선택되므로 실익이 작아 보류.
- `PATCH /domains/:domain`의 `design_template_id` 값 검증(현재 임의 문자열 허용 — 기존 동작).
- 슬롯/글 목록에서 유형별 적용 디자인을 한눈에 보는 컬럼 추가 검토.
