# Design

## Source of truth
- Status: Active
- Last refreshed: 2026-06-22
- Primary product surfaces: Adrock Ops dashboard, dashboard flow starter, domain detail workflow, slots/jobs/posts operations.
- Evidence reviewed: `apps/admin-next/app/globals.css`, `apps/admin-next/app/layout.tsx`, `apps/admin-next/components/AppShell.tsx`, `apps/admin-next/components/DomainClient.tsx`, `apps/admin-next/components/JobsClient.tsx`, `DEPLOY.md`, `docs/admin-json-api.md`.

## Brand
- Personality: operational, trustworthy, direct, Korean-first internal tooling.
- Trust signals: visible job status, clear counts, previews before bulk actions, durable export/indexing controls.
- Avoid: consumer-like decoration that hides operational state; unexplained technical terms in primary flows.

## Product goals
- Goals: let non-developer operators choose a generation mode from the dashboard, create, monitor, review, export, and index community SEO posts safely.
- Non-goals: replace expert editorial review; hide advanced generation options from power users.
- Success signals: first test post can be generated without verbal onboarding; operators can distinguish basic generation from advanced slot setup before entering a domain; each domain exposes a recommended next action; bulk generation is gated by clear context; failed jobs show next actions.

## Personas and jobs
- Primary personas: content operations manager, SEO operator, technical maintainer.
- User jobs: configure a domain, prepare source data, generate one test post, monitor jobs, review posts, export/index finished content.
- Key contexts of use: desktop admin sessions, occasional narrow viewport use, long-running worker jobs.

## Information architecture
- Primary navigation: dashboard, jobs, domain detail tabs.
- Core routes/screens: `/`, `/jobs`, `/t/[domain]`, `/t/[domain]/post/[postId]`.
- Content hierarchy: dashboard flow choice -> domain status -> workflow steps -> active tab task -> detailed tables/results.

## Design principles
- Principle 1: reveal the next safe action before advanced controls.
- Principle 2: use guided focus for multi-step generation so operators always know where to click next.
- Principle 3: mode first, tabs second; the operator should choose “basic generation”, “advanced slot generation”, or “review/export” before facing tab-level controls. When the system can infer a next safe action, recommend it before showing all options.
- Tradeoffs: keep power-user controls available, but place them inside contextual cards and explain defaults; basic mode may skip configuration screens that advanced users can still open.

## Visual language
- Color: existing CSS variables; purple/blue primary, green success, amber queued/warning, red danger.
- Typography: system sans, compact admin table typography.
- Spacing/layout rhythm: cards, 16px grid gaps, 18px card padding, clear section hierarchy.
- Shape/radius/elevation: rounded cards/buttons with subtle shadows; focus spotlight may use stronger elevation.
- Motion: short transitions only; respect reduced-motion where possible.
- Imagery/iconography: minimal; operational badges and check marks over decorative icons.

## Components
- Existing components to reuse: `card`, `btn`, `badge`, `workflow`, `tabs`, `writer-hint`, `table-wrap`.
- New/changed components: dashboard flow starter cards, recommended next-action cards, grouped detailed step launchers, domain flow starter cards, guided tutorial overlay in `DomainClient`, using `data-tour` targets and a reusable spotlight tooltip.
- Variants and states: basic generation, advanced slot generation, review/export, deep-link step focus, start/next/back/finish, missing target fallback, highlighted target, overlay, mobile positioning.
- Token/component ownership: global CSS in `apps/admin-next/app/globals.css`; route-specific logic in `DomainClient.tsx`.

## Accessibility
- Target standard: practical WCAG AA for internal admin.
- Keyboard/focus behavior: tutorial dialog exposes buttons with labels; target context remains visible.
- Contrast/readability: overlay + white tooltip with high-contrast text; highlighted target outline.
- Screen-reader semantics: tutorial uses `role="dialog"` and progress labels.
- Reduced motion and sensory considerations: avoid large animations; spotlight should not flash.

## Responsive behavior
- Supported breakpoints/devices: desktop-first, functional tablet/mobile via existing 980px breakpoint.
- Layout adaptations: sidebar collapses; tutorial tooltip clamps to viewport and can fall back below target.
- Touch/hover differences: controls must be click/tap accessible without hover-only state.

## Interaction states
- Loading: retain existing loading cards; tutorial can start after domain payload loads.
- Empty: tutorial steps explain how to create missing slots/jobs/posts.
- Error: show existing toast/alert; tutorial must not swallow API errors.
- Success: after queueing, route to jobs tab and keep workflow visible.
- Disabled: disabled generation buttons still show why via surrounding copy.
- Offline/slow network: job tab auto-refresh remains primary feedback.

## Content voice
- Tone: concise Korean operator guidance.
- Terminology: prefer “기본 글 생성”, “고급 슬롯 생성”, “검수/내보내기”, “글 후보”, “테스트 작성”, “작업 상태”, “완성 글” over raw technical terms where possible.
- Microcopy rules: each step should say objective, exact action, and what changes after action; labels should expose numbered substeps like 기본 1, 고급 2, 검수 1.

## Implementation constraints
- Framework/styling system: Next.js App Router, React client components, plain CSS in `globals.css`.
- Design-token constraints: reuse CSS variables; no new UI dependency.
- Performance constraints: tutorial only queries DOM while active; no heavy observers.
- Compatibility constraints: avoid browser APIs that break SSR; access DOM inside `useEffect` only.
- Test/screenshot expectations: run typecheck and use Playwright geometry/smoke checks for tutorial start/next/finish.

## Open questions
- [ ] Should tutorial auto-start for first-time domain operators or remain manual? Owner: product/operator; impact: onboarding friction vs interruption.
- [ ] Should generated post QA become a formal approve/reject state? Owner: product/engineering; impact: editorial governance.
