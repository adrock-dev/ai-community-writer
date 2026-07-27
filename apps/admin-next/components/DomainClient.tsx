"use client";

import { api, cloneTemplate, createTemplate, deleteTemplate, downloadPostExport, enqueueGenerate, getAcademyCoverage, getCoherence, getDomainDetail, getOptions, getRuntimeApis, listAcademies, listPosts, listSlots, listTemplates, replaceAxis, setBuiltinVisibility, suggestTemplateAxes, updateSlotTitle, validateTemplateDirection, type DirectionValidation, syncDrivingplusAcademies, syncDrivingplusRegions, getSyncRun, listSyncRuns, cancelSyncRun, type SyncRun, getRegionDirectory, syncRegionDirectory, type RegionDirectoryStatus, getResearchSummary, type ResearchSummary, updateDomain, updateTemplate } from "@/lib/api";
import { brandNameWarnings, publicBrandName } from "@/lib/brand";
import { formatDateTime, parseUtcTimestamp } from "@/lib/date";
import { designSettingLabel, getDesignTheme } from "@/lib/design-theme";
import { recommendedGenerationTimeoutSec, getGenerationDefaults } from "@/lib/generation-defaults";
import { rememberDomain } from "@/lib/recent-domain";
import { getSyncSummary, recordSync, type SyncSummary } from "@/lib/sync-summary";
import { JobCard } from "./JobCard";
import { isTourEnabled, isTourFocus, isTourMode, setTourEnabled, type TourFocus, type TourMode } from "@/lib/tour";
import type { AcademyCoverage, Academy, AdminOptions, Axis, AxisValue, CoherenceTemplate, CustomTemplate, DesignTemplateOption, DomainConfig, DomainDetailPayload, Job, PostSummary, Provider, RuntimeApis, Slot, SlotCounts, TemplateSpec, TitleRule } from "@/lib/types";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

// 동기화 상태 폴링이 연속으로 이만큼 실패하면 화면 갱신을 포기한다(동기화 자체는 서버에서 계속된다).
const POLL_MAX_ERRORS_IN_A_ROW = 10;

/**
 * 동기화가 "성공"으로 끝났어도 운영자가 알아야 하는 것을 문장으로 만든다.
 *
 * 특히 blog_review_preserved 가 핵심이다. 원천의 블로그리뷰 조회는 처리 한계를 넘으면 예외가
 * 아니라 빈 배열로 응답해서, 예전에는 그게 "후기 0건"으로 저장돼 멀쩡한 후기가 삭제됐다.
 * 지금은 보존하지만, 보존했다는 사실이 성공 문구에 묻히면 원천이 계속 느려져도 아무도 모른 채
 * 후기가 낡아간다. 그래서 0이 아니면 반드시 눈에 띄게 세운다.
 */
function syncWarningText(res: { blog_review_preserved?: number; warnings?: string[] }): string {
  const parts: string[] = [];
  if (res.blog_review_preserved) {
    parts.push(`블로그리뷰를 가져오지 못한 학원이 ${res.blog_review_preserved}곳 있습니다. 기존 후기는 지우지 않고 유지했지만, 그만큼 자료가 낡은 상태입니다. 원천 상태를 확인한 뒤 다시 동기화하세요.`);
  }
  for (const warning of res.warnings ?? []) {
    // 서버가 같은 취지로 넣은 요약은 중복이므로 뺀다.
    if (warning.includes("기존 후기를 유지")) continue;
    parts.push(warning);
  }
  return parts.join(" ");
}

const AXIS_LABEL: Record<Axis, string> = {
  region: "어느 지역 글인가요?",
  keyword: "어떤 검색어를 노릴까요?",
  intent: "사용자는 뭘 알고 싶어 하나요?",
  persona: "누구에게 말할까요?",
  modifier: "어떤 장점을 강조할까요?",
};
const AXIS_PLACEHOLDER: Record<Axis, string> = {
  region: "강남구\n송파구\n분당",
  keyword: "운전면허학원\n운전면허 비용\n도로주행 시험",
  intent: "빠른 합격\n비용 절약\n초보자 준비",
  persona: "직장인\n대학생\n장롱면허",
  modifier: "셔틀 편리\n친절한 강사\n최단기",
};
const TABS = [
  ["overview", "개요"], ["academies", "원천 데이터"], ["plan", "글 공통 설정"], ["templates", "글유형/디자인"],
  ["slots", "글 생성"], ["jobs", "작업 큐"], ["posts", "검수·내보내기"], ["settings", "설정"],
] as const;

const TOUR_MODE_COPY: Record<TourMode, { label: string; short: string; desc: string }> = {
  basic: { label: "글 생성", short: "생성", desc: "글유형 켜기 → 원천 데이터 → 후보 → 테스트 작성까지 순서대로 안내하는 생성 흐름" },
  review: { label: "검수/내보내기", short: "검수", desc: "작업 상태와 완성 글을 확인하고 export/indexing으로 넘기는 마감 흐름" },
};

const STEP_GROUPS: Array<{ title: string; desc: string; steps: Array<{ mode: TourMode; focus: TourFocus; no: string; title: string; desc: string; tone?: "primary" }> }> = [
  {
    title: "글 생성",
    desc: "선택 준비(원천·공통설정·디자인) 후 글유형 켜기 → 생성 · 필요한 단계만 눌러도 됩니다",
    steps: [
      { mode: "basic", focus: "source", no: "선택", title: "원천 데이터 준비", desc: "지역/학원 자료 동기화(선택)" },
      { mode: "basic", focus: "plan", no: "선택", title: "글 공통 설정", desc: "공통원칙·제외어·키워드(선택)" },
      { mode: "basic", focus: "template-design", no: "선택", title: "디자인", desc: "유형별 자동 매칭 확인(선택)" },
      { mode: "basic", focus: "template-type", no: "필수", title: "글유형 켜기", desc: "만들 글 유형 선택(새 도메인 필수)", tone: "primary" },
      { mode: "basic", focus: "slot-create", no: "생성 1", title: "글 후보 만들기", desc: "글유형·개수로 후보 생성" },
      { mode: "basic", focus: "test-write", no: "생성 2", title: "1개 테스트 작성", desc: "대량 작성 전 안전 확인" },
    ],
  },
  {
    title: "검수/마감",
    desc: "생성 이후 확인, 내보내기, 색인 요청",
    steps: [
      { mode: "review", focus: "jobs", no: "검수 1", title: "작업 상태", desc: "대기·진행·실패 확인", tone: "primary" },
      { mode: "review", focus: "posts", no: "검수 2", title: "완성 글 검수", desc: "미리보기/export/indexing" },
    ],
  },
];

const PREVIEW_DESIGN_SPECS: Record<string, { topCta: string; bottomCta: string }> = {
  editorial: { topCta: "지금 바로 비교·예약", bottomCta: "상담/예약하러 가기" },
  comparison: { topCta: "BEST 한눈에 비교", bottomCta: "내게 맞는 곳 찾기" },
  "local-guide": { topCta: "내 주변에서 찾기", bottomCta: "가까운 곳 예약하기" },
  checklist: { topCta: "체크리스트 저장", bottomCta: "준비 시작하기" },
  conversion: { topCta: "비용 상담 신청", bottomCta: "지금 예약하기" },
  custom: { topCta: "자세히 보기", bottomCta: "문의하기" },
};

const DESIGN_BLUEPRINTS: Record<string, {
  label: string;
  title: string;
  lead: string;
  chips: string[];
  sections: string[];
  tone: string;
  blocks: Array<{ title: string; body: string; kind?: "table" | "quote" | "cta" | "list" }>;
}> = {
  editorial: {
    label: "정보성 글에 가장 무난한 매거진형 화면",
    title: "운전면허 처음 준비할 때 알아야 할 절차와 비용",
    lead: "초보자가 검색해서 들어왔을 때 필요한 배경 설명, 이미지, FAQ가 자연스럽게 이어집니다.",
    chips: ["가이드", "FAQ", "정보성"],
    sections: ["상단 CTA", "대표 이미지", "중앙 제목", "본문", "예약 CTA"],
    tone: "차분하고 친절한 전문가 톤",
    blocks: [
      { title: "도입", body: "왜 이 정보를 찾는지 공감한 뒤, 글에서 바로 얻을 수 있는 내용을 짧게 알려줍니다." },
      { title: "핵심 설명", body: "절차, 비용, 기간을 순서대로 풀고 중간에 이미지를 배치합니다." },
      { title: "FAQ", body: "처음 등록해도 되나요?|주말에도 가능한가요?|추가 비용은 언제 생기나요?", kind: "list" },
      { title: "자연스러운 CTA", body: "주변 학원 찾기나 예약 확인으로 부드럽게 연결합니다.", kind: "cta" },
    ],
  },
  comparison: {
    label: "표와 선택 기준이 먼저 보이는 비교형 화면",
    title: "강남 운전면허학원 BEST 5, 비용과 셔틀까지 한 번에 비교",
    lead: "여러 학원을 하나씩 찾지 않아도 되도록 가격대, 접근성, 추천 대상을 먼저 정리합니다.",
    chips: ["비교표", "BEST5", "추천"],
    sections: ["비교 기준", "요약 표", "선택지별 장단점", "추천 케이스", "CTA"],
    tone: "객관적이고 판단이 쉬운 톤",
    blocks: [
      { title: "비교 기준", body: "가격, 셔틀, 주말 수업, 도로주행 코스를 같은 기준으로 맞춰 비교합니다." },
      { title: "한눈에 보는 비교표", body: "표 아래에는 왜 이 항목이 중요한지 짧게 해석하는 문단이 붙습니다.", kind: "table" },
      { title: "추천 케이스", body: "직장인, 대학생, 장롱면허처럼 상황별 추천을 분리합니다." },
      { title: "마지막 전환", body: "가까운 학원과 예약 가능한 시간을 확인하도록 연결합니다.", kind: "cta" },
    ],
  },
  "local-guide": {
    label: "지역 검색어에 맞춘 로컬 랜딩 화면",
    title: "송파에서 운전면허 준비할 때 먼저 확인할 5가지",
    lead: "동네에서 실제로 고민하는 이동 거리, 셔틀, 야간 수업 여부를 앞쪽에 배치합니다.",
    chips: ["지역 SEO", "주변", "동선"],
    sections: ["지역 고민", "주변 선택 기준", "동선/접근성", "추천 시나리오", "CTA"],
    tone: "현장감 있는 로컬 큐레이터 톤",
    blocks: [
      { title: "지역 고민", body: "송파, 잠실, 문정처럼 생활권이 다른 사용자의 이동 동선을 나눠 설명합니다." },
      { title: "선택 체크", body: "집/학교와 가까운지|셔틀 시간이 맞는지|도로주행 코스가 어렵지 않은지", kind: "list" },
      { title: "실제 후기 톤", body: "퇴근 후 수업을 잡을 수 있어서 주말에 몰아서 배우는 부담이 줄었다는 식의 현실적인 후기를 넣습니다.", kind: "quote" },
      { title: "지역 CTA", body: "내 위치 기준으로 가까운 학원을 찾도록 연결합니다.", kind: "cta" },
    ],
  },
  checklist: {
    label: "빠르게 훑고 저장하기 좋은 체크리스트 화면",
    title: "도로주행 시험 전날 체크리스트, 실수 줄이는 순서",
    lead: "준비물과 감점 포인트를 먼저 보여주고, 상세 설명은 아래로 이어집니다.",
    chips: ["체크리스트", "시험", "절차"],
    sections: ["요약", "준비 체크", "절차", "주의사항", "FAQ"],
    tone: "간결하고 실무적인 안내 톤",
    blocks: [
      { title: "3분 요약", body: "신분증, 시험 시간, 코스 확인처럼 놓치면 바로 문제가 되는 항목을 맨 위에 둡니다." },
      { title: "준비 체크", body: "신분증 챙기기|시험장 도착 시간 확인|좌석/거울 조정 연습|감점 포인트 복습", kind: "list" },
      { title: "자주 하는 실수", body: "방향지시등, 일시정지, 속도 조절처럼 반복되는 실수를 실제 상황 중심으로 설명합니다." },
      { title: "시험 전 연결", body: "불안한 구간만 추가 연습할 수 있는 학원/강습 탐색으로 이어집니다.", kind: "cta" },
    ],
  },
  conversion: {
    label: "상담과 예약 전환을 강조하는 화면",
    title: "운전면허 비용이 부담될 때, 단기반 선택 전에 볼 기준",
    lead: "사용자의 문제를 먼저 잡고 해결 기준, 후기, CTA가 반복되지 않게 이어집니다.",
    chips: ["상담", "예약", "비용"],
    sections: ["문제 공감", "해결 기준", "사례/후기", "비용/혜택", "CTA"],
    tone: "신뢰를 주는 세일즈 톤",
    blocks: [
      { title: "문제 공감", body: "시간과 비용이 동시에 부담되는 상황을 구체적으로 짚어 이탈을 줄입니다." },
      { title: "해결 기준", body: "단기반, 셔틀, 추가 비용 여부를 상담 전 질문 목록으로 정리합니다." },
      { title: "후기 배치", body: "상담 후 전체 일정을 한 번에 잡을 수 있어 편했다는 톤으로 신뢰를 보강합니다.", kind: "quote" },
      { title: "상담 CTA", body: "비용과 가능한 일정을 바로 확인하는 버튼을 강하게 보여줍니다.", kind: "cta" },
    ],
  },
  custom: {
    label: "직접 입력한 메모를 기준으로 잡는 화면",
    title: "내가 정한 디자인을 반영한 글",
    lead: "오른쪽 메모에 원하는 화면 구조를 적으면 직접 만든 디자인 기준으로 저장됩니다.",
    chips: ["커스텀", "직접 설계"],
    sections: ["상단 구성", "본문 규칙", "표/이미지 위치", "CTA 위치"],
    tone: "사용자 정의",
    blocks: [
      { title: "상단 구성", body: "제목, 핵심 요약, 대표 이미지 등 직접 적은 규칙을 발행 렌더러가 참고할 수 있게 저장합니다." },
      { title: "본문 구성", body: "표, 이미지, CTA 위치처럼 반복될 디자인 규칙을 명시합니다." },
      { title: "전환 영역", body: "상담, 예약, 내부 링크 등 마지막 행동을 어디에 둘지 정합니다.", kind: "cta" },
    ],
  },
};


type DomainPageView = "overview" | "generate" | "posts";

export default function DomainClient({ domain, view = "overview", initialTab: initialTabProp }: { domain: string; view?: DomainPageView; initialTab?: string }) {
  // ?tab= 로 넘어온 유효한 탭이면 우선(다른 라우트의 탭으로 딥링크). 없으면 view 기반 기본 탭.
  const requestedTab = initialTabProp && TABS.some(([id]) => id === initialTabProp) ? initialTabProp : undefined;
  const initialTab = requestedTab ?? (view === "generate" ? "slots" : view === "posts" ? "posts" : "overview");
  const [payload, setPayload] = useState<DomainDetailPayload | null>(null);
  const [options, setOptions] = useState<AdminOptions | null>(null);
  const [tab, setTab] = useState(initialTab);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tourStep, setTourStep] = useState<number | null>(null);
  const [tourMode, setTourMode] = useState<TourMode>("basic");
  const handledFlowParam = useRef(false);
  const tourSteps = useMemo(
    () => buildOperatorTourSteps(tourMode, payload?.slot_counts),
    [payload?.slot_counts, tourMode],
  );

  async function refresh() {
    const [opts, detail] = await Promise.all([getOptions(), getDomainDetail(domain)]);
    setOptions(opts); setPayload(detail);
  }
  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    handledFlowParam.current = false;
    setPayload(null);
    setOptions(null);
    setError("");
    // 도메인이 바뀌면 이전 도메인의 탭/튜토리얼 상태가 넘어오지 않도록 초기화(직접 A→B 이동 대비 안전장치).
    setTab(initialTab);
    setTourStep(null);
    setTourMode("basic");
    rememberDomain(domain);
    refresh().catch((e) => setError(e.message));
  }, [domain]);

  function goToTourStep(mode: TourMode, focus?: TourFocus, _opts: { overlay?: boolean } = {}) {
    // focus 는 해당 튜토리얼 단계로 그대로 매핑되고(focus 없는 '흐름 시작'은 첫 단계=원천 데이터),
    // 튜토리얼 ON/OFF 와 무관하게 같은 탭에 착지한다(오버레이만 ON 일 때 추가로 열림).
    const nextSteps = buildOperatorTourSteps(mode, payload?.slot_counts);
    const startIndex = focus ? Math.max(0, nextSteps.findIndex((step) => step.focus === focus || step.target === focus)) : 0;
    setTourMode(mode);
    setTab(nextSteps[startIndex]?.tab ?? nextSteps[0]?.tab ?? "overview");
    return startIndex;
  }

  function startTour(mode: TourMode = "basic", focus?: TourFocus) {
    const overlay = isTourEnabled();
    const startIndex = goToTourStep(mode, focus, { overlay });
    // 튜토리얼이 켜져 있을 때만 오버레이를 연다. 꺼져 있으면 해당 흐름의 첫 실작업 탭으로 조용히 진입.
    if (overlay) setTourStep(startIndex);
  }

  useEffect(() => {
    if (!payload || handledFlowParam.current) return;
    const params = new URLSearchParams(window.location.search);
    const flow = params.get("flow");
    if (!isTourMode(flow)) return;
    const focusParam = params.get("focus");
    const focus = isTourFocus(focusParam) ? focusParam : undefined;
    handledFlowParam.current = true;
    const overlay = isTourEnabled();
    const startIndex = goToTourStep(flow, focus, { overlay });
    // ?flow= 로 진입해도 탭 이동만 하고, 튜토리얼이 켜져 있을 때만 오버레이를 연다.
    if (overlay) setTourStep(startIndex);
    params.delete("flow");
    params.delete("focus");
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }, [payload]);

  if (error) return (
    <div className="card card-pad grid" style={{ maxWidth: 720 }}>
      <p className="eyebrow">도메인을 찾을 수 없습니다</p>
      <h2>{domain}</h2>
      <p className="toast-error">{error}</p>
      <p className="muted">등록되지 않은 도메인이거나 API 연결에 문제가 있을 수 있습니다. 대시보드에서 도메인을 만들거나 목록에서 다시 선택하세요.</p>
      <div className="row">
        <Link className="btn primary" href="/need-domain?from=manage">도메인 만들기 안내</Link>
        <Link className="btn" href="/">대시보드로</Link>
      </div>
    </div>
  );
  if (!payload || !options) return <div className="card card-pad">로딩 중...</div>;
  const domainConfig = payload.domain;
  const counts = payload.slot_counts;

  async function saveDomain(fields: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await updateDomain(domain, fields);
      setPayload((prev) => prev ? { ...prev, domain: res.domain } : prev);
      await refresh();
    } catch (e) { alert((e as Error).message); }
    finally { setBusy(false); }
  }

  const title = view === "generate" ? "글 생성" : view === "posts" ? "검수·내보내기" : domainConfig.display_name;
  const eyebrow = view === "overview" ? "← 대시보드" : `← ${domainConfig.display_name}`;
  const backHref = view === "overview" ? "/" : `/t/${encodeURIComponent(domainConfig.domain)}`;
  const focusedPage = view === "generate" || view === "posts";

  return (
    <div>
      <div className="page-head">
        <div>
          <Link href={backHref} className="eyebrow">{eyebrow}</Link>
          <h1><span style={{ color: domainConfig.brand_color ?? "var(--primary)" }}>●</span> {title}</h1>
          <p className="muted mono">{domainConfig.domain}</p>
        </div>
        <div className="row">
          <span className="badge">{options?.verticals.find((v) => v.key === domainConfig.vertical)?.label ?? domainConfig.vertical}</span>
        </div>
      </div>

      {!focusedPage && <Workflow domain={domainConfig} counts={counts} active={tab} onTab={setTab} />}

      {!focusedPage && <div className="tabs">
        {TABS.map(([id, label]) => <button key={id} className={`tab ${tab === id ? "active" : ""}`} onClick={() => setTab(id)}>{label}</button>)}
      </div>}

      {view === "generate" && <div className="grid">
        <div className="card card-pad">
          <p className="eyebrow">생성 전용 페이지</p>
          <h2>1단계 후보 만들기 → 2단계 글 작성 순서로 진행하세요</h2>
          <p className="muted">글 생성 탭이 두 단계로 나뉩니다. 먼저 후보를 만들고, 2단계 카드에서 1개 테스트 작성으로 품질을 확인한 뒤 확장하세요.</p>
        </div>
        <Slots domain={domainConfig} slots={payload.slots ?? []} options={options} onRefresh={refresh} onTab={setTab} />
      </div>}
      {view === "posts" && <div className="grid">
        <div className="card card-pad">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <p className="eyebrow">검수 전용 페이지</p>
              <h2>완성 글 확인, 내보내기, 색인 요청을 한곳에서 처리하세요</h2>
              <p className="muted">제목을 눌러 상세 미리보기를 확인하고 필요한 글만 선택해 Markdown/HTML로 내보내거나 색인 요청을 등록합니다.</p>
            </div>
            <Link className="btn" href={`/t/${encodeURIComponent(domainConfig.domain)}/drafts`}>검수 대기(게이트 미통과) →</Link>
          </div>
        </div>
        <Posts domain={domainConfig} posts={payload.posts ?? []} onRefresh={refresh} />
      </div>}

      {view === "overview" && tab === "overview" && <Overview domain={domainConfig} counts={counts} onTab={setTab} onStartFlow={startTour} />}
      {view === "overview" && tab === "plan" && <><Principles domain={domainConfig} busy={busy} onSave={saveDomain} onRefresh={refresh} /><KeywordMaster domain={domainConfig.domain} presetKey={domainConfig.vertical || "driving"} keywordAxis={(payload.axes?.keyword ?? []) as AxisValue[]} onRefresh={refresh} /></>}
      {view === "overview" && tab === "templates" && <Templates domain={domainConfig} options={options} customTemplates={payload.custom_templates ?? []} keywordPool={(payload.axes?.keyword ?? []).map((k) => String(k.value))} busy={busy} onSave={saveDomain} onRefresh={refresh} />}
      {view === "overview" && tab === "academies" && <Academies domain={domainConfig} academies={payload.academies ?? []} regionAxis={(payload.axes?.region ?? []) as AxisValue[]} busy={busy} onSave={saveDomain} onRefresh={refresh} />}
      {view === "overview" && tab === "slots" && <Slots domain={domainConfig} slots={payload.slots ?? []} options={options} onRefresh={refresh} onTab={setTab} />}
      {view === "overview" && tab === "jobs" && <Jobs domain={domainConfig} jobs={payload.jobs ?? []} onRefresh={refresh} />}
      {view === "overview" && tab === "posts" && <Posts domain={domainConfig} posts={payload.posts ?? []} onRefresh={refresh} />}
      {view === "overview" && tab === "settings" && <Settings domain={domainConfig} options={options} onSave={saveDomain} onRefresh={refresh} />}
      {tourStep !== null && <OperatorTour mode={tourMode} steps={tourSteps} stepIndex={tourStep} onStepChange={setTourStep} onTab={setTab} onClose={() => setTourStep(null)} onDismissPermanently={() => { setTourEnabled(false); setTourStep(null); }} />}
    </div>
  );
}

const TOUR_FULL_CARD_TARGETS = new Set(["academies-sync", "slots-writer"]);

type TourStep = {
  focus: TourFocus;
  tab: string;
  target: string;
  title: string;
  body: string;
  action: string;
};

