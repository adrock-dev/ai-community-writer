# FAQ·체크리스트 중복 제거 계약안

```ts
type DecisionSupportUnit = {
  section: "faq" | "checklist" | "body" | "table";
  text: string;
  topic: "location" | "shuttle" | "tuition" | "schedule" | "license" | "internal_test" | "region_relation" | "other";
  intent: "verification" | "selection" | "explanation" | "action";
  action: "contact_academy" | "compare_candidates" | "check_route" | null;
  answerSummary: string | null;
  factIds: string[];
};
```

중복 우선순위:

1. 실행 가능한 질문은 checklist에 유지한다. 예: `셔틀 노선·승차 지점 문의`.
2. 배경 설명이 필요한 독립 질문만 FAQ에 유지한다. 예: `지역 내 후보가 적으면 주변 지역 후보를 왜 포함하는가?`.
3. `topic + intent + action`이 같거나 answer summary가 같은 FAQ는 삭제/교체한다. exact/normalized duplicate도 삭제한다.
4. body/table에서 이미 답한 구체 값은 FAQ에서 재나열하지 않는다.
5. 비중복 FAQ가 1개 이하이면 FAQ H2 자체를 생략할 수 있어야 한다. 고정 2~4개를 채우지 않는다.

quality 분류: facts 밖의 구체값 또는 body/table 충돌은 hard failure; semantic duplicate, FAQ끼리 반복, 장문의 checklist, 새 정보 없는 FAQ는 warning; topic 중복률과 actionability는 score penalty다.
