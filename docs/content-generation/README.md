# 생성 모델 설계·검증 기록 (시점 기록 — 현행 문서가 아니다)

> 이 폴더의 108건은 `c612167`(2026-07-29)로 편입된 **그때그때의 설계안·실험 계획·측정 결과**다.
> 당시 판단을 남겨 두는 것이 목적이므로 **현재 코드와 일치하지 않는 서술이 정상**이며, 현재에 맞게
> 고치지 않는다(고치면 왜 그렇게 결정했는지가 사라진다).

## 읽을 때 주의

- **제목이 현재형인 문서가 몇 개 있다** — `current-architecture.md`, `current-patterns-and-modifiers.md`,
  `recommended-improvements.md`, `prompt-vs-quality-gate-responsibility.md`, `quality-gate-severity.md`.
  전부 작성 시점의 현재이고, 지금의 현재가 아니다.
- **`t01-*` 문서가 다수다. T01 계열은 폐기됐다** — 학원 소개·비교 글의 정본은 T16(`local_axis`)이다.
  이 폴더를 근거로 `t01-*.ts`를 고치면 지금 도는 글에는 아무 효과가 없다(`CLAUDE.md`의 함정 항목 참조).
- 여기서 검토만 하고 채택하지 않은 방향도 섞여 있다(예: `openai_responses` provider는 러너에 구현돼
  있으나 관리자 화면에는 노출되지 않는다).

## 지금의 정본은 어디인가

| 알고 싶은 것 | 정본 |
| --- | --- |
| 전체 구조·의도 | `DEVELOPER_CONTEXT.md`, `docs/source-analysis.md` |
| 관리자/공개 API 계약 | `docs/admin-json-api.md` |
| 글유형·프리셋·제목 규칙 | `apps/api-nest/src/constants.ts` |
| 글의 섹션 구조·문체 | `apps/api-nest/src/archetypes.ts`, `t16-axis-comparison.ts` |
| 품질 게이트 | `apps/api-nest/src/quality-gate.ts` + `scripts/qa-posts.mjs`(두 곳 미러) |
| 원천 필드가 어디에 쓰이는지 | `docs/source-field-usage.md` |
| 반드시 알아야 할 함정 | `CLAUDE.md` |