function buildOperatorTourSteps(mode: TourMode, counts?: SlotCounts): TourStep[] {
  const hasSlots = Boolean(counts && Object.values(counts).reduce((sum, value) => sum + value, 0) > 0);
  const hasPosts = Boolean(counts && counts.published > 0);
  const sourceSync: TourStep = { focus: "source", tab: "academies", target: "academies-sync", title: "(선택) 원천 데이터 준비", body: "지역과 학원 데이터를 가져와두면 생성 글이 검증된 자료를 기반으로 작성됩니다. 처음이면 지역 동기화 후 학원 동기화 순서를 권장합니다. 지금 건너뛰고 나중에 준비해도 됩니다. (상단 진행 막대가 전체 흐름입니다.)", action: "데이터가 이미 있거나 나중에 할 거면 다음 단계로 넘어가세요." };
  const planBrief: TourStep = { focus: "plan", tab: "plan", target: "plan-brief", title: "(선택) 글 공통 설정", body: "모든 글에 공통 적용될 안전·데이터 원칙, 절대 넣지 말 제외어, 키워드 마스터를 정합니다. 지금 건너뛰고 나중에 정해도 됩니다.", action: "입력 후 ‘저장’을 누르거나, 필요 없으면 다음으로 넘어가세요." };
  const templateDesign: TourStep = { focus: "template-design", tab: "templates", target: "templates-design", title: "(선택) 디자인 (자동 매칭)", body: "글 유형마다 기본 디자인이 자동 적용됩니다. 대부분 그대로 두면 되고, 특별한 레이아웃이 필요할 때만 커스텀 디자인 메모나 커스텀 글유형 복제로 조정합니다.", action: "특별한 요구가 없으면 그대로 두고 넘어가세요." };
  const templateType: TourStep = { focus: "template-type", tab: "templates", target: "templates-types", title: "글 유형을 켜세요 (필수)", body: "새 도메인은 글 유형이 하나도 켜져 있지 않아 이 단계 없이는 후보를 만들 수 없습니다. 비교형·지역형·체크리스트형처럼 어떤 검색 의도에 맞출지 고르고 켜면 즉시 저장됩니다. 위에서 준비한 원천 데이터·공통 설정을 근거로 커스텀 유형을 만들 수도 있습니다.", action: "운영 초반엔 필요한 유형만 켜세요. 너무 많이 켜면 후보가 급증합니다." };
  const slotGenerate: TourStep = {
    focus: "slot-create",
    tab: "slots",
    target: "slots-generator",
    title: hasSlots ? "1단계 · 후보가 이미 있습니다" : "1단계 · 글 후보 만들기",
    body: hasSlots
      ? "아래 목록에 후보가 있으면 1단계는 건너뛰어도 됩니다. 더 필요할 때만 「글유형」과 「개수」를 정하고 「글 후보 만들기」로 추가하세요."
      : "1단계 카드에서 「글유형」을 고르고 「개수」를 정한 뒤 「글 후보 만들기」를 누르세요. LLM은 호출하지 않고 기획 축·글유형 조합만 만듭니다.",
    action: hasSlots ? "후보가 충분하면 다음 단계(2단계 글 작성)로 이동하세요." : "실행 후 맨 아래 후보 목록에 행이 생겼는지 확인하세요.",
  };
  const testWrite: TourStep = {
    focus: "test-write",
    tab: "slots",
    target: "slots-writer",
    title: "2단계 · 1개 테스트 작성",
    body: hasSlots
      ? "2단계 카드의 작성 엔진·모델·이미지 옵션은 글 작성에만 적용됩니다. 처음엔 「1개 테스트 작성」만 눌러 품질을 확인하세요."
      : "후보가 없어도 이 버튼은 1단계 후보 생성을 자동 실행한 뒤 큐에 등록합니다. 대량 버튼은 QA 확인 후 사용하세요.",
    action: "버튼을 누르면 작업 큐 탭에서 진행 상태를 확인합니다.",
  };
  const jobsBoard: TourStep = { focus: "jobs", tab: "jobs", target: "jobs-board", title: "작업 상태 확인", body: "큐에 등록된 글 생성 작업이 대기·진행·완료·실패 중 어디에 있는지 봅니다. 실패하면 상세 카드의 에러를 확인하고 같은 조건으로 다시 시도합니다.", action: "완료 후 검수·내보내기 탭에서 결과를 검수합니다." };
  const postsReview: TourStep = { focus: "posts", tab: "posts", target: "posts-actions", title: hasPosts ? "완성 글 검수/내보내기" : "완성 글이 여기에 쌓입니다", body: hasPosts ? "제목을 눌러 상세 미리보기를 확인하고, 필요한 글을 선택해 Markdown/HTML로 내보내거나 색인 요청을 등록합니다." : "테스트 작성이 완료되면 이 화면에 글이 나타납니다. 여기서 검수, export, 색인 요청을 진행합니다.", action: "이 흐름이 안정적이면 현재 검색 10개, 이후 100개로 확장하세요." };

  if (mode === "review") {
    return [jobsBoard, postsReview];
  }
  // 통합 「글 생성」 흐름: (선택)원천데이터·공통설정·디자인 → 글유형 켜기(필수) → 후보 → 테스트 → 작업큐 → 검수.
  return [sourceSync, planBrief, templateDesign, templateType, slotGenerate, testWrite, jobsBoard, postsReview];
}

function OperatorTour({ mode, steps, stepIndex, onStepChange, onTab, onClose, onDismissPermanently }: { mode: TourMode; steps: TourStep[]; stepIndex: number; onStepChange: (value: number | null) => void; onTab: (value: string) => void; onClose: () => void; onDismissPermanently: () => void }) {
  const step = steps[stepIndex];
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [missingTarget, setMissingTarget] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!step) return;
    onTab(step.tab);
  }, [step?.tab, onTab]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (!step) return;
    let disposed = false;
    let active: HTMLElement | null = null;
    const update = () => {
      if (disposed) return;
      active?.classList.remove("tour-target-active");
      active = document.querySelector(`[data-tour="${step.target}"]`) as HTMLElement | null;
      if (!active && step.target === "posts-actions") active = document.querySelector(`[data-tour="posts-review"]`) as HTMLElement | null;
      if (!active) {
        setMissingTarget(true);
        setTargetRect(null);
        return;
      }
      setMissingTarget(false);
      active.classList.add("tour-target-active");
      const rawRect = active.getBoundingClientRect();
      const scrollBlock = rawRect.height > window.innerHeight * 0.55 ? "start" : "center";
      active.scrollIntoView({ block: scrollBlock, inline: "nearest", behavior: "smooth" });
      window.setTimeout(() => {
        if (!disposed && active) {
          const rect = active.getBoundingClientRect();
          setTargetRect(TOUR_FULL_CARD_TARGETS.has(step.target) ? rect : clampTourRect(rect));
        }
      }, 180);
    };
    const id = window.setTimeout(update, 80);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      disposed = true;
      window.clearTimeout(id);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      active?.classList.remove("tour-target-active");
    };
  }, [step?.target, step?.tab]);

  if (!step) return null;
  const total = steps.length;
  const canBack = stepIndex > 0;
  const canNext = stepIndex < total - 1;
  const tooltipStyle = tourTooltipStyle(targetRect);
  const tourCard = <section className="tour-card" role="dialog" aria-modal="true" aria-label={`${TOUR_MODE_COPY[mode].label} 튜토리얼`} style={tooltipStyle}>
    <div className="tour-card-head spread"><span className="badge info">{TOUR_MODE_COPY[mode].short} · {stepIndex + 1} / {total}</span><button className="btn ghost" onClick={onClose} aria-label="튜토리얼 닫기">×</button></div>
    <h2>{step.title}</h2>
    <p className="muted">{step.body}</p>
    <div className="writer-hint"><b>해야 할 일</b><span>{step.action}</span></div>
    {missingTarget && <p className="small" style={{ color: "var(--warning)" }}>현재 단계의 대상 영역을 찾는 중입니다. 탭을 전환했거나 데이터가 아직 로딩 중이면 잠시 뒤 다시 표시됩니다.</p>}
    <div className="tour-progress" style={{ gridTemplateColumns: `repeat(${total}, 1fr)` }} aria-hidden="true">{steps.map((_, i) => <span key={i} className={i <= stepIndex ? "active" : ""} />)}</div>
    <div className="tour-card-actions">
      <div className="spread">
        <button className="btn" disabled={!canBack} onClick={() => onStepChange(stepIndex - 1)}>이전</button>
        <button className="btn primary" onClick={() => canNext ? onStepChange(stepIndex + 1) : onClose()}>{canNext ? "다음" : "완료"}</button>
      </div>
      <div className="tour-card-dismiss">
        <button className="btn ghost" onClick={onDismissPermanently}>더 이상 안 보기</button>
      </div>
    </div>
  </section>;

  return <div className="tour-layer" aria-live="polite">
    <div className="tour-scrim" onClick={onClose} />
    {targetRect && <div className="tour-spotlight" style={{ top: targetRect.top - 8, left: targetRect.left - 8, width: targetRect.width + 16, height: targetRect.height + 16 }} />}
    {mounted && createPortal(tourCard, document.body)}
  </div>;
}

function clampTourRect(rect: DOMRect, maxHeight = 300): DOMRect {
  if (rect.height <= maxHeight) return rect;
  return DOMRect.fromRect({ x: rect.x, y: rect.y, width: rect.width, height: maxHeight });
}

function tourTooltipStyle(rect: DOMRect | null): React.CSSProperties {
  if (!rect) return { top: 92, left: "50%", transform: "translateX(-50%)" };
  const width = 380;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const cardHeight = Math.min(360, viewportHeight - 36);
  const margin = 18;
  const below = rect.bottom + margin;
  const above = rect.top - margin;
  let top = below + cardHeight < viewportHeight ? below : Math.max(margin, above - cardHeight);
  if (top + cardHeight > viewportHeight - margin) top = viewportHeight - cardHeight - margin;
  const rawLeft = rect.left + Math.min(40, Math.max(0, rect.width - width) / 2);
  const left = Math.max(margin, Math.min(rawLeft, viewportWidth - width - margin));
  return { top, left, width };
}

function Workflow({ domain, counts, active, onTab }: { domain: DomainConfig; counts: SlotCounts; active: string; onTab: (v: string) => void }) {
  const totalSlots = Object.values(counts).reduce((a, b) => a + b, 0);
  // 진행 막대는 필수 진행 4단계만 추적한다. 원천 데이터·공통 설정·디자인은 선택 준비라 흐름/추천 액션이 안내한다.
  const steps = [
    { tab: "templates", title: "유형/디자인", done: domain.templates_enabled.length > 0, count: `${domain.templates_enabled.length}개` },
    { tab: "slots", title: "후보/작성", done: totalSlots > 0, count: `${totalSlots}개` },
    { tab: "jobs", title: "작업", done: counts.in_progress > 0 || counts.published > 0, count: counts.in_progress > 0 ? `${counts.in_progress}개 진행` : "상태 확인" },
    { tab: "posts", title: "완성", done: counts.published > 0, count: `${counts.published}개` },
  ];
  return <div className="workflow" data-tour="workflow" style={{ marginBottom: 20 }}>{steps.map((s, i) => <button key={s.tab} className={`step ${s.done ? "done" : ""} ${active === s.tab ? "active" : ""}`} onClick={() => onTab(s.tab)}><b>{i + 1}. {s.title}</b><p className="muted small">{s.count}</p></button>)}</div>;
}

function Overview({ domain, counts, onTab, onStartFlow }: { domain: DomainConfig; counts: SlotCounts; onTab: (v: string) => void; onStartFlow: (mode: TourMode, focus?: TourFocus) => void }) {
  return <div className="grid">
    <RecommendedNextAction domain={domain} counts={counts} onStartFlow={onStartFlow} />
    <section className="flow-start" aria-labelledby="flow-start-title">
      <div>
        <p className="eyebrow">운영 시작</p>
        <h2 id="flow-start-title">지금 하려는 작업을 고르면 화면이 그 흐름으로 바뀝니다</h2>
        <p className="muted">「글 생성」 흐름은 원천 데이터·공통 설정·디자인(모두 선택) 준비 후 글유형 켜기(필수)로 이어지고, 후보 만들기·테스트 작성으로 마무리합니다.</p>
      </div>
      <div className="grid grid-2">
        <FlowStartCard title="글 생성" badge="추천" body="(선택) 원천 데이터·공통 설정·디자인 → 글유형 켜기(필수) → 후보 만들기 → 테스트 작성까지 순서대로 안내합니다." cta="글 생성 흐름 시작" tone="primary" onClick={() => onStartFlow("basic")} />
        <FlowStartCard title="검수/내보내기" badge="마감" body="작업 큐와 완성 글만 빠르게 확인해서 Markdown/HTML export와 색인 요청으로 넘깁니다." cta="검수 흐름 시작" onClick={() => onStartFlow("review")} />
      </div>
    </section>
    <StepLaunchPanel onStartFlow={onStartFlow} />
    <div className="grid grid-4">
      <Stat label="대기 후보" value={counts.planned} /><Stat label="진행" value={counts.in_progress} /><Stat label="발행" value={counts.published} accent /><Stat label="실패" value={counts.failed} /><Stat label="스킵" value={counts.skipped} />
    </div>
    <div className="grid grid-2">
      <div className="card card-pad"><h2>공통 작성 원칙</h2><p className="muted">{domain.common_principles || "아직 공통 원칙이 없습니다."}</p><button className="btn" onClick={() => onTab("plan")}>글 공통 설정 열기</button></div>
      <div className="card card-pad"><h2>글 유형/디자인</h2><p className="muted">글 유형 {domain.templates_enabled.length}개 · 디자인 {designSettingLabel(domain.design_template_id)}</p><button className="btn" onClick={() => onTab("templates")}>글유형/디자인 열기</button></div>
    </div>
    <div className="card card-pad" data-tour="overview-quickstart"><h2>빠른 시작</h2><ol className="muted"><li>(선택) 원천 데이터 탭에서 지역/학원 동기화</li><li>(선택) 글 공통 설정 탭에서 공통원칙·제외어·키워드 정리</li><li>(선택) 글유형/디자인 탭에서 디자인 확인</li><li>글유형/디자인 탭에서 만들 글 유형 켜기(새 도메인 필수)</li><li>글 생성 탭: 1단계 후보 만들기 → 2단계 글 작성 → 후보 목록 확인</li><li>작업 큐 → 검수·내보내기 탭에서 검수하고 색인/중복/가지치기 실행</li></ol><p className="muted small">「글 생성 흐름 시작」을 누르면 위 순서대로 카드 영역을 포커싱합니다.</p></div>
  </div>;
}

function FlowStartCard({ title, badge, body, cta, tone, onClick }: { title: string; badge: string; body: string; cta: string; tone?: "primary"; onClick: () => void }) {
  return <article className={`flow-card ${tone === "primary" ? "primary" : ""}`}>
    <div className="spread"><h3>{title}</h3><span className={`badge ${tone === "primary" ? "success" : "info"}`}>{badge}</span></div>
    <p className="muted">{body}</p>
    <button className={`btn ${tone === "primary" ? "primary" : ""}`} onClick={onClick}>{cta}</button>
  </article>;
}

function StepLaunchPanel({ onStartFlow }: { onStartFlow: (mode: TourMode, focus?: TourFocus) => void }) {
  return <section className="card card-pad step-launch-panel" aria-labelledby="step-launch-title">
    <div>
      <p className="eyebrow">세부 단계 바로 시작</p>
      <h2 id="step-launch-title">큰 흐름 안에서도 필요한 작업만 바로 열 수 있습니다</h2>
      <p className="muted">운영자가 이미 중간까지 진행했다면 처음부터 다시 보지 않고, 필요한 단계 버튼만 누르면 됩니다.</p>
    </div>
    <div className="step-launch-groups">
      {STEP_GROUPS.map((group) => <section className="step-launch-group" key={group.title}>
        <div><b>{group.title}</b><p className="muted small">{group.desc}</p></div>
        <div className="step-launch-grid">
          {group.steps.map((step) => <button key={`${step.mode}-${step.focus}`} className={`step-launch ${step.tone === "primary" ? "primary" : ""}`} onClick={() => onStartFlow(step.mode, step.focus)}>
            <span className="step-no">{step.no}</span>
            <b>{step.title}</b>
            <small>{step.desc}</small>
          </button>)}
        </div>
      </section>)}
    </div>
  </section>;
}

function RecommendedNextAction({ domain, counts, onStartFlow }: { domain: DomainConfig; counts: SlotCounts; onStartFlow: (mode: TourMode, focus?: TourFocus) => void }) {
  const action = getRecommendedNextAction(domain, counts);
  return <section className="next-action large" aria-labelledby="recommended-next-action">
    <div>
      <span className="badge success">추천 다음 작업</span>
      <h2 id="recommended-next-action">{action.title}</h2>
      <p className="muted">{action.desc}</p>
    </div>
    <button className="btn primary" onClick={() => onStartFlow(action.mode, action.focus)}>{action.cta}</button>
  </section>;
}

function getRecommendedNextAction(domain: DomainConfig, counts: SlotCounts): { title: string; desc: string; cta: string; mode: TourMode; focus: TourFocus } {
  const totalSlots = Object.values(counts).reduce((sum, value) => sum + value, 0);
  if (counts.failed > 0) return { title: "실패 작업부터 확인하세요", desc: `${counts.failed.toLocaleString()}개 실패가 있어 같은 조건으로 다시 만들기 전에 에러를 먼저 봐야 합니다.`, cta: "작업 상태 확인", mode: "review", focus: "jobs" };
  if (counts.in_progress > 0) return { title: "진행 중인 작업을 확인하세요", desc: `${counts.in_progress.toLocaleString()}개 작업이 진행 중입니다. 새 대량 생성보다 큐 상태 확인이 먼저입니다.`, cta: "작업 상태 확인", mode: "review", focus: "jobs" };
  if (counts.planned > 0) return { title: "1개 테스트 작성부터 하세요", desc: `${counts.planned.toLocaleString()}개 후보가 대기 중입니다. 품질 확인 없이 대량 생성하지 않도록 테스트 1개부터 시작합니다.`, cta: "테스트 작성 시작", mode: "basic", focus: "test-write" };
  if (domain.templates_enabled.length === 0) return { title: "글 생성 준비를 시작하세요", desc: "새 도메인입니다. 원천 데이터·공통 설정(선택)을 준비하고 글 유형을 켜면 후보를 만들 수 있습니다. 「글 생성」 흐름을 처음부터 따라가세요.", cta: "글 생성 흐름 시작", mode: "basic", focus: "source" };
  if (totalSlots === 0) return { title: "원천 데이터부터 준비하세요", desc: "글 유형은 켜져 있습니다. 지역/학원 데이터를 동기화한 뒤 글 후보를 만드세요.", cta: "원천 데이터 준비", mode: "basic", focus: "source" };
  if (!domain.common_principles) return { title: "공통 원칙을 먼저 저장하세요", desc: "후보는 있지만 공통 작성 원칙이 비어 있습니다. 이 사이트에서만 쓰는 말투·태도를 적어 두면 글의 결이 일정해집니다.", cta: "공통 원칙 열기", mode: "basic", focus: "plan" };
  if (counts.published > 0) return { title: "완성 글을 검수하고 내보내세요", desc: `${counts.published.toLocaleString()}개 완성 글이 있습니다. 미리보기 후 Markdown/HTML export와 색인 요청으로 마감하세요.`, cta: "완성 글 검수", mode: "review", focus: "posts" };
  return { title: "글 후보를 새로 만드세요", desc: "현재 바로 작성할 대기 후보가 없습니다. 조건을 확인하고 후보를 다시 생성하세요.", cta: "후보 만들기", mode: "basic", focus: "slot-create" };
}

// 글 공통 설정 탭: 공통 작성 원칙 + 제외어 + 키워드 마스터. 지역 축은 「원천 데이터」 탭에서 관리한다.
function Principles({ domain, busy, onSave, onRefresh }: { domain: DomainConfig; busy: boolean; onSave: (f: Record<string, unknown>) => Promise<void>; onRefresh: () => Promise<void> }) {
  const [brief, setBrief] = useState(domain.common_principles ?? domain.content_brief ?? "");
  const [excludedKeywords, setExcludedKeywords] = useState(domain.excluded_keywords ?? "");
  const [monitoredPhrases, setMonitoredPhrases] = useState(domain.monitored_phrases ?? "");
  async function save() {
    await onSave({ common_principles: brief.trim(), excluded_keywords: excludedKeywords.trim(), monitored_phrases: monitoredPhrases.trim() });
    await onRefresh();
  }
  return <div className="card card-pad grid" data-tour="plan-brief">
    <h2>공통 작성 원칙</h2>
    <p className="muted" style={{ margin: "-8px 0" }}>모든 글 유형에 공통 적용되는 <b>말투·태도</b>, 제외어, 그리고 <b>키워드 마스터</b>(아래 표)입니다. 글 유형별 방향성·축·키워드 선택은 「글유형/디자인」 탭의 커스텀 글유형에서 관리합니다(빌트인 글유형은 복제해 커스텀으로 조정).</p>
    <Field label="공통 작성 원칙 (모든 글 유형 공통)"><textarea className="textarea" rows={7} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="처음 준비하는 독자도 이해할 수 있는 쉬운 표현을 쓰되, 신뢰감 있는 전문가의 설명 톤을 유지한다.&#10;광고성·낚시성 문구와 근거 없는 과장 표현을 쓰지 않는다.&#10;경쟁 브랜드나 특정 업체를 비방하지 않고 균형 있게 설명한다." /><p className="muted small"><b>이 사이트만의 말투·태도</b>를 적는 칸입니다. 확인된 데이터만 사용·가격/합격률 날조 금지·후보 수 부풀리기 금지 같은 <b>안전·데이터 규칙은 이미 생성 프롬프트와 품질 게이트가 강제</b>하므로 여기에 다시 적지 않아도 됩니다. 오히려 중복해서 채우면 이 칸에서만 전달되는 말투 지시가 묻힙니다. 비워 두면 기본 원칙이 적용됩니다.</p></Field>
    <Field label="생성 제외 키워드/문구"><textarea className="textarea" rows={4} value={excludedKeywords} onChange={(e) => setExcludedKeywords(e.target.value)} placeholder={"실내운전연습장\n실내운전연습장 추천\n대성자동차학원 찾기 전 볼 인근 후보"} /><p className="muted small">한 줄에 하나씩 입력하면 후보 생성, 후보 검색, 작성 큐, 최종 저장 전에 제외됩니다.</p></Field>
    <Field label="반복 감시 문구 (중복 방지)"><textarea className="textarea" rows={4} value={monitoredPhrases} onChange={(e) => setMonitoredPhrases(e.target.value)} placeholder={"후기 요약에서는 친절한 상담과 꼼꼼한 설명이 확인됩니다\n정리하면 선택 기준은 단순합니다"} /><p className="muted small">여러 글에서 똑같이 반복되는 판박이 문장을 한 줄에 하나씩 입력하면, 생성 품질 게이트가 이 문구를 감지해 다른 표현으로 다시 쓰도록(중복 콘텐츠 방지) 합니다. 제외어와 달리 글을 건너뛰지 않고 재작성합니다.</p></Field>
    <div className="row"><button className="btn primary" onClick={save} disabled={busy}>{busy ? "저장 중..." : "저장"}</button></div>
  </div>;
}

