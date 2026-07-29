# 현재 패턴과 modifier 구조

## 용어 정리

관리자 UI의 “글유형”은 `T01`~`T15` `TEMPLATE_SPECS`이고, 실제 본문 구조의 공통 구현 단위는 `kind`로 연결되는 `ARCHETYPES`다. 디자인 템플릿은 구조가 아니라 어조/CTA 보조 지시(`designWritingGuide`)다. modifier는 별도 prompt fragment가 아니라 slot 문자열이다.

## 모든 글유형

| ID · 이름 | kind / 적용 조건·검색 의도 | 제목 | 구조·필수 요소 | 학원/인접 처리·데이터 부족 | 결론/검수/문체 |
|---|---|---|---|---|---|
| T01 지역 운전학원 BEST 비교 | `local`; 지역 × 학원 키워드, persona, modifier 2개, academy 유형 `exam_academy`,`academy`. 지역 내/인근 선택 비교. | 후보 3+면 `{지역} 운전면허학원 BEST {개수}`, 2면 `{지역} 추천 운전면허학원`; 2 미만은 skip. | 6개 seed variants: 표 우선, 후보 우선, 기준 우선, 추천 우선, 생활권 우선, FAQ. 표·H3 후보 카드·체크리스트·CTA. | 직접→주소/행정/20km 인근→50km 보장. 거리만 제공, 인근으로 표기. 자료 없으면 상담 질문. | 상황별 결론. 후보명/H3/표/금액·후기/과장 게이트. `comparison` 디자인은 보조 톤뿐. |
| T03 운전면허 가이드 총정리 | `guide`; keyword, persona, modifier 1. 전체 절차/초보 가이드. | LLM H1. | 준비→비용→시험 단계→선택 기준→표/CTA. | academy_types 없음: 학원 DB 미사용. | 일반 안전/가독성 게이트; 지역 비교용은 아님. |
| T04 면허 종류/옵션 비교 | `compare`; 1/2종 keyword, persona. | LLM H1. | 앞쪽 비교표, 장단점·추천 대상·확인 질문·상황 결론. | DB 미사용. | 비용 단정 금지와 위험 표현 게이트. |
| T05 비용 및 시간 절약 전략 | `compare`; 비용/수강료 keyword, persona, modifier 1. | LLM H1. | T04와 동일 compare 구조. | DB 미사용이라 실제 지역 학원 수강료 비교는 하지 않는다. | 확정 금액은 facts 있을 때만인데 이 유형 facts는 통상 비어 있다. |
| T06 시험 단계 집중 BEST | `exam`; 시험 keyword + intent. | LLM H1. | 요약표/체크리스트, 실수·연습/절차, 이유 설명, CTA. | DB 미사용. | 접수 정보는 최신 확인 필요로 보수 지시. |
| T07 지역 허브 총정리 | `local_hub`; 지역 × 학원/면허/시험장 keyword + intent, academy 유형 2종. | LLM H1. | 생활권·후보/시험장 표·셔틀/대중교통·접수 준비·출발지 체크리스트. 6 variants. | `local_hub`는 academy-centric가 아니므로 facts는 만들어도 후보 카드 강제/후보 H3 조건의 강도가 낮다. 인근 후보는 같은 picker를 사용한다. | 지역 정보 허브 CTA. |
| T08 필기시험 접수 | `exam`; 접수 keyword + intent. | LLM H1. | 절차/준비물 체크리스트. | DB 미사용. | FAQ는 질문형일 때만. |
| T09 필기시험 팁 | `exam`; 팁 keyword, persona, modifier 1. | LLM H1. | 시험 집중 구조. | DB 미사용. | 과장 합격 보장 차단. |
| T10 필기시험 앱 추천 | `exam`; 앱 keyword + persona. | LLM H1. | 선택 기준/활용 비교. | 외부 앱 fact collection은 미구현. | “도구를 꾸며내지 말라” 지시가 있음. |
| T11 지역 운전면허시험장 소개 | `local_single`; 지역 × 시험장, intent, 유형 `license_test_course`,`license_center`. | `{지역} 운전면허시험장`, 1 미만 skip. | 단독 소개 6 variants: 위치, 과정, 상담 체크, 적합 대상, 이용 흐름, FAQ. 요약표. | 1개만 써야 하며 비교/BEST 금지. 인근 선택은 picker가 보강할 수 있다. | 상담/준비물 CTA. |
| T12 운전면허 취득 총정리 | `guide`; keyword, persona, modifier 1. | LLM H1. | T03 guide 구조. | DB 미사용. | 절차/선택 기준 중심. |
| T13 타겟별 운전면허 준비 | `guide`; keyword, persona, modifier 1. | LLM H1. | persona 시간·예산·이동수단 overlay + guide 구조. | DB 미사용. | 페르소나별 CTA, 사실 검수는 공통. |
| T14 전문학원 단독 소개 | `local_single`; 지역 × 학원 keyword, persona, `exam_academy`. | `{지역} {학원명}`, 1 미만 skip. | T11 동일 단독 6 variants; 비교 프레이밍 금지, 요약표 가능. | 후보 풀/인근 보강은 가능하지만 실제 사용은 하나만 seed sample. | 비용·셔틀·합격률은 자료 있을 때만, 상담 CTA. |
| T15 지역+시험단계 혼합 | `local_hub`; 지역 × 시험/학원 keyword, persona·intent·modifier 각 1. | LLM H1. | 지역 허브 variants와 시험 단계 정보를 결합. | academy 유형 2종; 비교필드 card는 명시적이지 않다. | 출발지 체크리스트·CTA. |