// 키워드 마스터: 글유형이 고르는 키워드 풀 + SEO 메트릭(월검색량·경쟁도). 슬롯 우선순위 소스라 표로 편집한다.
type KwRow = { value: string; weight: string; msv: string; kd: string };
const toKwRow = (r: AxisValue): KwRow => ({ value: String(r.value ?? ""), weight: r.weight == null ? "" : String(r.weight), msv: r.monthly_search_volume == null ? "" : String(r.monthly_search_volume), kd: r.competition_kd == null ? "" : String(r.competition_kd) });
function KeywordMaster({ domain, presetKey, keywordAxis, onRefresh }: { domain: string; presetKey: string; keywordAxis: AxisValue[]; onRefresh: () => Promise<void> }) {
  const [rows, setRows] = useState<KwRow[]>(() => keywordAxis.map(toKwRow));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { setRows(keywordAxis.map(toKwRow)); }, [keywordAxis]); // 저장·새로고침 후 서버 값과 재동기화
  const set = (i: number, k: keyof KwRow, v: string) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  async function save() {
    setBusy(true); setErr("");
    try {
      const values: AxisValue[] = rows.map((r) => ({ value: r.value.trim(), weight: Number(r.weight || 3), monthly_search_volume: r.msv.trim() === "" ? null : Number(r.msv), competition_kd: r.kd.trim() === "" ? null : Number(r.kd) })).filter((v) => v.value);
      await replaceAxis(domain, "keyword", values);
      await onRefresh();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  // 키워드 축만 프리셋 기본값(18개+메트릭)으로 초기화. region 등 다른 축은 안 건드림(axes 필터).
  async function reset() {
    if (!confirm("키워드 마스터를 기본값(운전 프리셋 18개)으로 초기화할까요? 지금 표의 키워드·직접 추가한 값이 덮어써집니다.")) return;
    setBusy(true); setErr("");
    try {
      await api(`/domains/${encodeURIComponent(domain)}/axes/preset`, { method: "POST", body: JSON.stringify({ preset_key: presetKey, axes: ["keyword"] }) });
      await onRefresh();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return <div className="card card-pad grid" style={{ marginTop: 16 }}>
    <div className="spread"><div><h2>키워드 마스터</h2><p className="muted small">글유형이 고르는 키워드 풀 + SEO 메트릭입니다. 월검색량·경쟁도(KD)는 슬롯 우선순위에 쓰입니다. 직접 편집하거나 「기본값으로 초기화」로 운전 프리셋 18개를 채웁니다.</p></div><span className="badge info">{rows.length}개</span></div>
    <p className="uploaded-notice" style={{ padding: "8px 12px", margin: "-8px 0" }}>⚠️ <b>월검색량·경쟁도(KD)</b>는 실측이 아닌 초기 추정 시드값입니다. 슬롯 생성 <b>우선순위</b> 계산에만 쓰이며, 글의 내용·품질·길이는 바꾸지 않습니다. 추후 <b>네이버 검색광고 API</b> 연동 시 실측값으로 자동 갱신될 예정입니다. (<b>가중치</b>는 검색 데이터가 아닌 운영 우선순위 값으로, 수기 관리 항목입니다.)</p>
    <div className="table-wrap"><table>
      <thead><tr><th>키워드</th><th style={{ width: 100 }}>가중치</th><th style={{ width: 120 }}>월검색량</th><th style={{ width: 110 }}>경쟁도(KD)</th><th style={{ width: 72 }}></th></tr></thead>
      <tbody>
        {rows.map((r, i) => <tr key={i}>
          <td><input className="input" value={r.value} onChange={(e) => set(i, "value", e.target.value)} placeholder="운전면허학원" /></td>
          <td><input className="input" value={r.weight} onChange={(e) => set(i, "weight", e.target.value)} inputMode="numeric" placeholder="3" /></td>
          <td><input className="input" value={r.msv} onChange={(e) => set(i, "msv", e.target.value)} inputMode="numeric" placeholder="-" /></td>
          <td><input className="input" value={r.kd} onChange={(e) => set(i, "kd", e.target.value)} inputMode="numeric" placeholder="-" /></td>
          <td><button type="button" className="btn danger" style={{ whiteSpace: "nowrap" }} onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}>삭제</button></td>
        </tr>)}
        {!rows.length && <tr><td colSpan={5} className="muted small">키워드가 없습니다. 「행 추가」 또는 「기본값으로 초기화」로 채우세요.</td></tr>}
      </tbody>
    </table></div>
    {err && <p className="toast-warn small">{err}</p>}
    <div className="row"><button type="button" className="btn" onClick={() => setRows((prev) => [...prev, { value: "", weight: "", msv: "", kd: "" }])}>+ 행 추가</button><button type="button" className="btn primary" onClick={save} disabled={busy}>{busy ? "저장 중..." : "키워드 저장"}</button><button type="button" className="btn" style={{ marginLeft: "auto" }} onClick={reset} disabled={busy} title="키워드 마스터를 운전 프리셋 기본값(18개+메트릭)으로 되돌립니다">기본값으로 초기화</button></div>
  </div>;
}

// 도메인 디자인 설정의 특수값: 글마다 후보의 글 유형 기본 디자인(default_design)을 자동 적용한다.
const AUTO_DESIGN_ID = "auto";

// 전역 빌트인 노출 제어(검증용 임시): 노출 허용 목록에 없는 빌트인 id 는 카탈로그/커스텀 시작점/아키타입 목록에서 숨긴다.
// exposed_builtin_template_ids 가 null/undefined 면 전체 노출. 이미 켠 유형의 생성엔 영향 없음(비파괴).
const builtinExposed = (options: AdminOptions, id: string): boolean => {
  const list = options.exposed_builtin_template_ids;
  return !Array.isArray(list) || list.includes(id);
};

function Templates({ domain, options, customTemplates, keywordPool, busy, onSave, onRefresh }: { domain: DomainConfig; options: AdminOptions; customTemplates: CustomTemplate[]; keywordPool: string[]; busy: boolean; onSave: (f: Record<string, unknown>) => Promise<void>; onRefresh: () => Promise<void> }) {
  const [enabled, setEnabled] = useState(new Set(domain.templates_enabled));
  const [custom, setCustom] = useState(domain.custom_design_templates ?? "");
  // 즉시 저장 모델: 토글하면 바로 저장·refresh. refresh 로 갱신된 domain.templates_enabled 에 로컬 상태를 동기화.
  useEffect(() => { setEnabled(new Set(domain.templates_enabled)); }, [domain.templates_enabled]);
  const allDesignTemplates: DesignTemplateOption[] = options.design_templates;
  const designNameOf = (id?: string) => allDesignTemplates.find((d) => d.id === id)?.name ?? id ?? "local-guide";
  // ①에서 빌트인+커스텀 on/off 를 즉시 저장으로 제어(커스텀 매니저의 켜기/끄기 대체).
  const toggle = async (id: string) => {
    const next = new Set(enabled);
    next.has(id) ? next.delete(id) : next.add(id);
    setEnabled(next);
    await onSave({ templates_enabled: Array.from(next).sort() });
  };
  // 전체 디자인 강제 제거 — design_template_id 는 항상 auto(글유형별 자동 매칭)로 정규화.
  const saveDesign = () => onSave({ design_template_id: AUTO_DESIGN_ID, custom_design_templates: custom.trim() });
  // 빌트인(코드) + 커스텀(DB)을 하나의 글 유형 목록으로 병합.
  type TypeItem = { id: string; name: string; isCustom: boolean; spec?: TemplateSpec; custom?: CustomTemplate };
  const allItems: TypeItem[] = [
    ...Object.entries(options.template_specs).map(([id, spec]) => ({ id, name: spec.name, isCustom: false, spec })),
    ...customTemplates.map((t) => ({ id: t.template_id, name: t.name, isCustom: true, custom: t })),
  ];
  const activeItems = allItems.filter((it) => enabled.has(it.id));
  const availableItems = allItems.filter((it) => !enabled.has(it.id));
  const availableBuiltins = availableItems.filter((it) => !it.isCustom && builtinExposed(options, it.id));
  const availableCustoms = availableItems.filter((it) => it.isCustom);
  const specBadges = (spec: TemplateSpec) => <div className="row">{spec.primary.map((axis) => <span key={axis} className="badge">{axis}</span>)}{spec.use_persona && <span className="badge">persona</span>}{spec.with_intent && <span className="badge">intent</span>}{spec.modifier_count > 0 && <span className="badge">modifier {spec.modifier_count}</span>}<span className="badge info">디자인 {designNameOf(spec.default_design)}</span>{spec.title_rule?.tiers?.length ? <span className="badge" title="제목을 후보 수 규칙으로 확정">제목규칙 {spec.title_rule.tiers.length}tier</span> : null}</div>;
  const customBadges = (t: CustomTemplate) => <div className="row"><span className="badge">아키타입 {t.kind}</span>{t.use_persona ? <span className="badge">persona</span> : null}{t.with_intent ? <span className="badge">intent</span> : null}{t.modifier_count > 0 ? <span className="badge">modifier {t.modifier_count}</span> : null}<span className="badge info">디자인 {designNameOf(t.default_design)}</span>{t.title_rule?.tiers?.length ? <span className="badge" title="제목을 후보 수 규칙으로 확정">제목규칙 {t.title_rule.tiers.length}tier</span> : null}</div>;
  // 빌트인은 뱃지만 표시(예전 텍스트 메타 줄은 뱃지와 중복이라 제거). 커스텀은 아키타입 뱃지 포함.
  const itemBody = (it: TypeItem) => it.isCustom ? customBadges(it.custom!) : specBadges(it.spec!);
  const cardOf = (it: TypeItem, mode: "active" | "add") => mode === "active"
    ? <div key={it.id} className="option-card active"><div className="spread"><b><span className="badge">{it.id}</span> {it.name}</b><button type="button" className="btn ghost" style={{ padding: "2px 8px" }} disabled={busy} onClick={() => toggle(it.id)}>제거</button></div><div className="card-divider" />{itemBody(it)}</div>
    : <button key={it.id} type="button" className="option-card" disabled={busy} onClick={() => toggle(it.id)}><div className="spread"><b><span className="badge">{it.id}</span> {it.name}</b><span className="badge success">+ 추가</span></div><div className="card-divider" />{itemBody(it)}</button>;
  // 빌트인/커스텀을 소제목으로 나눠 렌더(비어있는 그룹은 생략).
  const cardGroup = (items: TypeItem[], mode: "active" | "add") => {
    const bi = items.filter((it) => !it.isCustom), cu = items.filter((it) => it.isCustom);
    return <>
      {bi.length > 0 && <div className="grid" style={{ gap: 8 }}><span className="muted small" style={{ fontWeight: 600 }}>빌트인 ({bi.length})</span><div className="grid grid-2">{bi.map((it) => cardOf(it, mode))}</div></div>}
      {cu.length > 0 && <div className="grid" style={{ gap: 8, marginTop: bi.length > 0 ? 10 : 0 }}><span className="muted small" style={{ fontWeight: 600 }}>커스텀 ({cu.length})</span><div className="grid grid-2">{cu.map((it) => cardOf(it, mode))}</div></div>}
    </>;
  };
  return <div className="grid">
    <section className="card card-pad grid" data-tour="templates-types">
      <div className="spread"><div><h2>이 도메인의 글 유형</h2><p className="muted">이 도메인에서 쓸 글 유형을 켜고 끕니다(빌트인·커스텀 함께, 즉시 저장). 커스텀 유형은 맨 아래에서 만들고 여기서 켜세요.</p></div><span className="badge info">{enabled.size}개 사용 중</span></div>
      {activeItems.length === 0
        ? <p className="muted small">담긴 글 유형이 없습니다. 아래 카탈로그에서 필요한 유형을 추가하세요.</p>
        : cardGroup(activeItems, "active")}
      <details className="template-subsection">
        <summary className="template-subsection-summary"><div className="template-subsection-head"><div><h3>빌트인 추가</h3><p className="muted small">아직 안 켠 빌트인 글 유형입니다(코드 소유·초기화에도 복구).</p></div><span className="badge info">{availableBuiltins.length}개</span></div></summary>
        {availableBuiltins.length === 0
          ? <p className="muted small">모든 빌트인 글 유형이 이미 담겨 있습니다.</p>
          : <div className="grid grid-2">{availableBuiltins.map((it) => cardOf(it, "add"))}</div>}
      </details>
      <details className="template-subsection">
        <summary className="template-subsection-summary"><div className="template-subsection-head"><div><h3>커스텀 추가</h3><p className="muted small">아직 안 켠 커스텀 글 유형입니다. 맨 아래에서 만들 수 있어요.</p></div><span className="badge info">{availableCustoms.length}개</span></div></summary>
        {availableCustoms.length === 0
          ? <p className="muted small">추가할 커스텀 글 유형이 없습니다. 맨 아래에서 만들어 보세요.</p>
          : <div className="grid grid-2">{availableCustoms.map((it) => cardOf(it, "add"))}</div>}
      </details>
    </section>

    <CustomTemplatesManager domainConfig={domain} options={options} keywordPool={keywordPool} onSave={onSave} onRefresh={onRefresh} />
    <section className="grid">
      <div className="card card-pad grid template-config-card" data-tour="templates-design" style={{ gap: 12 }}>
        <div><h2>디자인</h2><p className="muted">글 유형마다 기본 디자인이 자동으로 적용됩니다(대부분 그대로 두면 됩니다). 특정 글에 다른 디자인을 쓰려면 위 「커스텀 글유형」에서 그 유형을 복제해 디자인을 바꾸세요.</p></div>
        <div className="template-subsection-head" style={{ borderBottom: "none", paddingBottom: 0 }}><div><h3>디자인 종류</h3><p className="muted small">각 디자인이 어떤 화면인지 보여주는 참고용 목록입니다.</p></div></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>디자인</th><th>요약</th><th>추천 상황</th></tr></thead>
            <tbody>{allDesignTemplates.map((tpl) => <tr key={tpl.id}>
              <td><b>{tpl.name}</b> <span className="muted small mono">{tpl.id}</span></td>
              <td className="muted small">{tpl.summary}</td>
              <td className="small">{tpl.best_for}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className="template-subsection-head" style={{ borderBottom: "none", paddingBottom: 0, marginTop: 20 }}><div><h3>커스텀 디자인 메모 (선택)</h3><p className="muted small">기본 디자인 밖의 레이아웃이 필요할 때만. 원하는 구조를 적고, 커스텀 글유형에서 디자인을 ‘커스텀’으로 지정하면 이 메모가 작성 프롬프트로 들어갑니다.</p></div></div>
        <textarea className="textarea" rows={7} value={custom} onChange={(e) => setCustom(e.target.value)} placeholder={`첫 화면에는 큰 제목과 핵심 요약 3개를 둔다.
비교표는 본문 상단에 배치한다.
CTA는 중간 1회, 마지막 1회만 사용한다.
모바일에서는 카드형 목록으로 보이게 한다.`} />
        <div className="row"><button className="btn primary" disabled={busy} onClick={saveDesign}>{busy ? "저장 중..." : "커스텀 디자인 저장"}</button><span className="muted small">저장 후 새 글부터 적용됩니다.</span></div>
      </div>
    </section>
  </div>;
}

// 커스텀 글유형 관리: 목록 + 정합성 미리보기 + 생성/복제/편집/삭제. on/off 는 상단 '이 도메인의 글 유형'에서.
function CustomTemplatesManager({ domainConfig, options, keywordPool, onSave, onRefresh }: { domainConfig: DomainConfig; options: AdminOptions; keywordPool: string[]; onSave: (f: Record<string, unknown>) => Promise<void>; onRefresh: () => Promise<void> }) {
  const domain = domainConfig.domain;
  const [custom, setCustom] = useState<CustomTemplate[]>([]);
  const [coherence, setCoherence] = useState<Record<string, CoherenceTemplate>>({});
  const [academyTypeCounts, setAcademyTypeCounts] = useState<Array<{ value: string; count: number }>>([]);
  const [loading, setLoading] = useState(true);
  // 학원 타입 체크박스: 정식 5종(options.academy_types) 전부 노출 + 동기화 데이터 집계 카운트 병합.
  const academyTypeOptions = useMemo(() => {
    const counts = new Map(academyTypeCounts.map((t) => [t.value, t.count]));
    return (options.academy_types ?? academyTypeCounts.map((t) => t.value)).map((v) => ({ value: v, count: counts.get(v) ?? 0 }));
  }, [options.academy_types, academyTypeCounts]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [coverageFor, setCoverageFor] = useState<string | null>(null); // 학원 커버리지 팝업 대상 template_id

  const designChoices = useMemo(() => [...options.design_templates], [options.design_templates]);
  const designNameOf = (id?: string) => designChoices.find((d) => d.id === id)?.name ?? id ?? "local-guide";
  const kindOptions = useMemo(() => {
    const map = new Map<string, { label: string; primary: string }>();
    // 노출 허용된 빌트인만으로 아키타입 목록을 파생(숨긴 유형의 아키타입은 커스텀 참조에서도 제외).
    for (const [id, spec] of Object.entries(options.template_specs)) {
      if (!builtinExposed(options, id)) continue;
      const k = spec.kind ?? "";
      if (k && !map.has(k)) map.set(k, { label: `${k} — ${spec.name} 계열`, primary: spec.primary?.[0] ?? "keyword" });
    }
    return [...map.entries()].map(([kind, v]) => ({ kind, label: v.label, primary: v.primary }));
  }, [options]);
  const primaryOfKind = (kind: string) => kindOptions.find((o) => o.kind === kind)?.primary ?? "keyword";
  // 커스텀 만들기 '시작점' 옵션: 빌트인 + 기존 커스텀. 고르면 폼에 값을 채워 시작(복제 통합).
  const createSources: TemplateSource[] = useMemo(() => [
    ...Object.entries(options.template_specs).filter(([id]) => builtinExposed(options, id)).map(([id, spec]) => ({
      id, label: `${id} ${spec.name} (빌트인)`, name: spec.name, kind: spec.kind ?? "",
      use_persona: spec.use_persona, with_intent: Boolean(spec.with_intent), modifier_count: spec.modifier_count,
      default_design: spec.default_design ?? "local-guide", default_direction: spec.default_direction ?? "", axis_values: spec.axis_values, academy_types: spec.academy_types, keyword_filter: spec.keyword_filter, primary_override: spec.primary_override, title_rule: spec.title_rule,
    })),
    ...custom.map((t) => ({
      id: t.template_id, label: `${t.template_id} ${t.name} (커스텀)`, name: t.name, kind: t.kind,
      use_persona: t.use_persona, with_intent: t.with_intent, modifier_count: t.modifier_count,
      default_design: t.default_design ?? "local-guide", default_direction: t.default_direction ?? "", axis_values: t.axis_values, academy_types: t.academy_types, keyword_filter: t.keyword_filter, primary_override: t.primary_override, title_rule: t.title_rule,
    })),
  ], [options, custom]);

  async function reload() {
    setLoading(true); setError("");
    try {
      const [tpl, coh, aca] = await Promise.all([listTemplates(domain), getCoherence(domain), listAcademies(domain, { limit: 1 })]);
      setCustom(tpl.custom ?? []);
      setCoherence(Object.fromEntries((coh.templates ?? []).map((t) => [t.template_id, t])));
      setAcademyTypeCounts(aca.academy_types ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void reload(); }, [domain]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setError("");
    // 생성/편집/삭제 후 상단 목록(①)도 갱신되도록 onRefresh 로 도메인 페이로드를 다시 불러온다.
    try { await fn(); await reload(); await onRefresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return <section className="card card-pad grid">
    <div className="spread">
      <div><h2>커스텀 글유형</h2><p className="muted">검증된 아키타입을 참조해 직접 만든 글유형입니다. 주키워드 규칙·품질 지침은 참조 아키타입을 그대로 씁니다. 만든 뒤 위 「이 도메인의 글 유형」에서 켜야 생성에 쓰입니다.</p><p className="muted small">「새로고침」은 목록·정합성 미리보기·학원 타입 옵션을 서버에서 다시 불러옵니다. 이 화면에서 만들기/편집/삭제한 뒤엔 자동 갱신되며, 다른 창·다른 사람이 바꾼 경우에만 수동으로 누르면 됩니다.</p></div>
      <div className="row" style={{ flexShrink: 0, whiteSpace: "nowrap" }}><span className="badge info">{custom.length}개</span><button type="button" className="btn" style={{ whiteSpace: "nowrap" }} disabled={loading || busy} onClick={() => void reload()} title="목록·정합성 미리보기·학원 타입 옵션을 서버에서 다시 불러옵니다">{loading ? "..." : "새로고침"}</button></div>
    </div>
    {/* 아키타입 개념·주축·종류 설명(하드코딩). 원본 정의는 apps/api-nest/src/archetypes.ts 의 ARCHETYPES. 지침 변경 시 여기 문구도 함께 갱신할 것. */}
    <details className="template-subsection">
      <summary className="template-subsection-summary"><div className="template-subsection-head"><div><h3 style={{ margin: 0 }}>아키타입이란? · 주축과 종류 설명</h3><p className="muted small">글유형이 참조하는 &apos;동작 원형&apos;입니다. 자세한 설명을 펼쳐 보세요.</p></div><span className="badge info toggle-badge" /></div></summary>
      <div className="grid" style={{ gap: 10, marginTop: 8 }}>
        <p className="toast-info small"><b>아키타입</b>은 글의 검증된 &apos;동작 원형&apos;입니다 — 주축(지역/키워드)·주키워드 생성 규칙·작성 지침·품질 규칙을 정해 둔 틀이에요. 커스텀 글유형은 이 중 하나를 <b>골라 참조</b>하고, 키워드·페르소나·디자인·방향성 같은 세부만 조정합니다(주키워드 규칙·품질 지침은 아키타입 그대로).<br /><b>주축</b>(아키타입이 결정, 변경 불가) — <b>지역형</b>: 지역(강남·수원 등)을 기준으로 &quot;지역 + 운전면허학원&quot;처럼 주키워드를 만들어 지역별 학원을 비교·소개. <b>키워드형</b>: 키워드 자체를 주제로 삼는 정보형(가이드·시험·비용 등).</p>
        <ul className="muted small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
          <li><b>지역형 · local</b> (지역 학원 비교) — 특정 지역 학원 여러 곳을 사진·비교표로 비교·소개(학원 2곳 이상 필요).</li>
          <li><b>지역형 · local_single</b> (지역 시설 단독 소개) — 그 지역 학원·시험장 1곳을 단독으로 심층 소개(비교 아님, 1곳이면 성립).</li>
          <li><b>지역형 · local_hub</b> (지역 허브 총정리) — 지역의 학원·시험장·접수·비용·준비물을 넓게 연결하는 관문형(지역 전반).</li>
          <li><b>키워드형 · guide</b> (가이드 총정리) — 준비 순서 → 비용 → 시험 단계 → 선택 기준을 한 번에 총정리.</li>
          <li><b>키워드형 · compare</b> (선택지·비용 비교) — 면허 종류·옵션·비용안을 표로 비교해 고르도록 도움.</li>
          <li><b>키워드형 · exam</b> (시험 단계 공략) — 필기/기능/도로주행 한 단계를 집중 공략(자주 틀리는 점·체크리스트).</li>
        </ul>
      </div>
    </details>
    {error && <p className="toast-warn">{error}</p>}

    <CustomTemplateForm mode="create" domain={domain} kindOptions={kindOptions} designChoices={designChoices} sources={createSources} academyTypeOptions={academyTypeOptions} keywordPool={keywordPool} structureVariants={options.archetype_structure_variants} brandColor={domainConfig.brand_color} brand={publicBrandName(domainConfig)} busy={busy}
      onSubmit={(body) => run(() => createTemplate(domain, body))}
      onClone={(sourceId, name, overrides) => run(() => cloneTemplate(domain, { source_template_id: sourceId, name, overrides }))} />

    {loading ? <p className="muted small">불러오는 중...</p> : custom.length === 0
      ? <p className="muted small">아직 커스텀 글유형이 없습니다. 위에서 만들거나 복제해 보세요.</p>
      : <div className="grid">{custom.map((t) => {
        const coh = coherence[t.template_id];
        if (editId === t.template_id) return <CustomTemplateForm key={t.template_id} mode="edit" domain={domain} initial={t} kindOptions={kindOptions} designChoices={designChoices} academyTypeOptions={academyTypeOptions} keywordPool={keywordPool} structureVariants={options.archetype_structure_variants} brandColor={domainConfig.brand_color} brand={publicBrandName(domainConfig)} busy={busy}
          onCancel={() => setEditId(null)}
          onSubmit={(body) => run(() => updateTemplate(domain, t.template_id, body)).then(() => setEditId(null))} />;
        return <div key={t.template_id} className="info-panel grid">
          <div className="spread">
            <b><span className="badge">{t.template_id}</span> {t.name}</b>
            <div className="row">
              <span className="badge info">아키타입 {t.kind}</span>
              <button type="button" className="btn" disabled={busy} onClick={() => setEditId(t.template_id)}>편집</button>
              <button type="button" className="btn danger" disabled={busy} onClick={() => {
                if (!confirm(`커스텀 글유형 '${t.name}'을 삭제할까요? 이미 생성된 글에는 영향이 없습니다.`)) return;
                const next = new Set(domainConfig.templates_enabled); next.delete(t.template_id);
                void run(async () => {
                  await deleteTemplate(domain, t.template_id);
                  if (domainConfig.templates_enabled.includes(t.template_id)) await onSave({ templates_enabled: Array.from(next).sort() });
                });
              }}>삭제</button>
            </div>
          </div>
          <div className="row">
            <span className="badge">주축 {primaryOfKind(t.kind) === "region" ? "지역형" : "키워드형"}</span>
            {t.use_persona && <span className="badge">persona</span>}
            {t.with_intent && <span className="badge">intent</span>}
            {t.modifier_count > 0 && <span className="badge">modifier {t.modifier_count}</span>}
            <span className="badge">weight {t.weight}</span>
            <span className="badge info">디자인 {designNameOf(t.default_design)}</span>
            {t.title_rule?.tiers?.length ? <span className="badge">제목규칙 {t.title_rule.tiers.length}tier</span> : null}
          </div>
          {t.default_direction && <p className="muted small">방향성: {t.default_direction}</p>}
          {t.title_rule?.tiers?.length ? <p className="muted small">제목: {t.title_rule.tiers.map((tr) => `${tr.min_count}곳↑ "${tr.template}"`).join(" · ")}{t.title_rule.min_generate ? ` · 최소 ${t.title_rule.min_generate}곳` : ""}</p> : null}
          {coh && <>
            <p className="small"><b>예상 후보 상한:</b> {coh.estimated_slot_upperbound.toLocaleString()}</p>
            {coh.academy?.applicable && <p className="small"><b>학원 커버리지</b> (총 {coh.academy.regions_total}개 지역): 충분 {coh.academy.regions_with_min_for_best} · 보장 {coh.academy.regions_guaranteed} · <span style={{ color: (coh.academy.regions_short ?? 0) > 0 ? "var(--danger)" : undefined }}>부족 {coh.academy.regions_short}</span> <span className="muted">(직접+인근 20km / 보장 {coh.academy.min_guarantee_km}km)</span><button type="button" className="btn" style={{ marginLeft: 8, padding: "1px 8px", fontSize: 12 }} onClick={() => setCoverageFor(t.template_id)}>지역별 자세히</button></p>}
            {coh.warnings.length > 0 && <div className="grid">{coh.warnings.map((w, i) => <p key={i} className={w.level === "error" ? "toast-warn" : "muted small"}>{w.level === "error" ? "⚠️ " : "• "}{w.message}</p>)}</div>}
          </>}
        </div>;
      })}</div>}
    {coverageFor && <AcademyCoverageModal domain={domain} templateId={coverageFor} onClose={() => setCoverageFor(null)} />}
  </section>;
}

// 지역별 학원 커버리지 팝업(L1 지역 표 + L2 학원별 빠진 데이터). 직접(지역 문자열) + 인근(반경) 기준 = 생성과 동일.
function AcademyCoverageModal({ domain, templateId, onClose }: { domain: string; templateId: string; onClose: () => void }) {
  const [data, setData] = useState<AcademyCoverage | null>(null);
  const [err, setErr] = useState("");
  const [openRegion, setOpenRegion] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    getAcademyCoverage(domain, templateId).then((d) => { if (!cancelled) setData(d); }).catch((e) => { if (!cancelled) setErr(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [domain, templateId]);
  return <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
    <div onClick={(e) => e.stopPropagation()} className="card card-pad grid" style={{ maxWidth: 680, width: "100%", maxHeight: "85vh", overflowY: "auto" }}>
      <div className="spread"><b>지역별 학원 커버리지{data ? ` · ${data.name}` : ""}</b><button type="button" className="btn" onClick={onClose}>닫기</button></div>
      {err && <p className="toast-warn small">{err}</p>}
      {!data && !err && <p className="muted small">불러오는 중...</p>}
      {data && !data.applicable && <p className="muted small">이 글유형은 학원 근거형이 아니거나 학원 타입이 선택되지 않아 커버리지 정보가 없습니다.</p>}
      {data && data.applicable && <>
        <p className="muted small">학원 타입: {data.academy_types.join(", ")} · 충분 기준 <b>{data.threshold}곳 이상</b>. 상태: <b>충분</b>(직접+인근 {data.nearby_km}km로 {data.threshold}곳) <b>{data.regions_with_min_for_best}</b> · <b>보장</b>({data.min_guarantee_km}km 인근 보강으로 {data.threshold}곳) <b>{data.regions_guaranteed}</b> · <b>부족</b>({data.min_guarantee_km}km 안에도 미달) <b>{data.regions_short}</b> / {data.regions_total}. 후보 풀 지역별 최대 <b>{data.max_candidates}곳</b>, 생성 시 <b>{data.used_per_post}곳</b>을 슬롯별 랜덤 사용.</p>
        <div className="table-wrap"><table>
          <thead><tr><th>지역</th><th style={{ width: 140 }}>학원 수(직접+인근+보장)</th><th style={{ width: 64 }}>상태</th><th style={{ width: 64 }}></th></tr></thead>
          <tbody>{data.regions.map((r) => <Fragment key={r.region}>
            <tr>
              <td>{r.region}</td>
              <td><b>{r.effective}</b> <span className="muted small">({r.direct}+{r.nearby}+{r.guaranteed})</span></td>
              <td>{r.status === "sufficient" ? <span className="badge success">충분</span> : r.status === "guaranteed" ? <span className="badge info">보장</span> : <span className="badge warn">부족</span>}</td>
              <td>{r.effective > 0 && <button type="button" className="btn" style={{ padding: "1px 8px", fontSize: 12 }} onClick={() => setOpenRegion(openRegion === r.region ? null : r.region)}>{openRegion === r.region ? "접기" : "학원"}</button>}</td>
            </tr>
            {openRegion === r.region && <tr><td colSpan={4}>
              <div className="grid" style={{ gap: 4 }}>
                {r.academies.map((a, i) => <div key={i} className="small">{a.tier === "direct" ? <span className="badge info" style={{ marginRight: 4 }}>직접</span> : a.tier === "nearby" ? <span className="badge" style={{ marginRight: 4 }}>인근 {a.distance_km}km</span> : <span className="badge warn" style={{ marginRight: 4 }}>보장 {a.distance_km}km</span>}<b>{a.name}</b> <span className="muted">{a.academy_type}{a.address ? ` · ${a.address}` : ""}</span> {a.missing.length > 0 ? <span className="toast-warn small" style={{ padding: "0 6px" }}>빠진 데이터: {a.missing.join(", ")}</span> : <span className="badge success">데이터 완비</span>}</div>)}
                {r.truncated && <p className="muted small">…일부만 표시(상위 50곳)</p>}
              </div>
            </td></tr>}
          </Fragment>)}</tbody>
        </table></div>
      </>}
    </div>
  </div>;
}

// 커스텀 만들기 '시작점' 옵션 형태(빌트인/커스텀 공통). 고르면 폼 값을 채운다.
type TemplateSource = { id: string; label: string; name: string; kind: string; use_persona: boolean; with_intent: boolean; modifier_count: number; default_design: string; default_direction: string; axis_values?: { persona?: string[]; intent?: string[]; modifier?: string[] }; academy_types?: string[]; keyword_filter?: string[]; primary_override?: "region" | "keyword"; title_rule?: TitleRule | null };

// 커스텀 글유형 생성/편집 폼. 생성 모드에선 '시작점'을 골라 기존 글유형(빌트인/커스텀) 값을 채워 시작할 수 있다(복제 통합).
// 커스텀 글유형 폼 영역 구분자: "소제목 ──────" 형태로 유사 기능 그룹을 시각적으로 나눈다.

function CustomTemplateForm({ mode, domain, initial, kindOptions, designChoices, sources, academyTypeOptions, keywordPool, structureVariants, brandColor, brand, busy, onSubmit, onClone, onCancel }: {
  mode: "create" | "edit"; domain: string; initial?: CustomTemplate; kindOptions: { kind: string; label: string; primary: string }[]; designChoices: DesignTemplateOption[];
  sources?: TemplateSource[]; academyTypeOptions?: Array<{ value: string; count: number }>; keywordPool?: string[]; structureVariants?: Record<string, string[]>; brandColor?: string | null; brand?: string; busy: boolean;
  onSubmit: (body: Partial<CustomTemplate>) => void; onClone?: (sourceId: string, name: string, overrides: Record<string, unknown>) => void; onCancel?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [kind, setKind] = useState(initial?.kind ?? kindOptions[0]?.kind ?? "");
  const [design, setDesign] = useState(initial?.default_design ?? "local-guide");
  const [usePersona, setUsePersona] = useState(initial?.use_persona ?? false);
  const [withIntent, setWithIntent] = useState(initial?.with_intent ?? false);
  const [modifierCount, setModifierCount] = useState(initial?.modifier_count ?? 0);
  const [direction, setDirection] = useState(initial?.default_direction ?? "");
  const [personaVals, setPersonaVals] = useState((initial?.axis_values?.persona ?? []).join("\n"));
  const [intentVals, setIntentVals] = useState((initial?.axis_values?.intent ?? []).join("\n"));
  const [modifierVals, setModifierVals] = useState((initial?.axis_values?.modifier ?? []).join("\n"));
  const [academyTypes, setAcademyTypes] = useState<Set<string>>(new Set(initial?.academy_types ?? []));
  const [keywordVals, setKeywordVals] = useState((initial?.keyword_filter ?? []).join("\n")); // 선택 키워드(한 줄에 하나). 비면 아키타입 패턴.
  const [primaryOverride, setPrimaryOverride] = useState<string>(initial?.primary_override ?? ""); // ""=아키타입 기본
  // 제목 규칙(생성 시점 해석). tiers 비면 규칙 없음 → LLM 이 H1 결정(하위호환).
  const [titleMinGenerate, setTitleMinGenerate] = useState<string>(initial?.title_rule?.min_generate != null ? String(initial.title_rule.min_generate) : "");
  const [titleTiers, setTitleTiers] = useState<{ min_count: string; template: string }[]>((initial?.title_rule?.tiers ?? []).map((t) => ({ min_count: String(t.min_count), template: t.template })));
  const [titleFallback, setTitleFallback] = useState(initial?.title_rule?.fallback ?? "");
  const [source, setSource] = useState(""); // 시작점(빈값=직접 입력). create 모드 전용.
  const sourceLocked = mode === "edit" || Boolean(source); // 시작점을 고르면 아키타입은 소스로 고정.
  // 학원 타입은 지역형(primary=region) 글유형에서만 효과가 있으므로(키워드형은 지역이 없어 학원 미수집) 그때만 노출한다.
  const isRegionPrimary = (kindOptions.find((o) => o.kind === kind)?.primary ?? "keyword") === "region";
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [dirBusy, setDirBusy] = useState(false);
  const [dirError, setDirError] = useState("");
  const [dirResult, setDirResult] = useState<DirectionValidation | null>(null);
  // 폼 섹션 접기/펼치기. 생성은 핵심(주제·키워드)만 펼치고, 편집은 전체 펼침. 검증 실패 시 해당 섹션 자동 펼침.
  const [openSec, setOpenSec] = useState({ topic: true, write: mode === "edit", design: mode === "edit", title: mode === "edit" });

  // 폼 입력 → TitleRule(정규화는 백엔드가 재수행). tier 없으면 null(규칙 없음).
  function buildTitleRule(): TitleRule | null {
    const tiers = titleTiers
      .map((t) => ({ min_count: Math.trunc(Number(t.min_count)), template: t.template.trim() }))
      .filter((t) => Number.isFinite(t.min_count) && Boolean(t.template));
    if (!tiers.length) return null;
    const rule: TitleRule = { tiers };
    const mg = Math.trunc(Number(titleMinGenerate));
    if (Number.isFinite(mg) && mg > 0) rule.min_generate = mg;
    const fb = titleFallback.trim();
    if (fb) rule.fallback = fb;
    return rule;
  }

  // 입력한 방향성이 절대 원칙·공통원칙·아키타입 작성지침과 중복/충돌하는지 LLM 으로 대조하고, 고유 방향만 남긴 개선안을 제안받는다.
  async function validateDirection() {
    if (!direction.trim()) { setDirError("먼저 검증할 방향성을 입력하세요."); return; }
    setDirBusy(true); setDirError(""); setDirResult(null);
    try {
      const res = await validateTemplateDirection(domain, { kind, name: name.trim(), direction: direction.trim(), current_direction: initial?.default_direction ?? "", has_academy: academyTypes.size > 0 });
      setDirResult(res.validation);
    } catch (e) { setDirError(e instanceof Error ? e.message : String(e)); }
    finally { setDirBusy(false); }
  }

  // 켜 놓은 축(persona/intent/modifier)의 값을 LLM 이 이 글유형(kind/이름/방향성/선택 키워드)에 맞게 제안해 텍스트영역을 채운다.
  // 제안일 뿐이라 사용자가 검토/수정 후 저장(품질 관문=사람). 저장은 하지 않는다.
  async function suggestAxes() {
    const wanted: string[] = [];
    if (usePersona) wanted.push("persona");
    if (withIntent) wanted.push("intent");
    if (modifierCount > 0) wanted.push("modifier");
    if (!wanted.length) { setAiError("먼저 제안받을 축(persona·intent·modifier)을 ‘사용’으로 켜세요."); return; }
    setAiBusy(true); setAiError("");
    try {
      const res = await suggestTemplateAxes(domain, { kind, name: name.trim(), direction: direction.trim(), keywords: parseLines(keywordVals), axes: wanted });
      if (res.suggestions.persona) setPersonaVals(res.suggestions.persona.join("\n"));
      if (res.suggestions.intent) setIntentVals(res.suggestions.intent.join("\n"));
      if (res.suggestions.modifier) setModifierVals(res.suggestions.modifier.join("\n"));
    } catch (e) { setAiError(e instanceof Error ? e.message : String(e)); }
    finally { setAiBusy(false); }
  }

  function selectSource(id: string) {
    const src = sources?.find((s) => s.id === id);
    if (!src) { resetForm(); return; } // 직접 입력(빈 값): 프리필됐던 값까지 모두 지우고 빈 폼으로 되돌린다.
    setSource(id);
    setName(`${src.name} (복사본)`);
    setKind(src.kind);
    setDesign(src.default_design);
    setUsePersona(src.use_persona);
    setWithIntent(src.with_intent);
    setModifierCount(src.modifier_count);
    setDirection(src.default_direction ?? "");
    setPersonaVals((src.axis_values?.persona ?? []).join("\n"));
    setIntentVals((src.axis_values?.intent ?? []).join("\n"));
    setModifierVals((src.axis_values?.modifier ?? []).join("\n"));
    setAcademyTypes(new Set(src.academy_types ?? []));
    setKeywordVals((src.keyword_filter ?? []).join("\n"));
    setPrimaryOverride(src.primary_override ?? "");
    setTitleMinGenerate(src.title_rule?.min_generate != null ? String(src.title_rule.min_generate) : "");
    setTitleTiers((src.title_rule?.tiers ?? []).map((t) => ({ min_count: String(t.min_count), template: t.template })));
    setTitleFallback(src.title_rule?.fallback ?? "");
  }

  // 축 값 수집: 해당 축이 켜졌고 값이 있을 때만 포함. 비우면 도메인 공통 축으로 폴백.
  function collectAxisValues(): { persona?: string[]; intent?: string[]; modifier?: string[] } {
    const out: { persona?: string[]; intent?: string[]; modifier?: string[] } = {};
    if (usePersona) { const v = parseLines(personaVals); if (v.length) out.persona = v; }
    if (withIntent) { const v = parseLines(intentVals); if (v.length) out.intent = v; }
    if (modifierCount > 0) { const v = parseLines(modifierVals); if (v.length) out.modifier = v; }
    return out;
  }
  // 폼을 빈 새 유형 상태로 되돌린다(생성 후 자동 호출 + '초기화' 버튼 수동 호출).
  function resetForm() {
    setName(""); setKind(kindOptions[0]?.kind ?? ""); setDesign("local-guide");
    setUsePersona(false); setWithIntent(false); setModifierCount(0);
    setDirection(""); setSource("");
    setPersonaVals(""); setIntentVals(""); setModifierVals(""); setAcademyTypes(new Set()); setKeywordVals(""); setPrimaryOverride("");
    setTitleMinGenerate(""); setTitleTiers([]); setTitleFallback("");
  }

  function submit() {
    if (!name.trim()) { setOpenSec((s) => ({ ...s, topic: true })); alert("이름을 입력하세요."); return; }
    // 축을 '사용'으로 켰으면 값 입력 필수(빈 채로 저장하면 그 축은 생성에서 무시됨 = 품질 이슈). 폴백 없음.
    // 값이 든 섹션(작성 방향·축)이 접혀 있을 수 있으므로, 검증 실패 시 자동으로 펼쳐 사용자가 바로 고치게 한다.
    const axisMissing = (usePersona && !parseLines(personaVals).length) || (withIntent && !parseLines(intentVals).length) || (modifierCount > 0 && !parseLines(modifierVals).length);
    if (axisMissing) setOpenSec((s) => ({ ...s, write: true }));
    if (usePersona && !parseLines(personaVals).length) { alert("persona 사용을 켰으면 값을 한 줄 이상 입력하세요. (비우려면 사용을 끄세요)"); return; }
    if (withIntent && !parseLines(intentVals).length) { alert("intent 사용을 켰으면 값을 한 줄 이상 입력하세요. (비우려면 사용을 끄세요)"); return; }
    if (modifierCount > 0 && !parseLines(modifierVals).length) { alert("modifier 사용을 켰으면 값을 한 줄 이상 입력하세요. (비우려면 사용을 끄세요)"); return; }
    const axisValues = collectAxisValues();
    // 학원 타입: 지역형 글유형일 때만 반영(비우면 학원정보 미사용). 키워드형은 저장하지 않는다.
    const academyTypesArr = isRegionPrimary ? Array.from(academyTypes) : [];
    // keyword 필터: 비우면 도메인 keyword 풀 전체(부분집합 아님). 항상 폼이 source of truth.
    const keywordFilterArr = parseLines(keywordVals);
    const primaryOverrideVal = primaryOverride === "region" || primaryOverride === "keyword" ? primaryOverride : undefined;
    if (source && onClone) {
      // 시작점에서 실제로 바꾼 값만 오버라이드로 넘긴다. 축 값·학원 타입·키워드 필터는 폼이 source of truth(프리필=소스 값)이라 항상 반영.
      const src = sources?.find((s) => s.id === source);
      // title_rule: 폼이 source of truth(프리필=소스 규칙). 항상 넘겨 소스 상속 위에 폼 값을 덮는다(비우면 null=규칙 제거).
      const overrides: Record<string, unknown> = { axis_values: axisValues, academy_types: academyTypesArr, keyword_filter: keywordFilterArr, primary_override: primaryOverrideVal ?? null, title_rule: buildTitleRule() };
      if (src) {
        if (design !== src.default_design) overrides.default_design = design;
        if (usePersona !== src.use_persona) overrides.use_persona = usePersona;
        if (withIntent !== src.with_intent) overrides.with_intent = withIntent;
        if (modifierCount !== src.modifier_count) overrides.modifier_count = modifierCount;
        if (direction.trim() !== (src.default_direction ?? "").trim()) overrides.default_direction = direction.trim() || null;
      }
      onClone(source, name.trim(), overrides);
      if (mode === "create") resetForm();
      return;
    }
    if (!kind) { alert("참조 아키타입을 선택하세요."); return; }
    onSubmit({ name: name.trim(), kind, default_design: design, use_persona: usePersona, with_intent: withIntent, modifier_count: modifierCount, default_direction: direction.trim() || undefined, axis_values: axisValues, academy_types: academyTypesArr, keyword_filter: keywordFilterArr, primary_override: primaryOverrideVal, title_rule: buildTitleRule() });
    if (mode === "create") resetForm();
  }

  return <div className="info-panel grid">
    <div className="spread"><b>{mode === "create" ? "새 커스텀 글유형" : `편집 · ${initial?.template_id}`}</b>{mode === "edit" && <span className="badge warn">편집 중</span>}</div>
    {mode === "create" && sources && sources.length > 0 && <Field label="시작점">
      <select className="select" value={source} onChange={(e) => selectSource(e.target.value)}>
        <option value="">직접 입력 (빈 폼에서 시작)</option>
        {sources.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
      <p className="muted small">{source ? "선택한 글유형의 값을 채웠습니다. 필요한 부분만 고치면 됩니다. weight·축 태그·기존 설정은 그대로 복제되고, 아키타입은 소스로 고정됩니다." : "빈 폼으로 직접 만들거나, 기존 글유형(빌트인/커스텀)을 골라 값을 채워 시작할 수 있습니다."}</p>
    </Field>}
    <details className="template-subsection" open={openSec.topic} onToggle={(e) => { const open = e.currentTarget.open; setOpenSec((s) => ({ ...s, topic: open })); }}>
      <summary className="template-subsection-summary"><div className="template-subsection-head"><div><h3>주제 · 키워드</h3><p className="muted small">이름 · 참조 아키타입 · 키워드 선택</p></div><span className="badge info">{openSec.topic ? "접기" : "열기"}</span></div></summary>
      <div className="grid" style={{ marginTop: 8 }}>
    <div className="grid grid-2">
      <Field label="글 유형 이름"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 심야 학원 특집" /></Field>
      <Field label="참조 아키타입 (kind)">
        <select className="select" value={kind} onChange={(e) => setKind(e.target.value)} disabled={sourceLocked}>
          {kindOptions.map((o) => <option key={o.kind} value={o.kind}>{o.label}</option>)}
        </select>
        <p className="muted small">주축 <b>{(kindOptions.find((o) => o.kind === kind)?.primary ?? "keyword") === "region" ? "지역형(지역+키워드)" : "키워드형"}</b>{source ? " · 시작점을 고르면 소스의 아키타입으로 고정됩니다." : ""}</p>
        {structureVariants?.[kind]?.length ? (
          <p className="muted small">📐 섹션 순서 자동 다양화 (글마다 자동 선택 · 편집 불가): {structureVariants[kind]!.map((l, i) => <span key={i} className="badge" style={{ marginRight: 4 }}>{l}</span>)}</p>
        ) : null}
      </Field>
    </div>
    <div className="grid" style={{ gap: 8 }}>
      <div><b className="small">키워드 선택 (선택)</b><p className="muted small">이 글유형이 쓸 키워드를 한 줄에 하나씩 적습니다. <b>적으면 그 키워드를 그대로 사용</b>(아키타입 패턴 무시), <b>비우면 아키타입 패턴</b>으로 자동 선택. 아래 <b>키워드 마스터</b>에서 클릭하면 추가되고, 마스터에 없는 키워드도 직접 입력할 수 있습니다.</p></div>
      <textarea className="textarea" rows={3} value={keywordVals} onChange={(e) => setKeywordVals(e.target.value)} placeholder={"운전면허학원\n자동차운전전문학원   (한 줄에 하나 · 비우면 아키타입 패턴)"} />
      {(() => {
        const poolSet = new Set(keywordPool ?? []);
        const unknown = parseLines(keywordVals).filter((k) => !poolSet.has(k));
        return unknown.length > 0 ? <p className="toast-warn small">⚠️ 키워드 마스터에 없는 키워드: {unknown.join(", ")} — 지역형 글유형은 영향 없지만, 키워드형은 검색량·경쟁도가 없어 우선순위 0으로 취급돼 대량 선별에서 후순위가 됩니다. 우선순위를 반영하려면 「공통 설정」 탭의 키워드 마스터에 등록하세요.</p> : null;
      })()}
      {(keywordPool ?? []).length > 0 && <div className="row" style={{ flexWrap: "wrap", gap: 4 }}>
        <span className="muted small" style={{ alignSelf: "center" }}>키워드 마스터:</span>
        {(keywordPool ?? []).map((kw) => {
          const has = parseLines(keywordVals).includes(kw);
          return <button key={kw} type="button" className={`btn small ${has ? "primary" : ""}`} style={{ padding: "2px 8px" }}
            onClick={() => setKeywordVals((prev) => { const list = parseLines(prev); return (has ? list.filter((k) => k !== kw) : [...list, kw]).join("\n"); })}>{has ? "✓ " : "+ "}{kw}</button>;
        })}
      </div>}
    </div>
      </div>
    </details>
    <details className="template-subsection" open={openSec.write} onToggle={(e) => { const open = e.currentTarget.open; setOpenSec((s) => ({ ...s, write: open })); }}>
      <summary className="template-subsection-summary"><div className="template-subsection-head"><div><h3>작성 방향 · 축</h3><p className="muted small">방향성 · 축 값(persona·intent·modifier) · 학원 타입</p></div><span className="badge info">{openSec.write ? "접기" : "열기"}</span></div></summary>
      <div className="grid" style={{ marginTop: 8 }}>
    <Field label="방향성 (선택)">
      <textarea className="textarea" rows={2} value={direction} onChange={(e) => setDirection(e.target.value)} placeholder="이 글유형의 기본 방향성" />
      <div className="row" style={{ gap: 8, marginTop: 4 }}>
        <button type="button" className="btn" style={{ whiteSpace: "nowrap" }} disabled={dirBusy || busy || !direction.trim()} onClick={() => void validateDirection()} title="입력한 방향성이 이미 강제되는 절대 원칙·공통원칙·작성 지침과 겹치는지 대조하고, 이 글유형만의 방향만 남긴 개선안을 제안합니다.">{dirBusy ? "검증 중..." : "🔎 방향성 검증"}</button>
      </div>
      <p className="muted small">🔎 <b>방향성 검증</b>: 방향성은 <b>이 글유형만의 방향</b>(무엇을 어떤 각도로 다루고 어떤 전환으로 잇는지)을 적는 자리입니다. 날조 금지·데이터 검증 같은 <b>안전·데이터 규칙은 이미 모든 글에 강제(절대 원칙)</b>되니 방향성에 다시 쓰면 중복입니다. 버튼을 누르면 <b>절대 원칙·공통원칙·아키타입 작성 지침</b>과 대조해 중복/충돌을 짚고, 고유 방향만 남긴 개선안을 제안합니다. (제안일 뿐 자동 저장 안 함 · codex/claude CLI 인증 필요)</p>
      {dirError && <p className="toast-warn small">{dirError}</p>}
      {dirResult && <div className="info-panel grid" style={{ gap: 6, marginTop: 4 }}>
        {dirResult.summary && <p className="small" style={{ margin: 0 }}><b>진단:</b> {dirResult.summary}</p>}
        {dirResult.redundant.length > 0 && <div className="small"><b>중복(이미 강제됨):</b><ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{dirResult.redundant.map((r, i) => <li key={i}>{r.text}{r.overlaps ? <span className="muted"> — {r.overlaps}</span> : null}</li>)}</ul></div>}
        {dirResult.conflicting.length > 0 && <div className="small" style={{ color: "var(--danger)" }}><b>충돌:</b><ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{dirResult.conflicting.map((r, i) => <li key={i}>{r.text}{r.reason ? <span className="muted"> — {r.reason}</span> : null}</li>)}</ul></div>}
        <div className="small"><b>제안 방향성:</b><p className="preview-block" style={{ margin: "4px 0 0" }}>{dirResult.suggested_direction}</p></div>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn primary" disabled={busy} onClick={() => { setDirection(dirResult.suggested_direction); setDirResult(null); }}>제안으로 변경</button>
          <button type="button" className="btn" onClick={() => setDirResult(null)}>닫기</button>
        </div>
      </div>}
    </Field>
    <div className="grid" style={{ gap: 8 }}>
      <div><b className="small">축 구성 · 값 프리셋</b><p className="muted small">이 글유형이 쓸 persona·intent·modifier 값입니다. <b>쓸 축을 켜면 값을 반드시 입력하세요</b> — 이 값이 유일한 소스이고(도메인 공통 축 폴백 없음), 비어 있으면 그 축은 생성에서 무시됩니다. 한 줄에 하나씩.</p></div>
      <div className="card card-pad grid compact-pad" style={{ background: "#f5f3ff", border: "1px solid #e9d5ff" }}>
        <div className="spread" style={{ alignItems: "center", gap: 8 }}>
          <b className="small">🤖 AI 축 값 제안</b>
          <button type="button" className="btn" style={{ flexShrink: 0, whiteSpace: "nowrap" }} disabled={aiBusy || busy} onClick={() => void suggestAxes()} title="켜 놓은 축의 값을 LLM 이 이 글유형(이름·방향성·아키타입)에 맞게 제안해 채웁니다. 제안이므로 검토·수정 후 저장하세요.">{aiBusy ? "제안 중..." : "AI로 축 값 제안"}</button>
        </div>
        <p className="muted small" style={{ margin: 0 }}>먼저 <b>이름·방향성</b>을 채우고 쓸 축(persona·intent·modifier)을 <b>‘사용’으로 켠 뒤</b> 누르면, LLM이 이 글유형에 맞는 값을 제안해 아래 텍스트영역을 채웁니다. <b>제안일 뿐 자동 저장하지 않으니</b> 반드시 검토·수정한 뒤 저장하세요. (codex/claude CLI 인증 필요)</p>
        {aiError && <p className="toast-warn small" style={{ margin: 0 }}>{aiError}</p>}
      </div>
      <div className="info-panel grid" style={{ gap: 6 }}>
        <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={usePersona} onChange={(e) => setUsePersona(e.target.checked)} /> <b>persona</b> 사용 — 누구에게 말할지(독자)</label>
        {usePersona && <textarea className="textarea" rows={3} value={personaVals} onChange={(e) => setPersonaVals(e.target.value)} placeholder={"퇴근 후 배우는 직장인\n주말만 가능한 직장인   (한 줄에 하나씩 · 필수)"} />}
      </div>
      <div className="info-panel grid" style={{ gap: 6 }}>
        <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={withIntent} onChange={(e) => setWithIntent(e.target.checked)} /> <b>intent</b> 사용 — 사용자가 무엇을 알고 싶은지</label>
        {withIntent && <textarea className="textarea" rows={3} value={intentVals} onChange={(e) => setIntentVals(e.target.value)} placeholder={"필기접수\n준비물   (한 줄에 하나씩 · 필수)"} />}
      </div>
      <div className="info-panel grid" style={{ gap: 6 }}>
        <label className="row" style={{ gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={modifierCount > 0} onChange={(e) => setModifierCount(e.target.checked ? 1 : 0)} /> <b>modifier</b> 사용 — 강조할 장점
          {modifierCount > 0 && <><span className="muted small">· 개수</span>
            <select className="select" style={{ width: 56 }} value={modifierCount} onChange={(e) => setModifierCount(Number(e.target.value))}>
              <option value={1}>1</option><option value={2}>2</option>
            </select><span className="muted small">개 조합</span></>}
        </label>
        {modifierCount > 0 && <textarea className="textarea" rows={3} value={modifierVals} onChange={(e) => setModifierVals(e.target.value)} placeholder={"필기시험부터\n상담전확인   (한 줄에 하나씩 · 필수)"} />}
      </div>
    </div>
    {isRegionPrimary && <div className="grid" style={{ gap: 8 }}>
      <div><b className="small">학원 타입 (선택)</b><p className="muted small">이 글유형이 후보로 쓸 학원 타입입니다. 괄호 안 숫자는 이 도메인에 <b>동기화된 학원 수</b>예요. <b>비우면 학원정보를 쓰지 않고</b> 지역 가이드/체크리스트 중심으로 작성합니다. 지역형 글유형에만 적용됩니다.</p></div>
      <div className="info-panel grid grid-3" style={{ gap: 6 }}>
        {(academyTypeOptions ?? []).map((t) => <label key={t.value} className="row" style={{ gap: 6 }}>
          <input type="checkbox" checked={academyTypes.has(t.value)} onChange={(e) => setAcademyTypes((prev) => { const next = new Set(prev); if (e.target.checked) next.add(t.value); else next.delete(t.value); return next; })} /> {t.value} <span className="muted small">({t.count})</span>
        </label>)}
        {!(academyTypeOptions ?? []).length && <p className="muted small">먼저 학원 동기화를 실행하면 타입 목록이 표시됩니다.</p>}
      </div>
      {(academyTypeOptions ?? []).length > 0 && (academyTypeOptions ?? []).every((t) => !t.count) && <p className="toast-warn small">아직 이 도메인에 동기화된 학원이 없습니다(모든 타입 0건). 학원 타입을 골라도 실제 후보가 없어 지역 가이드/체크리스트로만 작성됩니다 — 먼저 「원천 데이터」 탭에서 <b>학원 동기화</b>를 실행하세요.</p>}
    </div>}
      </div>
    </details>
    <details className="template-subsection" open={openSec.design} onToggle={(e) => { const open = e.currentTarget.open; setOpenSec((s) => ({ ...s, design: open })); }}>
      <summary className="template-subsection-summary"><div className="template-subsection-head"><div><h3>디자인</h3><p className="muted small">기본 디자인 · 목업 미리보기</p></div><span className="badge info">{openSec.design ? "접기" : "열기"}</span></div></summary>
      <div className="grid" style={{ marginTop: 8 }}>
    <Field label="디자인"><p className="muted small">글 유형마다 자동 매칭되는 기본 디자인입니다. 아래 목업으로 레이아웃을 확인하세요. 「커스텀」을 고르면 도메인 「디자인」 영역의 커스텀 디자인 메모가 적용됩니다.</p><select className="select" value={design} onChange={(e) => setDesign(e.target.value)}>
      {designChoices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
    </select></Field>
    <details className="template-subsection">
      <summary className="template-subsection-summary"><div className="template-subsection-head"><div><h3>디자인 목업 미리보기</h3><p className="muted small">위에서 고른 디자인의 레이아웃만 보여주는 예시 목업입니다. 실제 글 내용·방향성·축 값은 반영하지 않습니다.</p></div><span className="badge info toggle-badge" /></div></summary>
      {(() => {
        const opt = designChoices.find((d) => d.id === design);
        return <DesignPreview blueprint={designBlueprintFor(design, opt)} designId={design} designOption={opt} brandColor={brandColor} brand={brand ?? "브랜드"} title={opt?.name ?? design} summary={opt?.summary ?? ""} />;
      })()}
    </details>
      </div>
    </details>
    <details className="template-subsection" open={openSec.title} onToggle={(e) => { const open = e.currentTarget.open; setOpenSec((s) => ({ ...s, title: open })); }}>
      <summary className="template-subsection-summary"><div className="template-subsection-head"><div><h3>제목 규칙 <span className="badge info">{titleTiers.length ? `tier ${titleTiers.length}` : "미설정"}</span></h3><p className="muted small">생성 시점 실제 후보 수로 제목 확정 · 미설정이면 LLM이 H1 결정</p></div><span className="badge info">{openSec.title ? "접기" : "열기"}</span></div></summary>
      <div className="grid" style={{ marginTop: 8, gap: 10 }}>
        <p className="toast-info small" style={{ margin: 0 }}>제목을 <b>생성 시점의 실제 후보 수</b>로 확정해 LLM 즉흥·후보 수 부풀림을 막습니다. <b>tier</b>는 후보 수 <b>내림차순</b>으로 첫 매칭 제목을 씁니다(예: 3곳↑ &quot;BEST {"{개수}"}&quot;, 2곳 &quot;추천&quot;). 치환 토큰: <code>{"{지역}"}</code> <code>{"{개수}"}</code> <code>{"{키워드}"}</code> <code>{"{학원명}"}</code>(첫 후보). <b>tier를 하나도 두지 않으면 규칙 없음</b> — 기존대로 LLM이 H1을 정합니다.</p>
        <div className="info-panel small" style={{ margin: 0 }}>
          <b>&lsquo;실제 후보 수&rsquo;란?</b> 그 지역 글에 <b>소개하려고 선정된 학원 수</b>입니다 — 지역명이 맞는 <b>직접 후보</b> + 20km 이내 <b>인근 후보</b>로 모으고(둘 다 부족하면 50km 이내 최근접으로 <b>보장</b>), 글유형 상한(<b>비교형 최대 5곳 · 단독형 1곳</b>)만큼 추린 값이에요. tier의 <b>후보 수</b>·<b>min_generate</b>·<code>{"{개수}"}</code> 토큰이 모두 이 값을 가리킵니다.
          <br />주로 <b>학원형</b>(지역형 + 학원 타입 지정) 글유형에서 의미가 있습니다. 키워드형(가이드·시험 등)은 학원 후보가 0이라 tier가 안 맞아 fallback/LLM 제목으로 갑니다.
        </div>
        <Field label="최소 생성 후보 수 (min_generate · 선택)">
          <input className="input" type="number" min={0} style={{ width: 120 }} value={titleMinGenerate} onChange={(e) => setTitleMinGenerate(e.target.value)} placeholder="예: 2" />
          <p className="muted small">위 <b>&lsquo;실제 후보 수&rsquo;</b>가 이 값보다 적으면 <b>생성하지 않고 건너뜁니다</b>(슬롯 <code>skipped</code> · 후보 부족 지역 차단용). 비우거나 0이면 스킵 없음.</p>
        </Field>
        <div className="grid" style={{ gap: 6 }}>
          <div className="spread" style={{ alignItems: "center" }}><b className="small">tier (후보 수 → 제목)</b><button type="button" className="btn small" onClick={() => setTitleTiers((prev) => [...prev, { min_count: "", template: "" }])}>+ tier 추가</button></div>
          {titleTiers.length === 0 && <p className="muted small">tier가 없습니다. 「+ tier 추가」로 &quot;후보 N곳 이상일 때 이 제목&quot; 규칙을 만드세요. (없으면 LLM이 제목 결정)</p>}
          {titleTiers.map((t, i) => <div key={i} className="row" style={{ gap: 6, alignItems: "center" }}>
            <span className="muted small" style={{ whiteSpace: "nowrap" }}>후보</span>
            <input className="input" type="number" min={0} style={{ width: 72 }} value={t.min_count} placeholder="수" onChange={(e) => setTitleTiers((prev) => prev.map((x, j) => j === i ? { ...x, min_count: e.target.value } : x))} />
            <span className="muted small" style={{ whiteSpace: "nowrap" }}>곳 이상 →</span>
            <input className="input" style={{ flex: 1 }} value={t.template} placeholder="예: {지역} 운전학원 BEST {개수}" onChange={(e) => setTitleTiers((prev) => prev.map((x, j) => j === i ? { ...x, template: e.target.value } : x))} />
            <button type="button" className="btn small danger" onClick={() => setTitleTiers((prev) => prev.filter((_, j) => j !== i))} title="이 tier 삭제">✕</button>
          </div>)}
        </div>
        <Field label="fallback 제목 (선택)">
          <input className="input" value={titleFallback} onChange={(e) => setTitleFallback(e.target.value)} placeholder="어떤 tier도 안 맞을 때 쓸 제목 (예: {지역} 운전학원 안내)" />
        </Field>
      </div>
    </details>
    <div className="row">
      <button type="button" className="btn primary" disabled={busy} onClick={submit}>{busy ? "저장 중..." : mode === "edit" ? "저장" : source ? "복제해서 만들기" : "만들기"}</button>
      {mode === "create" && <button type="button" className="btn" disabled={busy} onClick={resetForm} title="입력한 내용을 모두 지우고 빈 폼으로 되돌립니다">초기화</button>}
      {mode === "edit" && <button type="button" className="btn" disabled={busy} onClick={onCancel}>취소</button>}
      {mode === "edit" && <span className="muted small">참조 아키타입(kind)은 만든 뒤 바꿀 수 없습니다.</span>}
    </div>
  </div>;
}

function designBlueprintFor(id: string, option?: DesignTemplateOption): typeof DESIGN_BLUEPRINTS[string] {
  const builtin = DESIGN_BLUEPRINTS[id];
  if (builtin) return { ...builtin };
  const sections = uniquePreviewItems(option?.structure_guide?.length ? option.structure_guide : ["상단 구성", "본문 섹션", "비교/요약", "CTA"]);
  return {
    label: option?.summary || "사용자 지정 디자인",
    title: `${option?.name || "사용자 지정 디자인"} 예시 글`,
    lead: option?.summary || "지정한 디자인 메모의 섹션 흐름과 스타일을 반영합니다.",
    chips: ["사용자 지정", "디자인"],
    sections,
    tone: option?.tone || "브랜드 톤",
    blocks: sections.slice(0, 4).map((section, index) => ({
      title: section.replace(/^\d+\)\s*/, ""),
      body: index === 0 ? "지정한 디자인 메모의 상단 구성과 문단 리듬을 따릅니다." : "색상, 카드감, 여백, CTA 강조 방식을 디자인 메모에 맞춰 반영합니다.",
      kind: index === 2 ? "table" : index === 3 ? "cta" : undefined,
    })),
  };
}

function uniquePreviewItems(items: string[]): string[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}


function Academies({ domain, academies, regionAxis, busy, onSave, onRefresh }: { domain: DomainConfig; academies: Academy[]; regionAxis: AxisValue[]; busy: boolean; onSave: (f: Record<string, unknown>) => Promise<void>; onRefresh: () => Promise<void> }) {
  async function saveRegionAxis(form: HTMLFormElement) {
    const values = parseCsv(String(new FormData(form).get("values") || ""));
    await replaceAxis(domain.domain, "region", values); await onRefresh();
  }
  const [syncBusy, setSyncBusy] = useState("");
  // 진행 중인 학원 동기화의 run_id. 12분짜리 작업이라 화면을 떠났다 돌아와도 이어봐야 한다.
  const [syncRunId, setSyncRunId] = useState("");
  // 동기화가 "성공"으로 끝났어도 짚어야 할 것(블로그리뷰 미조회 등). 성공 문구와 분리해 세운다.
  const [syncWarning, setSyncWarning] = useState("");
  const [regionLevel, setRegionLevel] = useState<"2" | "3" | "all">("2");
  const [replaceRegionAxis, setReplaceRegionAxis] = useState(true);
  const [regionMsg, setRegionMsg] = useState("");
  const [academyMsg, setAcademyMsg] = useState("");
  const [q, setQ] = useState("");
  const [region, setRegion] = useState("");
  const [academyType, setAcademyType] = useState("");
  const [hasPhotos, setHasPhotos] = useState(false);
  const [remoteAcademies, setRemoteAcademies] = useState(academies);
  const [remoteTotal, setRemoteTotal] = useState(academies.length);
  const [academyTypes, setAcademyTypes] = useState<Array<{ value: string; count: number }>>([]);
  const [manualToolsOpen, setManualToolsOpen] = useState(false);
  const [runtimeApis, setRuntimeApis] = useState<RuntimeApis | null>(null);
  // 블로그리뷰 수집이 켜져 있는지. 서버가 sync_defaults 로 실제 판단 결과를 내려주므로
  // 화면이 환경변수나 설정을 따로 해석하지 않는다(두 곳이 어긋나면 안내가 사실과 달라진다).
  const blogSyncOn = Boolean(runtimeApis?.sync_defaults.include_blog_reviews);
  const [loading, setLoading] = useState(false);
  const [filterError, setFilterError] = useState("");
  const [lastSync, setLastSync] = useState<SyncSummary>({});
  useEffect(() => { setLastSync(getSyncSummary(domain.domain)); }, [domain.domain]);
  // 지역 축 편집창: 비제어 defaultValue 는 동기화/초기화로 regionAxis 가 바뀌어도 갱신되지 않으므로(개수 배지만 갱신되던 버그),
  // content 시그니처로 로컬 draft 를 동기화한다. 사용자가 직접 편집하는 동안(regionAxis 불변)에는 리셋되지 않는다.
  const regionAxisText = regionAxis.map((r) => `${r.value},${r.weight},${r.monthly_search_volume ?? ""},${r.competition_kd ?? ""}`).join("\n");
  const [regionDraft, setRegionDraft] = useState(regionAxisText);
  useEffect(() => { setRegionDraft(regionAxisText); }, [regionAxisText]);
  // 학원 행에 남은 synced_at 중 가장 최근 값(다른 브라우저에서 동기화된 경우의 폴백).
  const academySyncedAt = useMemo(() => remoteAcademies.reduce<string | null>((max, a) => (a.synced_at && (!max || a.synced_at > max) ? a.synced_at : max), null), [remoteAcademies]);
  // 「최근 동기화」의 진실 원본은 DB(academies.synced_at)다. 브라우저 기록(localStorage)만 보여주면
  // 동기화가 실패해도 옛 성공 기록이 그대로 남아 "386개 반영"인데 목록은 0개인 모순이 표시된다.
  // (2026-07-27 실제 사고: 60초 걸리는 학원 동기화 도중 tsx watch 가 API 를 재시작해 전량 유실됐는데,
  //  화면은 나흘 전 성공 기록을 계속 보여줘 원인 파악이 늦어졌다.)
  // 브라우저 기록이 DB 반영 시각보다 뒤면 그 시도는 반영되지 않은 것이다. 성공 직후에도 응답 처리
  // 시간만큼 브라우저 기록이 뒤서므로 1분 여유를 둔다.
  const academyAttemptUnapplied = useMemo(() => {
    const attempt = parseUtcTimestamp(lastSync.academies?.at)?.getTime();
    if (!attempt) return false;
    const applied = parseUtcTimestamp(academySyncedAt)?.getTime();
    return !applied || attempt > applied + 60_000;
  }, [lastSync.academies?.at, academySyncedAt]);
  useEffect(() => { setRemoteAcademies(academies); setRemoteTotal(academies.length); }, [academies]);
  useEffect(() => {
    let cancelled = false;
    getRuntimeApis()
      .then((payload) => { if (!cancelled) setRuntimeApis(payload); })
      .catch(() => { if (!cancelled) setRuntimeApis(null); });
    return () => { cancelled = true; };
  }, []);
  async function loadAcademies() {
    setLoading(true); setFilterError("");
    try {
      const payload = await listAcademies(domain.domain, { q, region, academy_type: academyType, has_photos: hasPhotos, limit: 1000 });
      setRemoteAcademies(payload.items);
      setRemoteTotal(payload.count);
      setAcademyTypes(payload.academy_types ?? []);
    } catch (err) { setFilterError(err instanceof Error ? err.message : String(err)); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    let cancelled = false;
    const handle = window.setTimeout(async () => {
      setLoading(true); setFilterError("");
      try {
        const payload = await listAcademies(domain.domain, { q, region, academy_type: academyType, has_photos: hasPhotos, limit: 1000 });
        if (!cancelled) {
          setRemoteAcademies(payload.items);
          setRemoteTotal(payload.count);
          setAcademyTypes(payload.academy_types ?? []);
        }
      } catch (err) { if (!cancelled) setFilterError(err instanceof Error ? err.message : String(err)); }
      finally { if (!cancelled) setLoading(false); }
    }, 250);
    return () => { cancelled = true; window.clearTimeout(handle); };
  }, [domain.domain, q, region, academyType, hasPhotos]);
  async function add(form: HTMLFormElement) { const fd = Object.fromEntries(new FormData(form).entries()); await api(`/domains/${encodeURIComponent(domain.domain)}/academies`, { method: "POST", body: JSON.stringify(fd) }); form.reset(); await onRefresh(); }
  async function bulk(form: HTMLFormElement) { const text = String(new FormData(form).get("json") || ""); await api(`/domains/${encodeURIComponent(domain.domain)}/academies`, { method: "POST", body: text }); form.reset(); await onRefresh(); }
  async function del(id: string) { if (!confirm("삭제할까요?")) return; await api(`/domains/${encodeURIComponent(domain.domain)}/academies/${id}`, { method: "DELETE" }); await onRefresh(); await loadAcademies(); }
  async function delAll() {
    if (!confirm("이 도메인의 학원 자료를 전부 삭제할까요? (검색/지역 필터와 무관하게 모두 삭제) 되돌릴 수 없습니다.")) return;
    setSyncBusy("academies");
    try {
      const res = await api<{ deleted: number }>(`/domains/${encodeURIComponent(domain.domain)}/academies`, { method: "DELETE" });
      setAcademyMsg(`학원 자료 ${Number(res.deleted ?? 0).toLocaleString()}개를 모두 삭제했습니다.`);
      await onRefresh(); await loadAcademies();
    } catch (e) { alert((e as Error).message); }
    finally { setSyncBusy(""); }
  }
  /**
   * 학원 동기화. 서버가 백그라운드로 돌리고 run_id 만 주므로 여기서 진행률을 폴링한다.
   * 지금은 자체 후기만 받아 1~2분이면 끝나지만, 백그라운드 구조는 그대로 둔다 — 블로그리뷰
   * 수집을 다시 켜면 학원 1곳당 2.6초라 380곳에 12분이 넘고, 창을 닫아도 서버는 계속 돈다.
   */
  async function syncAcademies() {
    setSyncBusy("academies");
    setSyncWarning("");
    try {
      // 수집 여부의 최종 판단은 서버가 한다(설정 → 환경변수 → 꺼짐). 화면은 현재 설정을 그대로 전달만 한다.
      const started = await syncDrivingplusAcademies(domain.domain, { include_reviews: true, review_limit: 5, review_sort: "point", include_blog_reviews: blogSyncOn, blog_review_limit: 3 });
      setSyncRunId(started.run_id);
      setAcademyMsg(blogSyncOn
        ? "동기화를 시작했습니다. 블로그 리뷰까지 받으므로 10분 이상 걸립니다."
        : "동기화를 시작했습니다. 학원 기본 정보와 수강생 후기를 받습니다.");
      await pollSyncRun(started.run_id);
    } catch (e) {
      alert((e as Error).message);
      setSyncBusy("");
    }
  }

  async function pollSyncRun(runId: string) {
    // 연속 조회 실패 상한. 일시적인 통신 오류로 진행 중인 동기화를 실패로 단정하면 안 되지만,
    // 상한이 없으면 API 가 영영 안 돌아와도 3초마다 무한히 폴링한다.
    let errorsInARow = 0;
    while (true) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      let run: SyncRun;
      try {
        run = await getSyncRun(domain.domain, runId);
        errorsInARow = 0;
      } catch (e) {
        if (++errorsInARow < POLL_MAX_ERRORS_IN_A_ROW) continue;
        // 여기서 포기하는 건 화면 갱신뿐이다. 동기화는 서버에서 계속 돌고 있을 수 있으므로
        // "실패했다" 가 아니라 "상태를 못 본다" 로 안내한다.
        setSyncRunId("");
        setSyncBusy("");
        setAcademyMsg(`동기화 상태를 ${POLL_MAX_ERRORS_IN_A_ROW}회 연속 확인하지 못했습니다(${(e as Error).message}). 동기화 자체는 서버에서 계속 진행 중일 수 있습니다. 화면을 새로 고치면 다시 붙습니다.`);
        return;
      }
      const pct = run.count_total ? Math.floor((run.count_done / run.count_total) * 100) : 0;
      if (run.status === "running") {
        setAcademyMsg(`${run.step ?? "진행 중"} · ${run.count_done}/${run.count_total || "?"}${run.count_total ? ` (${pct}%)` : ""}${run.cancel_requested ? " · 취소 요청됨" : ""}`);
        continue;
      }
      setSyncRunId("");
      setSyncBusy("");
      if (run.status === "cancelled") { setAcademyMsg("동기화를 취소했습니다. 저장 전에 멈췄으므로 기존 자료는 그대로입니다."); return; }
      if (run.status === "error") { setAcademyMsg(`동기화 실패: ${run.error ?? "원인 미상"}`); return; }
      const res = run.result_obj;
      if (!res) { setAcademyMsg("동기화가 끝났습니다."); await onRefresh(); await loadAcademies(); return; }
      setAcademyMsg(`학원 ${res.fetched}개 조회 · ${res.upserted}개 반영 · 수강생 후기 ${res.review_count}개${blogSyncOn ? ` · 블로그 리뷰 ${res.blog_review_count}개` : ""} · ${res.skipped}개 제외`);
      // 블로그리뷰를 못 가져온 학원이 있으면 성공 문구에 묻지 않고 따로 경고로 세운다.
      // 이 값이 조용히 넘어가면 원천이 다시 느려져도 아무도 모른 채 후기가 낡아간다.
      setSyncWarning(syncWarningText(res));
      setLastSync(recordSync(domain.domain, "academies", { count: res.upserted, at: new Date().toISOString(), detail: `조회 ${res.fetched}개 · 수강생 후기 ${res.review_count}개` }));
      await onRefresh();
      await loadAcademies();
      return;
    }
  }

  async function cancelAcademySync() {
    if (!syncRunId) return;
    try { await cancelSyncRun(domain.domain, syncRunId); } catch (e) { alert((e as Error).message); }
  }

  // 동기화는 서버에서 도는 작업이라 화면을 새로 열어도 계속된다. 진행 중이면 다시 붙어 진행률을 보여준다
  // (안 하면 버튼이 눌리는 것처럼 보이는데 서버는 409 로 거절한다).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { items } = await listSyncRuns(domain.domain, 5);
        const running = items.find((run) => run.status === "running");
        if (!running || cancelled) return;
        setSyncBusy("academies");
        setSyncRunId(running.id);
        await pollSyncRun(running.id);
      } catch {
        // 이어붙이기 실패는 조용히 넘긴다. 동기화 자체와 무관하다.
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain.domain]);
  async function syncRegions() {
    setSyncBusy("regions");
    try {
      const res = await syncDrivingplusRegions(domain.domain, { level: regionLevel, replace_axis: replaceRegionAxis, max: regionLevel === "3" ? 500 : 10000 });
      setRegionMsg(`지역 ${res.fetched}개 조회 · ${res.upserted}개 반영${res.axis_replaced ? " · region 축 교체" : ""}`);
      setLastSync(recordSync(domain.domain, "regions", { count: res.upserted, at: new Date().toISOString(), detail: `조회 ${res.fetched}개${res.axis_replaced ? " · region 축 교체" : ""}` }));
      await onRefresh();
    } catch (e) { alert((e as Error).message); }
    finally { setSyncBusy(""); }
  }
  // region 축만 운전 프리셋 기본값으로 초기화(keyword 등 다른 축 미변경). 동기화 테스트 전 알려진 baseline 확보용.
  async function resetRegions() {
    if (!confirm("지역 축을 기본값(운전 프리셋 지역)으로 초기화할까요? 지금 지역 목록이 덮어써집니다.")) return;
    setSyncBusy("regions");
    try {
      await api(`/domains/${encodeURIComponent(domain.domain)}/axes/preset`, { method: "POST", body: JSON.stringify({ preset_key: domain.vertical || "driving", axes: ["region"] }) });
      setRegionMsg("지역 축을 기본값으로 초기화했습니다.");
      await onRefresh();
    } catch (e) { alert((e as Error).message); }
    finally { setSyncBusy(""); }
  }
  return <div className="grid">
    {/* 묶음 1 — 원천 데이터 개요 + 현재 적용 API */}
    <div className="card card-pad grid" data-tour="academies-sync">
      <div>
        <h2>학원/지역자료 — 생성용 배경 데이터</h2>
        <p className="muted">DrivingPlus 원천 API의 지역·학원 데이터를 가져와 글 생성 프롬프트의 검증된 자료로 씁니다. 지역 → 학원 순서로 한 번 준비해두면 생성 때 다시 열 필요는 없습니다.</p>
        {/*
          수집 토글은 도메인이 아니라 전역 설정이라 설정 화면에 있다. 동기화를 실행하는 곳은 여기이므로,
          여기서 찾지 못하면 토글이 있다는 사실 자체를 모르게 된다. 그래서 현재 상태와 위치를 같이 알린다.
        */}
        <p className="muted small">
          블로그 리뷰 수집: <b>{blogSyncOn ? "켜짐" : "꺼짐"}</b>
          {blogSyncOn
            ? " — 학원 동기화가 10분 이상 걸립니다. 수집만 하며 글 생성에는 쓰지 않습니다."
            : " — 원천이 학원명을 느슨하게 매칭해 다른 학원 글이 섞이기 때문입니다. 글 생성에도 쓰지 않습니다."}
          {" "}켜고 끄는 것은 <Link href="/settings">설정 → 블로그 리뷰 수집</Link>에서 합니다.
        </p>
      </div>
      <div className="row" style={{ gap: 10 }}><span className="badge info">지역 데이터 {regionAxis.length.toLocaleString()}개</span><span className="badge info">학원 데이터 {remoteTotal.toLocaleString()}개</span></div>
      <div className="writer-hint">
        <b>현재 적용 API</b>
        <span>관리자/Nest: <code>{runtimeApis?.admin_api_base ?? "확인 중..."}</code></span>
        <span>DrivingPlus 원천: <code>{runtimeApis?.drivingplus_api_base ?? "확인 중..."}</code></span>
        {runtimeApis && <span>지역: <code>{runtimeApis.drivingplus_endpoints.seo_regions}</code></span>}
        {runtimeApis && <span>학원: <code>{runtimeApis.drivingplus_endpoints.academies}</code></span>}
        {runtimeApis && <span>일반 리뷰: <code>{runtimeApis.drivingplus_endpoints.reviews}</code></span>}
        {/* 블로그 리뷰 엔드포인트는 스위치가 켜졌을 때만 의미가 있다. 꺼진 상태로 주소만 보이면
            "받고 있다" 로 읽힌다. 서버가 알려주는 실제 기본값(sync_defaults)을 그대로 반영한다. */}
        {runtimeApis && (runtimeApis.sync_defaults.include_blog_reviews
          ? <span>블로그 리뷰: <code>{runtimeApis.drivingplus_endpoints.blog_reviews}</code></span>
          : <span>블로그 리뷰: <b>수집 안 함</b></span>)}
        {runtimeApis && <span>동기화 기본값: 일반 리뷰 {runtimeApis.sync_defaults.review_limit}개({runtimeApis.sync_defaults.review_sort}){runtimeApis.sync_defaults.include_blog_reviews ? `, 블로그 리뷰 ${runtimeApis.sync_defaults.blog_review_limit}개` : ""}</span>}
        {runtimeApis && <span className="muted small">{runtimeApis.sync_defaults.review_source_note}</span>}
      </div>
    </div>
    {/* 묶음 1.5 — 전역 지역 사전. 1·2단계와 달리 도메인별이 아니라 전역 공용이라 번호를 붙이지 않는다. */}
    <RegionDirectoryCard domain={domain.domain} />
    {/* 묶음 2 — 지역자료 동기화 */}
    <div className="card card-pad grid">
      <div className="spread"><h3 style={{ margin: 0 }}>1단계 · 지역자료 동기화</h3><span className="badge">지역 데이터 · region 축</span></div>
      <p className="muted small">지역(시군구/읍면동) 목록을 가져오고, 옵션을 켜면 region 축을 교체합니다. 아래 옵션은 <b>지역 동기화에만</b> 적용됩니다.</p>
      <div className="grid grid-2">
        <Field label="지역 레벨"><select className="select" value={regionLevel} onChange={(e) => setRegionLevel(e.target.value as "2" | "3" | "all")}><option value="2">시군구(level=2, 권장)</option><option value="3">읍면동(level=3, 최대 500개)</option><option value="all">전체</option></select></Field>
        <Field label="지역 축 반영"><label className="row small" style={{ minHeight: 42 }}><input type="checkbox" checked={replaceRegionAxis} onChange={(e) => setReplaceRegionAxis(e.target.checked)} /> axes.region 교체</label></Field>
      </div>
      <div className="row" style={{ gap: 8 }}><button className="btn primary" onClick={syncRegions} disabled={Boolean(syncBusy)}>{syncBusy === "regions" ? "지역 동기화 중..." : "지역 동기화"}</button><button className="btn" type="button" onClick={resetRegions} disabled={Boolean(syncBusy)} title="지역 축을 운전 프리셋 기본값으로 되돌립니다(테스트용 baseline)">기본값으로 초기화</button></div>
      {regionMsg && <p className="small badge success" style={{ width: "fit-content" }}>{regionMsg}</p>}
      {/* 지역은 화면에 DB 기준 개수가 없어 브라우저 기록만 남긴다. 학원 쪽처럼 DB 와 대조할 수 없으므로
          '이 브라우저 기록'임을 문구로 밝혀, 실패한 시도를 서버 상태로 오해하지 않게 한다. */}
      <p className="muted small">최근 지역 동기화(이 브라우저 기록): {lastSync.regions ? `${formatDateTime(lastSync.regions.at)} · ${lastSync.regions.count.toLocaleString()}개 반영${lastSync.regions.detail ? ` (${lastSync.regions.detail})` : ""}` : "아직 기록 없음"}</p>
      <div className="spread"><div><h3 style={{ margin: 0 }}>현재 지역 축</h3><p className="muted small">글유형(지역형)이 「지역 × 키워드」 조합을 만들 때 쓰는 지역 풀입니다. 키워드 마스터와 동일하게 <b>가중치·월검색량·KD</b>는 슬롯 우선순위 계산에만 쓰이고 글 내용은 바꾸지 않습니다.</p></div><span className="badge info">{regionAxis.length}개</span></div>
      <p className="uploaded-notice" style={{ padding: "8px 12px", margin: "-8px 0" }}>⚠️ <b>월검색량·KD</b>는 실측이 아닌 추정 시드값으로 슬롯 <b>우선순위</b>에만 쓰이며 글 내용은 바꾸지 않습니다(추후 <b>네이버 검색광고 API</b> 연동 시 실측 갱신 예정). 지역 동기화로 축을 교체하면 이 두 값은 비워집니다.</p>
      {regionAxis.length > 0
        ? <div className="table-wrap" style={{ maxHeight: 340, overflow: "auto" }}><table>
            <thead><tr><th>지역</th><th style={{ width: 90 }}>가중치</th><th style={{ width: 120 }}>월검색량</th><th style={{ width: 100 }}>경쟁도(KD)</th></tr></thead>
            <tbody>{regionAxis.map((r, i) => <tr key={i}><td>{r.value}</td><td>{r.weight}</td><td>{r.monthly_search_volume ?? "-"}</td><td>{r.competition_kd ?? "-"}</td></tr>)}</tbody>
          </table></div>
        : <p className="muted small">지역이 없습니다. 위 「지역 동기화」 또는 「기본값으로 초기화」로 채우세요.</p>}
      <details className="template-subsection">
        <summary className="template-subsection-summary"><div className="template-subsection-head"><div><h3 style={{ margin: 0 }}>CSV로 직접 편집 (고급)</h3><p className="muted small">보통은 위 동기화로 채웁니다. 지역 목록을 수동 조정할 때만 여세요. 한 줄에 하나: <code>값,가중치,월검색량,KD</code></p></div><span className="badge info">{regionAxis.length}개</span></div></summary>
        <form className="grid" style={{ marginTop: 8 }} onSubmit={(e) => { e.preventDefault(); saveRegionAxis(e.currentTarget); }}>
          <textarea className="textarea mono" name="values" rows={8} value={regionDraft} onChange={(e) => setRegionDraft(e.target.value)} placeholder="값,가중치,월검색량,KD" />
          <div className="row"><button className="btn primary">지역 축 저장</button></div>
        </form>
      </details>
    </div>
    {/* 묶음 3 — 학원자료 동기화 */}
    <div className="card card-pad grid">
      <div className="spread"><h3 style={{ margin: 0 }}>2단계 · 학원자료 동기화</h3><span className="badge">학원 상세 · 사진 · 리뷰</span></div>
      <p className="muted small">
        각 지역의 학원 상세(사진·별점리뷰{blogSyncOn ? "·블로그 리뷰" : ""} 포함)를 가져옵니다. 지역 동기화 이후 실행을 권장하며, 위 지역 옵션은 여기에 영향을 주지 않습니다.
        {blogSyncOn
          ? " 블로그 리뷰도 받도록 설정돼 있어 10분 이상 걸립니다. 수집만 하며 글 생성에는 쓰지 않습니다(설정에서 끌 수 있습니다)."
          : " 블로그 리뷰는 받지 않습니다 — 원천이 학원명을 느슨하게 매칭해 다른 학원 글이 섞이기 때문이며, 글 생성에도 쓰지 않습니다."}
      </p>
      <div className="row" style={{ gap: 8 }}><button className="btn primary" onClick={syncAcademies} disabled={Boolean(syncBusy)} title={blogSyncOn ? "학원 목록·수강생 후기·블로그 리뷰를 받아옵니다. 블로그 리뷰는 한 곳씩 받아야 해 10분 이상 걸립니다." : "학원 목록과 수강생 후기를 원천에서 받아옵니다(1~2분). 블로그 리뷰는 받지 않습니다 — 원천이 학원명을 느슨하게 매칭해 다른 학원 글이 섞이기 때문입니다."}>{syncBusy === "academies" ? "학원 동기화 중..." : "학원 동기화"}</button>{syncRunId ? <button className="btn" type="button" onClick={cancelAcademySync} title="지금까지 받은 내용을 저장하지 않고 멈춥니다. 기존 자료는 그대로 남습니다.">동기화 취소</button> : null}<button className="btn danger" type="button" onClick={delAll} disabled={Boolean(syncBusy)} title="이 도메인의 학원 자료를 전부 삭제합니다(되돌릴 수 없음)">전체 학원 삭제</button></div>
      {academyMsg && <p className="small badge success" style={{ width: "fit-content" }}>{academyMsg}</p>}
      {syncWarning && <p className="small badge warn" style={{ width: "fit-content" }}>⚠ {syncWarning}</p>}
      <p className="muted small">최근 동기화: {academySyncedAt ? `${formatDateTime(academySyncedAt)} · 현재 ${remoteTotal.toLocaleString()}곳${lastSync.academies?.detail && !academyAttemptUnapplied ? ` (${lastSync.academies.detail})` : ""}` : "아직 반영된 학원이 없습니다"}</p>
      {academyAttemptUnapplied && (
        <p className="small" style={{ color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 10px", margin: 0 }}>
          ⚠️ 이 브라우저의 마지막 동기화 시도({formatDateTime(lastSync.academies?.at)})는 DB에 반영되지 않았습니다.
          학원 동기화는 1분 안팎이 걸리는데 그사이 개발 서버가 재시작되면 전량 유실됩니다.
          <code>npm run sync:academies -- {domain.domain}</code> 로 다시 실행하면 서버 재시작과 무관하게 반영됩니다.
        </p>
      )}
      <ResearchSummaryCard domain={domain.domain} usage={domain.research_usage ?? "off"} busy={busy} onSave={onSave} />
      <div className="card card-pad grid compact-pad" style={{ background: "#f8fafc" }}>
        <div className="spread"><div><h3 style={{ margin: 0 }}>선택 · 수동 자료 보완</h3><p className="muted small">DrivingPlus 동기화에 없는 검증 자료가 있을 때만 직접 채웁니다. 필수 단계는 아니며, 위 지역·학원 동기화만으로도 글을 생성할 수 있습니다.</p></div><button className="btn" type="button" onClick={() => setManualToolsOpen((open) => !open)}>{manualToolsOpen ? "닫기" : "열기"}</button></div>
        {manualToolsOpen && <>
          <p className="small" style={{ color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 10px", margin: 0 }}>⚠️ 같은 학원(지역+이름)을 다시 등록하면 비운 항목이 기존 값을 덮어 지웁니다. 일부만 수정할 땐 나머지 항목도 함께 채워주세요. 단건·JSON 일괄 등록 모두 동일합니다.</p>
          <form className="grid" onSubmit={(e) => { e.preventDefault(); add(e.currentTarget); }}><h3>1. 단건 등록</h3><p className="muted small">학원 1곳의 지역, 이름, 주소, 전화, 검증 메모를 직접 입력합니다.</p><div className="grid grid-3">{["region","name","address","price","shuttle","hours","pass_rate","phone","source_name","source_url","review"].map((n) => <input key={n} className="input" name={n} placeholder={n} required={n === "name"} />)}</div><button className="btn primary">단건 등록</button></form>
          <form className="grid" onSubmit={(e) => { e.preventDefault(); bulk(e.currentTarget); }}><h3>2. JSON 일괄 등록</h3><p className="muted small">여러 학원 자료를 JSON 객체 또는 배열로 한 번에 등록합니다.</p><textarea className="textarea mono" name="json" placeholder='[{"region":"대구","name":"OO학원","price":"65만원"}]' /><button className="btn">JSON 일괄 등록</button></form>
        </>}
      </div>
      <div className="spread"><div><h3 style={{ margin: 0 }}>현재 학원 목록</h3><p className="muted small">동기화된 학원을 검색·지역으로 찾고, 필요 없는 자료는 삭제합니다. 글 생성에 쓰는 학원 타입은 글유형별로 정합니다(글유형 탭의 “학원 타입 필터”).</p></div><span className="badge info">{remoteTotal.toLocaleString()}개{loading ? " 검색 중" : ""}</span></div>
      <div className="grid grid-4">
        <Field label="검색"><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="학원명, 주소, SEO 설명" /></Field>
        <Field label="지역"><input className="input" value={region} onChange={(e) => setRegion(e.target.value)} placeholder="서울, 부산, 강남구" /></Field>
        <Field label="API 타입"><select className="select" value={academyType} onChange={(e) => setAcademyType(e.target.value)}><option value="">전체 타입</option>{academyTypes.map((type) => <option key={type.value} value={type.value}>{type.value} ({type.count})</option>)}</select></Field>
        <Field label="사진"><label className="row small" style={{ minHeight: 42 }}><input type="checkbox" checked={hasPhotos} onChange={(e) => setHasPhotos(e.target.checked)} /> 사진 있는 학원만</label></Field>
      </div>
      {filterError && <p className="small" style={{ color: "var(--danger)" }}>필터 오류: {filterError}</p>}
      {remoteAcademies.length > 0
        ? <div className="table-wrap" style={{ maxHeight: 480, overflow: "auto" }}><table><thead><tr><th>지역</th><th>학원명</th><th>API 타입</th><th>전화/사진</th><th>SEO 설명</th><th>출처</th><th></th></tr></thead><tbody>{remoteAcademies.map((a) => {
            const photoCount = parsePhotoCount(a.photos);
            const reviewCount = parseJsonCount(a.review_json);
            const blogReviewCount = parseJsonCount(a.blog_reviews);
            return <tr key={a.id}><td>{a.region}</td><td><b>{a.name}</b><p className="muted small">{a.address}</p><p className="muted small">{a.external_id ? `#${a.external_id}` : ""}</p></td><td><span className="badge">{a.academy_type || "-"}</span></td><td>{a.vphone || a.phone}<p className="muted small">{photoCount ? `사진 ${photoCount}장` : "사진 없음"} · 리뷰 {reviewCount}개 · 블로그 {blogReviewCount}개</p></td><td><span className="small">{a.seo_description || a.review || "-"}</span></td><td>{a.source_url ? <a href={a.source_url} target="_blank">{a.source_name || "링크"}</a> : a.source_name}</td><td><button className="btn danger" onClick={() => del(a.id)}>삭제</button></td></tr>;
          })}</tbody></table></div>
        : <p className="muted small">{loading ? "불러오는 중..." : "학원이 없습니다. 위 「학원 동기화」로 채우거나 검색 조건을 바꿔보세요."}</p>}
    </div>
  </div>;
}

function Slots({ domain, slots, options, onRefresh, onTab }: { domain: DomainConfig; slots: Slot[]; options: AdminOptions; onRefresh: () => Promise<void>; onTab: (v: string) => void }) {
  const [selected, setSelected] = useState(new Set<string>());
  const [status, setStatus] = useState("planned");
  const [template, setTemplate] = useState("");
  const [q, setQ] = useState("");
  // 설정 페이지에 저장된 브라우저 로컬 기본값으로 초기화(없으면 내장 기본값).
  // Slots 는 payload 로드 후에 마운트되므로 localStorage 읽기가 하이드레이션에 안전하다.
  const [genDefaults] = useState(getGenerationDefaults);
  const [provider, setProvider] = useState<Provider>(genDefaults.provider);
  const [model, setModel] = useState(genDefaults.model);
  const [cooldown, setCooldown] = useState(genDefaults.cooldownSec);
  const [timeout, setTimeout] = useState(recommendedGenerationTimeoutSec(genDefaults.imageGen, genDefaults.timeoutSec));
  const [web, setWeb] = useState(genDefaults.web);
  const [imageGen, setImageGen] = useState(genDefaults.imageGen);
  const [imageSize, setImageSize] = useState(genDefaults.imageSize);
  // 프로바이더별 모델 선택지(서버 카탈로그). 저장돼 있던 값이 카탈로그에 없으면 그 값도 보기로 남겨
  // 선택이 조용히 default 로 되돌아가지 않게 한다.
  const modelChoices = useMemo(() => {
    const catalog = options.generation_models?.[provider] ?? [{ id: "", label: "default" }];
    return catalog.some((m) => m.id === model) ? catalog : [...catalog, { id: model, label: `${model} (직접 지정)` }];
  }, [options.generation_models, provider, model]);
  const [max, setMax] = useState(30); // 1단계: 선택 글유형의 후보 생성 개수(유형당 상한)
  const [remoteSlots, setRemoteSlots] = useState(slots);
  const [remoteTotal, setRemoteTotal] = useState(slots.length);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [queueBusy, setQueueBusy] = useState(false);
  const [busy, setBusy] = useState(false); // 후보 생성/삭제 등 느린 작업 로딩
  const [slotError, setSlotError] = useState("");
  // P5b: 1단계 후보 만들기를 '글유형 + 개수'로. 유형 라벨/후보상한은 coherence(빌트인+커스텀 공통).
  const enabledTypeIds = domain.templates_enabled;
  const [genType, setGenType] = useState(enabledTypeIds[0] ?? "");
  const [typeMeta, setTypeMeta] = useState<Record<string, CoherenceTemplate>>({});
  useEffect(() => {
    let cancelled = false;
    getCoherence(domain.domain)
      .then((r) => { if (!cancelled) setTypeMeta(Object.fromEntries((r.templates ?? []).map((t) => [t.template_id, t]))); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [domain.domain]);
  const enabledTypes = enabledTypeIds.map((id) => {
    const meta = typeMeta[id];
    const spec = options.template_specs[id];
    return { id, name: meta?.name ?? spec?.name ?? id, upper: meta?.estimated_slot_upperbound };
  });
  // 후보 목록 '유형' 필터: 빌트인+커스텀 전 유형(getCoherence). 로드 전이면 빌트인 id 로 폴백.
  const typeFilterOptions = Object.keys(typeMeta).length
    ? Object.values(typeMeta).map((t) => ({ id: t.template_id, name: t.name }))
    : options.templates.map((id) => ({ id, name: options.template_specs[id]?.name ?? "" }));

  useEffect(() => { setRemoteSlots(slots); setRemoteTotal(slots.length); }, [slots]);

  async function loadCurrentSlots() {
    setLoadingSlots(true); setSlotError("");
    try {
      const payload = await listSlots(domain.domain, { status, template, q, limit: 1000 });
      setRemoteSlots(payload.items); setRemoteTotal(payload.total ?? payload.count);
    } catch (err) { setSlotError(err instanceof Error ? err.message : String(err)); }
    finally { setLoadingSlots(false); }
  }
  useEffect(() => {
    let cancelled = false;
    const handle = window.setTimeout(async () => {
      setLoadingSlots(true); setSlotError("");
      try {
        const payload = await listSlots(domain.domain, { status, template, q, limit: 1000 });
        if (!cancelled) { setRemoteSlots(payload.items); setRemoteTotal(payload.total ?? payload.count); setSelected(new Set()); }
      } catch (err) { if (!cancelled) setSlotError(err instanceof Error ? err.message : String(err)); }
      finally { if (!cancelled) setLoadingSlots(false); }
    }, 250);
    return () => { cancelled = true; window.clearTimeout(handle); };
  }, [domain.domain, status, template, q]);

  const filtered = remoteSlots;
  const expectedMinutes = Math.max(1, Math.ceil(((selected.size || 1) * (cooldown + 30)) / 60));
  const selectedAllVisible = filtered.length > 0 && filtered.every((s) => selected.has(s.slot_id));
  const effectiveTimeout = recommendedGenerationTimeoutSec(imageGen, timeout);
  const writerPayload = { provider, model, design_template_id: domain.design_template_id, use_web_research: web, cooldown_sec: cooldown, timeout_sec: effectiveTimeout, enable_image_generation: imageGen, image_size: imageSize, image_count: 1, image_provider: "private-codex" };
  const exclusionLines = parseLines(domain.excluded_keywords ?? "");


  async function gen() {
    if (busy || queueBusy || !genType) return;
    setBusy(true);
    try {
      const res = await api<{ max_per_template?: number; summary?: Record<string, number> }>(`/domains/${encodeURIComponent(domain.domain)}/slots/generate`, { method: "POST", body: JSON.stringify({ template: genType, max_per_template: max }) });
      await onRefresh(); await loadCurrentSlots();
      // 요청 개수가 유형당 하드 상한을 넘겼으면 클램프 사실을 알린다(응답의 max_per_template 는 실제 적용된 상한).
      const cap = res?.max_per_template;
      const created = res?.summary?.[genType];
      if (typeof cap === "number" && max > cap) alert(`요청한 개수 ${max.toLocaleString()}개는 글유형당 상한 ${cap.toLocaleString()}개로 제한됩니다.${typeof created === "number" ? `\n실제 생성/갱신: ${created.toLocaleString()}개.` : ""}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }
  async function queue(ids: string[]) {
    if (!ids.length || queueBusy) return;
    setQueueBusy(true);
    try {
      const r = await enqueueGenerate(domain.domain, { slot_ids: ids, max_per_template: max, ...writerPayload });
      alert(`작업 큐 등록: ${r.job_id} · ${r.slot_count ?? ids.length}개\\n작업 큐 탭에서 진행상태를 확인하세요.`);
      setSelected(new Set()); await onRefresh(); await loadCurrentSlots(); onTab("jobs");
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setQueueBusy(false);
    }
  }
  async function smartQueue(label: string, body: Record<string, unknown>) {
    if (queueBusy) return;
    const count = Number(body.max || 1);
    if (count >= 50 && !confirm(`${label}: ${count}개 글 작성을 큐에 등록할까요?`)) return;
    setQueueBusy(true);
    try {
      const r = await enqueueGenerate(domain.domain, { ...body, max_per_template: max, ...writerPayload });
      alert(`${label} 큐 등록: ${r.job_id} · ${r.slot_count ?? count}개\\n작업 큐 탭에서 진행상태를 확인하세요.`);
      setSelected(new Set()); await onRefresh(); await loadCurrentSlots(); onTab("jobs");
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setQueueBusy(false);
    }
  }
  async function delSelected() { if (busy || queueBusy || !confirm(`${selected.size}개 삭제?`)) return; setBusy(true); try { for (const id of selected) await api(`/domains/${encodeURIComponent(domain.domain)}/slots/${id}`, { method: "DELETE" }); setSelected(new Set()); await onRefresh(); await loadCurrentSlots(); } catch (err) { alert(err instanceof Error ? err.message : String(err)); } finally { setBusy(false); } }
  function toggleAllVisible() { setSelected((prev) => { if (selectedAllVisible) return new Set(); const next = new Set(prev); for (const s of filtered) next.add(s.slot_id); return next; }); }
  function applySlotTitle(slotId: string, title: string | null) { setRemoteSlots((prev) => prev.map((s) => s.slot_id === slotId ? { ...s, title } : s)); }

  return (
    <div className="grid">
      <div className="card card-pad grid slot-panel" data-tour="slots-generator">
        <div>
          <p className="eyebrow">1단계</p>
          <h2>글 후보 만들기</h2>
          <p className="muted small">글유형을 고르고 개수를 정해 작성 대기 후보(planned)를 만듭니다. LLM을 호출하지 않습니다.</p>
        </div>
        <div className="row slot-panel-actions">
          <Field label="글유형">
            <select className="select" style={{ minWidth: 220 }} value={genType} onChange={(e) => setGenType(e.target.value)}>
              {enabledTypes.length === 0 && <option value="">활성 글유형 없음</option>}
              {enabledTypes.map((t) => <option key={t.id} value={t.id}>{t.name}{typeof t.upper === "number" ? ` · 후보 상한 ~${t.upper.toLocaleString()}` : ""}</option>)}
            </select>
          </Field>
          <Field label="개수">
            <input className="input" type="number" min={1} value={max} onChange={(e) => setMax(Math.max(1, Number(e.target.value) || 1))} style={{ width: 100 }} />
          </Field>
          <button className="btn primary" data-tour="slots-create" disabled={busy || queueBusy || !genType} onClick={gen}>{busy ? "만드는 중..." : "글 후보 만들기"}</button>
        </div>
        {enabledTypes.length === 0 && <p className="muted small">활성화된 글유형이 없습니다. <Link className="btn" href={`/t/${encodeURIComponent(domain.domain)}?tab=templates`}>글유형/디자인 탭</Link>에서 유형을 켜세요.</p>}
        <p className="muted small">조합 재료는 「원천 데이터」 탭 지역·「글 공통 설정」 키워드 마스터·「글유형/디자인」 설정을 따릅니다. 프리셋을 적용했다면 별도 동기화 없이도 후보를 만들 수 있습니다.</p>
        {exclusionLines.length > 0 && <p className="muted small">적용 중인 제외: {exclusionLines.slice(0, 5).join(", ")}{exclusionLines.length > 5 ? " ..." : ""}</p>}
      </div>

      <div className="card card-pad grid slot-panel" data-tour="slots-writer">
        <div>
          <p className="eyebrow">2단계</p>
          <h2>글 작성</h2>
          <p className="muted small">후보를 골라 생성 작업 큐에 넣습니다. 후보가 없으면 먼저 1단계 ‘글 후보 만들기’로 후보를 만든 뒤 작성하세요. (작성 버튼은 후보를 자동 생성하지 않습니다.)</p>
        </div>
        <div className="grid grid-4">
          <Field label="작성 엔진"><select className="select" value={provider} onChange={(e) => setProvider(e.target.value as Provider)}>{options.providers.map((p) => <option key={p}>{p}</option>)}</select></Field>
          <Field label="모델"><select className="select" value={model} onChange={(e) => setModel(e.target.value)}>{modelChoices.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></Field>
          <Field label="제한시간(초)"><input className="input" type="number" value={timeout} onChange={(e) => setTimeout(Number(e.target.value))} /></Field>
          <Field label="대량 대기시간(초)"><input className="input" type="number" value={cooldown} onChange={(e) => setCooldown(Number(e.target.value))} /></Field>
        </div>
        <div className="row">
          <button className="btn primary" data-tour="slots-test" disabled={queueBusy || busy} onClick={() => smartQueue("1개 테스트 작성", { max: 1, q, template })}>{queueBusy ? "큐 등록 중..." : "1개 테스트 작성"}</button>
          <button className="btn" disabled={queueBusy || busy} onClick={() => smartQueue("현재 검색 10개 작성", { max: 10, q, template })}>현재 검색 10개 작성</button>
          <button className="btn" disabled={queueBusy || busy} onClick={() => smartQueue("전국 골고루 100개 작성", { max: 100, balanced: true })}>전국 골고루 100개 작성</button>
        </div>
        <div className="row">
          <label className="row small"><input type="checkbox" checked={web} onChange={(e) => setWeb(e.target.checked)} /> 웹 자료 수집 후 작성</label>
          <label className="row small"><input type="checkbox" checked={imageGen} onChange={(e) => { const checked = e.target.checked; setImageGen(checked); setTimeout((value) => recommendedGenerationTimeoutSec(checked, value)); }} /> Codex 이미지 생성</label>
          <Field label="이미지 크기"><select className="select" value={imageSize} onChange={(e) => setImageSize(e.target.value)}><option value="1024x1024">1024 정방형</option><option value="1536x1024">1536 가로형</option><option value="1024x1536">1024 세로형</option></select></Field>
        </div>
        <div className="writer-hint"><b>작성 옵션</b><span>{provider}{model ? ` / ${model}` : " / 기본"}</span><span>디자인 {designSettingLabel(domain.design_template_id)}</span><span>웹자료 {web ? "사용" : "미사용"}</span><span>이미지 {imageGen ? `생성 / ${imageSize}` : "미사용"}</span><span>제한 {effectiveTimeout}초</span><span>선택 기준 예상 {expectedMinutes}분</span></div>
        <p className="muted small">추천: 1개 테스트 작성 → QA 확인 → 현재 검색 10개 → 전국 골고루 100개. 작성 대상은 무작위가 아니라 우선순위(검색량·경쟁도·weight) 상위 N개를 고르며, 전국 작성은 지역을 라운드로빈으로 섞습니다.</p>
      </div>

      <div className="card card-pad grid" data-tour="slots-list">
        <div data-tour="slots-list-head">
          <p className="eyebrow">후보 목록</p>
          <h2>후보 검색·선택</h2>
          <p className="muted small">아래 필터는 목록 표시와 「현재 검색 N개 작성」 선별에 쓰입니다.</p>
        </div>
        <div className="row" data-tour="slots-filter">
          <select className="select" style={{ width: 150 }} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">전체 상태</option>{["planned","in_progress","published","failed","skipped"].map((s) => <option key={s}>{s}</option>)}</select>
          <select className="select" style={{ width: 200 }} value={template} onChange={(e) => setTemplate(e.target.value)}><option value="">전체 유형</option>{typeFilterOptions.map((o) => <option key={o.id} value={o.id}>{o.id} {o.name}</option>)}</select>
          <input className="input" style={{ width: 320 }} placeholder="지역/키워드/후보 검색 예: 서울, 강남구" value={q} onChange={(e) => setQ(e.target.value)} />
          {["서울","강남구","송파구","경기","부산","대구","제주"].map((label) => <button className="btn" key={label} onClick={() => setQ(label)}>{label}</button>)}
          <span className="muted small">{selected.size}개 선택 / {remoteTotal.toLocaleString()}개{loadingSlots ? " 검색 중" : ""}</span>
          <button className="btn primary" disabled={!selected.size || queueBusy || busy} onClick={() => queue(Array.from(selected))}>{queueBusy ? "큐 등록 중..." : "선택 글 작성"}</button>
          <button className="btn danger" disabled={!selected.size || busy || queueBusy} onClick={delSelected}>{busy ? "삭제 중..." : "삭제"}</button>
        </div>
        {slotError && <p className="small" style={{ color: "var(--danger)" }}>후보 검색 오류: {slotError}</p>}
        <div className="table-wrap">
          <table>
            <thead><tr><th><input type="checkbox" checked={selectedAllVisible} onChange={toggleAllVisible} /></th><th>유형</th><th>키워드</th><th>지역</th><th>페르소나</th><th>점수</th><th>제목(수동)</th><th>상태</th></tr></thead>
            <tbody>{filtered.map((s) => <tr key={s.slot_id}><td><input type="checkbox" checked={selected.has(s.slot_id)} onChange={() => setSelected((p) => { const n = new Set(p); n.has(s.slot_id) ? n.delete(s.slot_id) : n.add(s.slot_id); return n; })} /></td><td><span className="badge">{s.template_id}</span></td><td><b>{s.primary_keyword}</b><p className="muted small mono">{s.slot_id}</p>{s.last_error && <p className="small" style={{ color: "var(--danger)" }}>{s.last_error}</p>}</td><td>{s.region ?? "-"}</td><td>{s.persona ?? "-"}</td><td>{s.priority_score?.toFixed(1) ?? "-"}</td><td><SlotTitleCell domain={domain.domain} slot={s} onSaved={applySlotTitle} /></td><td><Status status={s.status} /></td></tr>)}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// 슬롯 수동 제목 오버라이드 셀. 비우면 규칙/LLM 자동. 원문 저장({지역}/{개수} 등은 생성 시점 치환).
function SlotTitleCell({ domain, slot, onSaved }: { domain: string; slot: Slot; onSaved: (slotId: string, title: string | null) => void }) {
  const [draft, setDraft] = useState(slot.title ?? "");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setDraft(slot.title ?? ""); }, [slot.title]);
  const dirty = (slot.title ?? "") !== draft.trim();
  async function save() {
    setBusy(true);
    try { const r = await updateSlotTitle(domain, slot.slot_id, draft.trim() || null); onSaved(slot.slot_id, r.slot.title); }
    catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return <div className="row" style={{ gap: 4, minWidth: 200 }}>
    <input className="input" style={{ minWidth: 160 }} value={draft} placeholder="규칙/LLM 자동" disabled={busy}
      title="비우면 규칙/LLM 자동 제목. 입력하면 규칙보다 우선합니다. {지역}/{개수}/{키워드}/{학원명} 은 생성 시점에 치환됩니다."
      onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && dirty && !busy) void save(); }} />
    {dirty && <button type="button" className="btn small primary" disabled={busy} onClick={() => void save()}>{busy ? "..." : "저장"}</button>}
  </div>;
}

function Jobs({ domain, jobs, onRefresh }: { domain: DomainConfig; jobs: Job[]; onRefresh: () => Promise<void> }) {
  const [status, setStatus] = useState("");
  useEffect(() => {
    const id = window.setInterval(() => onRefresh().catch(() => undefined), 3000);
    return () => window.clearInterval(id);
  }, [onRefresh]);
  const filtered = jobs.filter((job) => !status || job.status === status);
  const counts = jobs.reduce<Record<string, number>>((acc, job) => {
    acc[job.status] = (acc[job.status] ?? 0) + 1;
    return acc;
  }, {});
  const active = (counts.queued ?? 0) + (counts.running ?? 0);
  return <div className="grid">
    <div className="card card-pad grid" data-tour="jobs-board">
      <div className="spread"><div><h2>작업 상태판</h2><p className="muted">글 작성/중복검사/가지치기/색인 작업을 이 화면에서 바로 확인합니다. 3초마다 자동 새로고침됩니다.</p></div><button className="btn" onClick={onRefresh}>새로고침</button></div>
      <div className="grid grid-4"><Stat label="대기" value={counts.queued ?? 0} /><Stat label="진행" value={counts.running ?? 0} /><Stat label="완료" value={counts.done ?? 0} accent /><Stat label="실패" value={counts.failed ?? 0} /></div>
      <div className="writer-hint"><b>운영 순서</b><span>글 생성 탭에서 작성 등록</span><span>작업 큐 탭에서 진행 확인</span><span>완료 후 검수·내보내기 탭에서 검수</span><span>필요 시 npm run worker:once</span></div>
      {active > 0 && <p className="muted small">대기/진행 작업이 멈춰 있으면 서버 터미널에서 <code>npm run worker:once</code>를 실행해 처리할 수 있습니다.</p>}
    </div>
    <div className="row">
      <select className="select" style={{ width: 180 }} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">전체 상태</option>{["queued", "running", "done", "failed"].map((s) => <option key={s}>{s}</option>)}</select>
      <span className="muted small">{filtered.length}개 표시 / 전체 {jobs.length}개</span>
      <Link href="/jobs" className="btn">전체 작업 큐 열기</Link>
    </div>
    {filtered.length === 0 && <div className="card card-pad muted">아직 작업이 없습니다. 글 생성 탭에서 “1개 테스트 작성”부터 등록하세요.</div>}
    <div className="grid">{filtered.map((job) => <JobCard key={job.id} job={job} designFallback={domain.design_template_id} onChanged={onRefresh} />)}</div>
  </div>;
}

function Posts({ domain, posts, onRefresh }: { domain: DomainConfig; posts: PostSummary[]; onRefresh: () => Promise<void> }) {
  const [selected, setSelected] = useState(new Set<string>()); const [q, setQ] = useState(""); const [busy, setBusy] = useState(false);
  const jobFilter = useSearchParams().get("job"); // 작업 큐에서 "이 작업 글 보기"로 넘어오면 그 작업 글만 본다.
  // 작업 필터가 있으면 (스냅샷이 아니라) 서버에서 그 작업 글을 직접 조회한다.
  const [jobPosts, setJobPosts] = useState<PostSummary[] | null>(null);
  useEffect(() => {
    if (!jobFilter) { setJobPosts(null); return; }
    let cancelled = false;
    listPosts(domain.domain, { jobId: jobFilter, limit: 500 })
      .then((res) => { if (!cancelled) setJobPosts(res.items); })
      .catch(() => { if (!cancelled) setJobPosts([]); });
    return () => { cancelled = true; };
  }, [jobFilter, domain.domain]);
  const scoped = jobFilter ? (jobPosts ?? []) : posts;
  const filtered = scoped.filter((p) => !q || `${p.title} ${p.slug}`.toLowerCase().includes(q.toLowerCase()));
  // 검색어/목록/작업필터가 바뀌면 화면에서 사라진 선택은 정리한다(안 보이는 글을 export/삭제하는 사고 방지).
  useEffect(() => {
    setSelected((prev) => {
      if (!prev.size) return prev;
      const visible = new Set(filtered.map((p) => p.id));
      const next = new Set<string>();
      for (const id of prev) if (visible.has(id)) next.add(id);
      return next.size === prev.size ? prev : next;
    });
  }, [q, posts, jobFilter]);
  async function job(kind: "dedup" | "prune" | "indexing") { if (busy) return; setBusy(true); try { const path = kind === "indexing" ? "indexing" : kind; await api(`/domains/${encodeURIComponent(domain.domain)}/jobs/${path}`, { method: "POST", body: JSON.stringify(kind === "dedup" ? { threshold: 0.75 } : kind === "prune" ? { min_body_chars: 700, stale_noindex_days: 90 } : { max: 200 }) }); alert(`${kind} 작업 등록`); } catch (err) { alert(err instanceof Error ? err.message : String(err)); } finally { setBusy(false); } }
  async function delSelected() { if (busy || !confirm(`${selected.size}개 삭제?`)) return; setBusy(true); try { for (const id of selected) await api(`/domains/${encodeURIComponent(domain.domain)}/posts/${id}`, { method: "DELETE" }); setSelected(new Set()); await onRefresh(); } catch (err) { alert(err instanceof Error ? err.message : String(err)); } finally { setBusy(false); } }
  async function exportSelected(format: "markdown" | "html") {
    if (busy) return; setBusy(true);
    try {
      const blob = await downloadPostExport(domain.domain, { post_ids: Array.from(selected), format });
      downloadBlob(blob, `${domain.domain}-posts-${format}.zip`);
    } catch (err) { alert(err instanceof Error ? err.message : String(err)); } finally { setBusy(false); }
  }
  const postCost = (p: PostSummary) => (p.cost_usd || 0) + (p.image_cost_usd || 0);
  const aggImgs = scoped.reduce((sum, p) => sum + (p.image_count || 0), 0);
  const aggCost = scoped.reduce((sum, p) => sum + postCost(p), 0);
  return <div className="grid" data-tour="posts-review">
    {jobFilter && <div className="card card-pad spread">
      <div><b>작업 필터</b> <span className="mono small">{jobFilter}</span>
        <p className="muted small">{scoped.length}개 글 · 이미지 {aggImgs}장(평균 {scoped.length ? (aggImgs / scoped.length).toFixed(1) : "0"}장) · 비용 ${aggCost.toFixed(3)} (평균 ${scoped.length ? (aggCost / scoped.length).toFixed(3) : "0"}/건, 텍스트+이미지)</p>
      </div>
      <Link className="btn" href={`/t/${encodeURIComponent(domain.domain)}/posts`}>필터 해제</Link>
    </div>}
    <div className="row" data-tour="posts-actions"><input className="input" style={{ width: 260 }} placeholder="제목/슬러그 검색" value={q} onChange={(e) => setQ(e.target.value)} /><span className="muted small">{selected.size}개 선택 / {filtered.length}개</span>{busy && <span className="muted small">처리 중...</span>}<button className="btn" onClick={() => job("dedup")} disabled={posts.length < 2 || busy}>중복 검사</button><button className="btn" onClick={() => job("prune")} disabled={!posts.length || busy}>가지치기</button><button className="btn" onClick={() => job("indexing")} disabled={!posts.length || busy}>색인 요청</button><button className="btn" onClick={() => exportSelected("markdown")} disabled={!selected.size || busy}>Markdown Export</button><button className="btn primary" onClick={() => exportSelected("html")} disabled={!selected.size || busy}>HTML Export</button><button className="btn danger" onClick={delSelected} disabled={!selected.size || busy}>삭제</button></div>
    {scoped.length > 0 && aggCost === 0 && <p className="muted small">비용($)은 종량 API 사용 시에만 계측됩니다. 이미지는 OpenAI 이미지 API + <code>SEO_IMAGE_PRICE_USD</code>(장당 단가) 설정, 텍스트는 API LLM이 필요합니다. Codex/구독 경로는 $0으로 표시됩니다.</p>}
    <div className="table-wrap"><table><thead><tr><th><input type="checkbox" checked={filtered.length > 0 && selected.size === filtered.length} onChange={() => setSelected(selected.size === filtered.length ? new Set() : new Set(filtered.map((p) => p.id)))} /></th><th>제목</th><th>디자인</th><th>자수</th><th>이미지</th><th>provider</th><th>비용$</th><th>생성일</th></tr></thead><tbody>{filtered.map((p) => <tr key={p.id}><td><input type="checkbox" checked={selected.has(p.id)} onChange={() => setSelected((prev) => { const n = new Set(prev); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n; })} /></td><td><Link href={`/t/${encodeURIComponent(domain.domain)}/post/${p.id}`}><b>{p.title}</b></Link><p className="muted small mono">{p.slug}</p></td><td><span className="badge">{p.design_template_id ?? domain.design_template_id}</span></td><td>{p.body_chars?.toLocaleString()}</td><td>{p.image_count ?? 0}</td><td>{p.provider}</td><td>{postCost(p) ? postCost(p).toFixed(3) : "-"}</td><td className="small muted">{formatDateTime(p.generated_at)}</td></tr>)}</tbody></table></div></div>;
}

// 전역 빌트인 노출 편집(검증용 임시). 체크한 빌트인만 카탈로그/시작점/아키타입 목록에 노출. 모든 도메인 공통.
function BuiltinVisibilityCard({ options, onRefresh }: { options: AdminOptions; onRefresh: () => Promise<void> }) {
  const allIds = useMemo(() => Object.keys(options.template_specs), [options.template_specs]);
  const [visible, setVisible] = useState<Set<string>>(() => new Set(options.exposed_builtin_template_ids ?? allIds));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { setVisible(new Set(options.exposed_builtin_template_ids ?? allIds)); }, [options.exposed_builtin_template_ids, allIds]);
  const toggle = (id: string) => setVisible((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  async function save() {
    setBusy(true); setErr("");
    try {
      const ids = allIds.filter((id) => visible.has(id));
      // 명시 목록을 그대로 저장(전부 체크도 명시 저장). 저장 안 하면 기본값 T01 만 노출.
      await setBuiltinVisibility(ids);
      await onRefresh();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return <div className="card card-pad grid">
    <div className="spread"><div><h2>빌트인 글유형 노출 <span className="badge info">전역 · 임시</span></h2><p className="muted small">체크한 빌트인만 「글유형/디자인」 탭의 <b>빌트인 추가</b> 카탈로그·커스텀 <b>시작점</b>·<b>참조 아키타입</b> 목록에 노출됩니다. <b>모든 도메인 공통</b>이며, 이미 켜 둔 유형의 생성에는 영향이 없습니다(노출만 제어). 유형 검증이 끝나면 제거할 임시 기능입니다.</p></div><span className="badge info">{visible.size}/{allIds.length}</span></div>
    <div className="grid grid-2" style={{ gap: 6 }}>
      {allIds.map((id) => <label key={id} className="row small" style={{ gap: 8, cursor: "pointer" }}><input type="checkbox" checked={visible.has(id)} onChange={() => toggle(id)} /><span className="badge">{id}</span> <span>{options.template_specs[id]?.name}</span></label>)}
    </div>
    {err && <p className="toast-warn small">{err}</p>}
    <div className="row"><button className="btn primary" disabled={busy} onClick={save}>{busy ? "저장 중..." : "노출 저장"}</button><button className="btn" disabled={busy} onClick={() => setVisible(new Set(allIds))}>전체 노출</button></div>
  </div>;
}

function Settings({ domain, options, onSave, onRefresh }: { domain: DomainConfig; options: AdminOptions; onSave: (f: Record<string, unknown>) => Promise<void>; onRefresh: () => Promise<void> }) {
  const [form, setForm] = useState({ display_name: domain.display_name, brand_name: domain.brand_name ?? "", vertical: domain.vertical, brand_color: domain.brand_color ?? "#2563eb", daily_limit: domain.daily_limit });
  // 저장될 실제 공개 브랜드명(빈 brand_name 은 표시 이름으로 폴백)을 대상으로 경고를 계산한다.
  const effectiveBrand = publicBrandName({ brand_name: form.brand_name, display_name: form.display_name });
  const brandWarnings = brandNameWarnings(effectiveBrand);
  const [delBusy, setDelBusy] = useState(false);
  const previewTheme = getDesignTheme(domain.design_template_id, form.brand_color);
  async function deleteDomain() { if (delBusy || !confirm("정말 삭제할까요? 모든 데이터가 삭제됩니다.")) return; setDelBusy(true); try { await api(`/domains/${encodeURIComponent(domain.domain)}`, { method: "DELETE" }); location.href = "/"; } catch (err) { setDelBusy(false); alert(err instanceof Error ? err.message : String(err)); } }
  return <div className="grid"><div className="card card-pad grid"><h2>도메인 정보</h2><Field label="표시 이름 (관리자 전용)"><input className="input" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} placeholder="예: 평택 운영본" /></Field><p className="muted small">도메인 목록·상단 전환 메뉴에서 이 도메인을 구분하는 이름입니다. 글에는 나오지 않으니 운영 편한 대로 적어도 됩니다.</p><Field label="브랜드명 (글에 노출)"><input className="input" value={form.brand_name} onChange={(e) => setForm({ ...form, brand_name: e.target.value })} placeholder={form.display_name || "예: 운전면허플러스"} /></Field><p className="muted small">생성 글 본문·CTA·HTML 내보내기·공개 API에 나가는 이름입니다. 마지막 섹션 CTA에서 3~7회 언급되므로 독자가 브랜드로 읽을 수 있는 고유명이어야 합니다. 비워 두면 표시 이름(<b>{effectiveBrand}</b>)이 그대로 쓰입니다.</p>{brandWarnings.map((warning) => <p className="toast-warn small" key={warning}>{warning}</p>)}<div className="grid grid-2"><Field label="업종 (생성 후 변경 불가)"><input className="input" value={options.verticals.find((v) => v.key === form.vertical)?.label ?? form.vertical} readOnly disabled /></Field></div><div className="grid grid-2"><Field label="브랜드 컬러"><div className="row"><input className="input-color" type="color" value={form.brand_color} onChange={(e) => setForm({ ...form, brand_color: e.target.value })} /><code className="mono small">{form.brand_color}</code></div></Field><Field label="일일 한도 (0=무제한)"><input className="input" type="number" min={0} value={form.daily_limit} onChange={(e) => setForm({ ...form, daily_limit: Math.max(0, Number(e.target.value) || 0) })} /></Field></div><div className="brand-color-preview" style={{ ["--accent" as string]: previewTheme.accent, ["--accent-soft" as string]: previewTheme.soft, ["--primary" as string]: previewTheme.accent }}><div className="preview-top"><b>브랜드 컬러 미리보기</b><span className="preview-cta">CTA</span></div><div className="preview-bottom-cta"><b>하단 CTA 영역</b><button type="button" className="btn primary">버튼</button></div></div><p className="muted small">미리보기·발행 글·외부 사이트 CTA에 이 색이 반영됩니다. 저장 후 글 유형/디자인 탭에서도 확인하세요.</p>{!form.display_name.trim() && <p className="toast-warn small">표시 이름을 입력하세요.</p>}<button className="btn primary" disabled={!form.display_name.trim()} onClick={() => onSave(form)}>저장</button></div><BuiltinVisibilityCard options={options} onRefresh={onRefresh} /><div className="card card-pad grid" style={{ opacity: 0.65 }}><div className="row" style={{ gap: 8, alignItems: "center" }}><h2 style={{ margin: 0 }}>구글 색인</h2><span className="badge warn">비활성 · 추후 지원</span></div><p className="muted small">발행 글을 Google Indexing API로 색인 요청하는 기능입니다. 배포 연동 방식이 정해지면 활성화 예정이며, 현재는 동작하지 않습니다. (서비스계정 JSON은 전 도메인 공통으로 관리될 예정)</p><label><span className="label">서비스계정 JSON</span><textarea className="textarea mono" rows={2} disabled placeholder="추후 지원 예정" /></label><label><span className="label">발행 URL 템플릿</span><input className="input mono" disabled placeholder="https://{domain}/community/{slug} (추후 지원)" /></label><div className="row"><button className="btn primary" disabled>색인 설정 저장</button></div></div><div className="card card-pad grid"><h2>도메인 삭제</h2><p className="muted small">이 도메인과 모든 후보·글 데이터가 함께 삭제됩니다. 되돌릴 수 없습니다.</p><button className="btn danger" disabled={delBusy} onClick={deleteDomain}>{delBusy ? "삭제 중..." : "도메인 삭제"}</button></div></div>;
}

function DesignPreview({ blueprint, designId, designOption, brandColor, brand, title, summary }: { blueprint: typeof DESIGN_BLUEPRINTS[string]; designId: string; designOption?: DesignTemplateOption; brandColor?: string | null; brand: string; title: string; summary: string }) {
  const spec = PREVIEW_DESIGN_SPECS[designId] ?? PREVIEW_DESIGN_SPECS.editorial;
  const theme = previewThemeFor(designId, brandColor, designOption);
  const previewStyle = {
    ["--accent" as string]: theme.accent,
    ["--accent-soft" as string]: theme.soft,
    ["--primary" as string]: theme.accent,
    ["--preset-radius" as string]: theme.radius,
    background: theme.pageBg,
  };
  return <aside className="preview-panel">
    <div className="preview-head"><div><b>디자인 미리보기</b><p className="muted small">{blueprint.label}</p></div><span className="badge info">{designId}</span></div>
    <div className={`preview-phone design-${designId}`} style={previewStyle}>
      <div className="preview-top"><div><b>{brand}</b><p>{blueprint.tone}</p></div><span className="preview-cta">{spec.topCta}</span></div>
      <div className="preview-hero"><span>대표 영역</span></div>
      <div className="preview-body">
        <div className="preview-meta"><span>26.04.03</span><span>조회 0</span></div>
        <h4>{blueprint.title}</h4>
        <div className="preview-divider" />
        <div className="row">{blueprint.chips.map((chip, index) => <span className="badge" key={`${chip}-${index}`}>{chip}</span>)}</div>
        <p className="muted small">{blueprint.lead}</p>
        {blueprint.blocks.map((block, index) => <PreviewBlock key={`${block.title}-${index}`} block={block} />)}
        <section className="preview-bottom-cta"><b>{brand}에서 {spec.bottomCta}</b><button className="btn primary">{spec.bottomCta}</button></section>
      </div>
    </div>
    <div className="card card-pad preview-spec">
      <h3>{title}</h3>
      <p className="muted small">{summary}</p>
      <p className="small"><b>톤:</b> {blueprint.tone}</p>
      <div className="row">{blueprint.sections.map((s, index) => <span className="badge" key={`${s}-${index}`}>{s}</span>)}</div>
    </div>
  </aside>;
}

function previewThemeFor(designId: string, brandColor: string | null | undefined, option?: DesignTemplateOption): { accent: string; soft: string; pageBg: string; radius: string } {
  const base = getDesignTheme(designId, brandColor);
  const cssTokens = option?.css_tokens && typeof option.css_tokens === "object" ? option.css_tokens : {};
  const colors = Array.isArray(cssTokens.colors) ? cssTokens.colors.map((v) => String(v)).filter(isCssColorToken) : [];
  const radii = Array.isArray(cssTokens.radii) ? cssTokens.radii.map((v) => String(v).trim()).filter(isPreviewCardRadius) : [];
  const vars = cssTokens.vars && typeof cssTokens.vars === "object" ? cssTokens.vars as Record<string, unknown> : {};
  const accent = pickCssVar(vars, ["brand", "teal", "primary", "accent"], colors, base.accent);
  const soft = pickCssVar(vars, ["brand-soft", "teal-soft", "surface", "sand"], colors.filter((color) => color !== accent), `color-mix(in srgb, ${accent} 12%, white)`);
  const pageBg = pickCssVar(vars, ["paper", "bg", "background", "card"], colors, base.pageBg);
  return { accent, soft, pageBg, radius: radii[0] || "24px" };
}

function isCssColorToken(value: string): boolean {
  return /^#[0-9a-fA-F]{3,8}$/.test(value) || /^rgba?\([^)]+\)$/.test(value);
}

function pickAccentColor(colors: string[], fallback: string): string {
  return colors.find((color) => isSaturatedHex(color)) || colors.find((color) => !isSoftColor(color)) || fallback;
}

function pickCssVar(vars: Record<string, unknown>, names: string[], fallbackColors: string[], fallback: string): string {
  for (const name of names) {
    const value = vars[name];
    if (typeof value === "string" && isCssColorToken(value)) return value;
  }
  if (names.some((name) => /soft|surface|sand|paper|bg|card/.test(name))) {
    return fallbackColors.find(isSoftColor) || fallbackColors[0] || fallback;
  }
  return pickAccentColor(fallbackColors, fallback);
}

function isSoftColor(color: string): boolean {
  if (!color.startsWith("#")) return false;
  const rgb = hexToRgb(color);
  if (!rgb) return false;
  return rgb.r > 225 && rgb.g > 225 && rgb.b > 225;
}

function isSaturatedHex(color: string): boolean {
  const rgb = hexToRgb(color);
  if (!rgb) return false;
  const max = Math.max(rgb.r, rgb.g, rgb.b);
  const min = Math.min(rgb.r, rgb.g, rgb.b);
  return max - min > 55 && max > 120 && min < 230;
}

function hexToRgb(color: string): { r: number; g: number; b: number } | null {
  const hex = color.replace("#", "");
  const full = hex.length === 3 ? hex.split("").map((v) => v + v).join("") : hex.slice(0, 6);
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return { r: parseInt(full.slice(0, 2), 16), g: parseInt(full.slice(2, 4), 16), b: parseInt(full.slice(4, 6), 16) };
}

function isPreviewCardRadius(value: string): boolean {
  if (/%|999|calc|var/i.test(value)) return false;
  const px = Number(value.match(/^(\d+(?:\.\d+)?)px$/)?.[1]);
  return Number.isFinite(px) && px >= 6 && px <= 32;
}

function PreviewBlock({ block }: { block: typeof DESIGN_BLUEPRINTS[string]["blocks"][number] }) {
  if (block.kind === "table") return <div className="preview-block"><b>{block.title}</b><div className="mini-table"><span>항목</span><span>장점</span><span>추천</span><span>A 학원</span><span>셔틀</span><span>직장인</span><span>B 학원</span><span>단기반</span><span>대학생</span></div><p>{block.body}</p></div>;
  if (block.kind === "quote") return <blockquote className="preview-quote">{block.body}</blockquote>;
  if (block.kind === "cta") return <div className="preview-block preview-cta-block"><b>{block.title}</b><p>{block.body}</p><button className="btn primary">상담/예약으로 연결</button></div>;
  if (block.kind === "list") return <div className="preview-block"><b>{block.title}</b><ul>{block.body.split("|").map((item, index) => <li key={`${item}-${index}`}>✓ {item}</li>)}</ul></div>;
  return <div className="preview-block"><b>{block.title}</b><p>{block.body}</p></div>;
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) { return <div className="card stat"><div className="muted small">{label}</div><div className="num" style={{ color: accent ? "var(--success)" : undefined }}>{value}</div></div>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label><span className="label">{label}</span>{children}</label>; }
function Status({ status }: { status: string }) { const cls = status === "published" || status === "done" ? "success" : status === "failed" ? "danger" : status === "running" || status === "in_progress" ? "info" : status === "planned" || status === "queued" ? "warn" : ""; return <span className={`badge ${cls}`}>{status}</span>; }
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
function parseLines(text: string) { return Array.from(new Set(text.split(/[\n,]/).map((v) => v.trim()).filter(Boolean))); }
function parseCsv(text: string): AxisValue[] { return text.split(/\n/).map((line) => line.trim()).filter(Boolean).map((line) => { const [value, weight, sv, kd] = line.split(",").map((x) => x.trim()); return { value, weight: Number(weight || 3), monthly_search_volume: sv ? Number(sv) : null, competition_kd: kd ? Number(kd) : null }; }).filter((v) => v.value); }
function parsePhotoCount(value: unknown): number {
  if (!value) return 0;
  if (Array.isArray(value)) return value.length;
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch { return 0; }
}
function parseJsonCount(value: unknown): number {
  if (!value) return 0;
  if (Array.isArray(value)) return value.length;
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch { return 0; }
}

// 전역 행정구역 사전(읍·면·동). 1·2단계와 달리 도메인별 운영 선택이 아니라 전역 사실 참조라
// 번호를 붙이지 않는다. 번호를 달면 "새 도메인마다 해야 하는 일"로 읽히는데, 실제로는
// 도메인 생성 시 자동으로 준비되고 행정구역 개편 때만 갱신하면 된다.
const RESEARCH_USAGE_CHOICES = [
  {
    value: "off",
    label: "사용 안 함",
    help: "조사값을 글에 전혀 쓰지 않습니다. 글은 원천 동기화로 받은 학원 자료(주소·전화·수강료·셔틀·영업시간·운영 과정·운영 형태·사진 등)와 자체 수강생 후기만 근거로 씁니다.",
  },
  {
    value: "verified",
    label: "검증완료만",
    help: "위 원천 자료·후기에 더해, 조사값 중에서는 사람이 학원 상세 화면에서 「검증완료」로 올린 것만 씁니다. AI가 조사한 채로 둔 값은 쓰지 않습니다.",
  },
  {
    value: "draft",
    label: "AI 초안까지",
    help: "위 원천 자료·후기에 더해, 사람이 확인하지 않은 AI 조사값까지 씁니다. 검사에 걸리지 않았을 뿐 사실 확인은 안 된 값입니다.",
  },
] as const;

// 심층조사 현황(읽기 전용). 조사는 학원 자체의 속성이라 도메인마다 돌리면 같은 학원을
// 도메인 수만큼 다시 조사하게 된다. 그래서 실행은 자료관리에서 전역으로 하고 여기선 현황만 본다.
function ResearchSummaryCard({ domain, usage, busy, onSave }: { domain: string; usage: "off" | "verified" | "draft"; busy: boolean; onSave: (f: Record<string, unknown>) => Promise<void> }) {
  const [summary, setSummary] = useState<ResearchSummary | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    getResearchSummary(domain)
      .then((s) => { if (alive) setSummary(s); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [domain]);

  const total = summary?.total ?? 0;
  const researched = summary?.researched ?? 0;
  const percent = total ? Math.round((researched / total) * 100) : 0;

  return (
    <div className="card card-pad grid compact-pad" style={{ background: "#f8fafc" }}>
      <div className="spread">
        <div>
          <h3 style={{ margin: 0 }}>심층조사 현황</h3>
          <p className="muted small">
            원천에 없는 항목(편의시설·자체 시험장·야간반·설립연도 등)을 공개 자료에서 조사해 둡니다.
            조사는 학원 단위라 도메인마다 따로 돌리지 않습니다 — 실행은 자료관리에서 합니다.
          </p>
        </div>
        <Link className="btn" href="/academies">자료관리로 이동</Link>
      </div>
      {failed
        ? <p className="muted small">조사 현황을 불러오지 못했습니다.</p>
        : !summary
          ? <p className="muted small">불러오는 중...</p>
          : <>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <span className="badge info">이 도메인 학원 {total.toLocaleString()}곳</span>
                <span className="badge">조사 완료 {researched.toLocaleString()}곳 ({percent}%)</span>
                <span className="badge">미조사 {(total - researched).toLocaleString()}곳</span>
                {summary.needs_review > 0 && <span className="badge warn">검토 필요 {summary.needs_review.toLocaleString()}건</span>}
              </div>
              <p className="muted small">
                {summary.last_researched_at ? `최근 조사: ${formatDateTime(summary.last_researched_at)}` : "아직 조사한 학원이 없습니다."}
                {summary.matched < total ? ` · 조사 DB에 없는 학원 ${(total - summary.matched).toLocaleString()}곳(자료관리에서 동기화 필요)` : ""}
              </p>
            </>}
      {/* 사용 여부는 이 도메인이 정한다(자료는 업종 자산, 사용 결정은 도메인).
          승인 도구를 새로 만들지 않고 필드 검증상태를 그대로 관문으로 쓴다. */}
      <div className="grid" style={{ gap: 6, borderTop: "1px solid var(--line, #e5e7eb)", paddingTop: 10 }}>
        <b className="small">글 생성에 사용</b>
        <div className="row" style={{ gap: 14, flexWrap: "wrap" }}>
          {RESEARCH_USAGE_CHOICES.map((choice) => (
            <label key={choice.value} className="row small" style={{ gap: 4, alignItems: "center" }}>
              <input
                type="radio"
                name={`research-usage-${domain}`}
                checked={usage === choice.value}
                disabled={busy}
                onChange={() => onSave({ research_usage: choice.value })}
              />
              {choice.label}
            </label>
          ))}
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          {RESEARCH_USAGE_CHOICES.find((c) => c.value === usage)?.help}
        </p>
        <p className="muted small" style={{ margin: 0 }}>
          어느 설정에서도 <b>「검토 필요」</b>(수집한 근거에서 확인되지 않았거나 그 항목에 담기면 안 되는 값)와
          <b> 「웹조사 차단」</b> 값은 쓰이지 않습니다. 조사 대상이 아니었던 항목(원천 자료가 이미 있는 수강료·셔틀 등)도 마찬가지입니다.
        </p>
        <p className="small" style={{ color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 10px", margin: 0 }}>
          ⚠️ 조사값은 아직 글 생성에 연결되지 않았습니다. 이 설정은 연결되는 시점부터 적용됩니다.
        </p>
      </div>
    </div>
  );
}

function RegionDirectoryCard({ domain }: { domain: string }) {
  const [status, setStatus] = useState<RegionDirectoryStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    let alive = true;
    getRegionDirectory(domain).then((s) => { if (alive) setStatus(s); }).catch(() => { if (alive) setStatus(null); });
    return () => { alive = false; };
  }, [domain]);

  const onSync = async () => {
    setBusy(true); setMsg("");
    try {
      const next = await syncRegionDirectory(domain);
      setStatus(next);
      setMsg(`${next.total.toLocaleString()}개 반영`);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "동기화에 실패했습니다.");
    } finally { setBusy(false); }
  };

  const sigungu = status?.by_level?.["2"] ?? 0;
  const submunicipal = status?.by_level?.["3"] ?? 0;
  const shuttle = status?.shuttle;

  return (
    <div className="card card-pad grid">
      <div className="spread">
        <h3 style={{ margin: 0 }}>공용 지역 사전</h3>
        <span className="badge info">전역 · 도메인 무관</span>
      </div>
      <p className="muted small">
        읍·면·동 단위 행정구역 목록입니다. 셔틀 안내문·정류장명에서 <b>어느 지역까지 셔틀이 오는지</b> 판별하는 데 씁니다.
        도메인과 무관한 공용 자료라 한 번 받으면 모든 도메인에 적용되고, <b>도메인을 만들 때 자동으로 준비</b>됩니다.
        아래 버튼은 행정구역이 개편됐을 때처럼 다시 받아야 할 때만 쓰면 됩니다.
      </p>
      {status
        ? <p className="small">
            시·군·구 <b>{sigungu.toLocaleString()}</b> · 읍·면·동 <b>{submunicipal.toLocaleString()}</b>
            {status.synced_at ? ` · 최근 ${formatDateTime(status.synced_at)}` : ""}
            {shuttle && shuttle.with_shuttle > 0
              ? ` — 이 도메인에서 셔틀 자료가 있는 학원 ${shuttle.with_shuttle.toLocaleString()}곳 중 ${shuttle.with_region.toLocaleString()}곳의 운행 지역을 확인했습니다.`
              : ""}
          </p>
        : <p className="muted small">사전 상태를 불러오지 못했습니다. 갱신을 눌러 다시 받아보세요.</p>}
      {status && status.total === 0 && (
        <p className="uploaded-notice" style={{ padding: "8px 12px", margin: 0 }}>
          ⚠️ 사전이 비어 있습니다. 셔틀 <b>운행 지역</b>만 빠지고 경유지·이용 조건은 그대로 나갑니다. 글 생성은 계속됩니다.
        </p>
      )}
      <div className="row">
        <button className="btn" disabled={busy} onClick={onSync}>{busy ? "갱신 중..." : "지역 사전 갱신"}</button>
        {msg && <span className="small muted">{msg}</span>}
      </div>
      <p className="muted small">
        갱신해도 <b>지역 축·학원 지역 배정은 바뀌지 않습니다</b>(1·2단계와 별도 표를 씁니다).
        셔틀 운행 지역은 학원자료 동기화 시점에 계산되므로, 사전을 새로 받은 뒤에는 2단계를 다시 실행해야 반영됩니다.
      </p>
    </div>
  );
}