공통 구조 변형의 선택은 `structureGuideForArchetype(archetype, structureSeed(slot))`이며 동일 slot에는 재현 가능하지만, 글마다 모델 출력이 구조를 정확히 준수한다는 별도 검증은 없다 (`archetypes.ts:337-379`).

## modifier 목록과 실효성

| modifier ID(실제 값) | 사용 가능 템플릿 | 프롬프트에 실제 추가되는 문장 | 구조 변화 | 중복·실효성 판단 |
|---|---|---|---|---|
| `가까운` | T01, T15 | `수식어: 가까운` | 없음 | 지역/생활권/인근 picker와 의미가 중첩. 접근성 fact가 주소·거리뿐이면 효과가 약함. |
| `근처` | T01 | `수식어: 근처` | 없음 | `가까운`과 사실상 중복이며 독립 prompt rule 없음. |
| `비용절약` | T01,T03,T05,T09,T12,T13 | `수식어: 비용절약` | 없음 | costs가 facts에 없는 유형에서는 상담 질문 외 실질 변화가 불안정. |
| `상담전확인` | T01,T03,T05,T09 | `수식어: 상담전확인` | 없음 | 모든 prompt가 이미 상담 확인 질문/CTA를 강제하여 거의 중복. |
| `셔틀편리` | T01,T05,T13,T15 | `수식어: 셔틀편리` | 없음 | shuttle field가 없으면 단정 금지라 결과가 일반 확인 질문으로 수렴한다. |
| `야간반` | T01,T13 | `수식어: 야간반` | 없음 | night/weekend 구조화 facts가 운영 생성 DB에는 없다. 자료 부재 시 실질 변화 작음. |
| `주말반` | T01,T03,T05,T12,T13 | `수식어: 주말반` | 없음 | `야간반`과 같은 한계. |
| `필기시험부터` | T03,T09,T12,T15 | `수식어: 필기시험부터` | 없음 | exam/guide archetype 자체의 단계 지시와 중첩. |
| `도로주행` | T15 | `수식어: 도로주행` | 없음 | T15의 intent/keyword도 도로주행일 수 있어 중복한다. |

**직접 근거:** `slot.service.ts:66-96`은 modifier 값을 slot에 저장하고 `worker.service.ts:737,828`은 값 목록을 한 줄로 interpolate한다. modifier별 switch, prompt fragment, section planner, quality validator는 없다. 따라서 현재 modifier는 “문체만”이 아니라 **모델 자유 해석용 주제 힌트**이며 구조·사실 selection을 바꾸지 않는다.

## 공통 프롬프트 계약

`buildPrompt`/`buildRepairPrompt`는 다음을 강하게 요구한다 (`worker.service.ts:714-934`).

- H2 4~6, 표 1+, 체크리스트, 후보가 있으면 후보명·H3 카드, 실제 이미지 key, 마지막 CTA.
- 사실 없는 가격·셔틀·합격률·후기 및 취득/합격 보장 금지; 부족하면 구체적 상담 질문.
- 지역 생활권·후보 적은 지역의 인근 선택지·후기 한 문장 요약·짧은 문단·AI 상투구 회피.
- 품질 게이트는 길이, H2, 표/리스트, 후보수 과장, 실제 후보명/표/H3, review 활용, 이미지, 가독성, 금액/후기 근거 여부, 위험 표현, 상투문장, 내부 데이터 누출을 검사한다 (`quality-gate.ts:87-164`).

제목 규칙은 T01/T11/T14에만 있고, 나머지는 본문 작성과 결합돼 있다. 디자인은 `designWritingGuide`가 톤/CTA만 바꾸며 구조 owner가 아니다 (`worker.service.ts:938-949`).
