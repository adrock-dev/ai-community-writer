"use client";

import { api, cloneTemplate, createTemplate, deleteTemplate, downloadPostExport, enqueueGenerate, getCoherence, getDomainDetail, getOptions, getRuntimeApis, listAcademies, listPosts, listSlots, listTemplates, replaceAxis, suggestTemplateAxes, syncDrivingplusAcademies, syncDrivingplusRegions, updateDomain, updateTemplate } from "@/lib/api";
import { formatDateTime } from "@/lib/date";
import { designSettingLabel, getDesignTheme } from "@/lib/design-theme";
import { recommendedGenerationTimeoutSec, getGenerationDefaults } from "@/lib/generation-defaults";
import { rememberDomain } from "@/lib/recent-domain";
import { getSyncSummary, recordSync, type SyncSummary } from "@/lib/sync-summary";
import { JobCard } from "./JobCard";
import { isTourEnabled, isTourFocus, isTourMode, setTourEnabled, type TourFocus, type TourMode } from "@/lib/tour";
import type { Academy, AdminOptions, Axis, AxisValue, CoherenceTemplate, CustomTemplate, DesignTemplateOption, DomainConfig, DomainDetailPayload, Job, PostSummary, Provider, RuntimeApis, Slot, SlotCounts, TemplateSpec } from "@/lib/types";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
  ["overview", "개요"], ["plan", "공통 설정"], ["templates", "글유형/디자인"],
  ["academies", "원천 데이터"], ["slots", "글 생성"], ["jobs", "작업 큐"], ["posts", "검수·내보내기"], ["settings", "설정"],
] as const;

const TOUR_MODE_COPY: Record<TourMode, { label: string; short: string; desc: string }> = {
  basic: { label: "기본 글 생성", short: "기본", desc: "원천 데이터 → 후보 → 테스트 작성 → 검수만 따라가는 가장 쉬운 시작" },
  advanced: { label: "고급 후보 생성", short: "고급", desc: "기획, 글 유형, 디자인, 학원 타입까지 세밀하게 잡는 운영자용 흐름" },
  review: { label: "검수/내보내기", short: "검수", desc: "작업 상태와 완성 글을 확인하고 export/indexing으로 넘기는 마감 흐름" },
};

const STEP_GROUPS: Array<{ title: string; desc: string; steps: Array<{ mode: TourMode; focus: TourFocus; no: string; title: string; desc: string; tone?: "primary" }> }> = [
  {
    title: "기본 글 생성",
    desc: "처음 시작할 때 가장 안전한 최소 클릭 순서",
    steps: [
      { mode: "basic", focus: "workflow", no: "기본 1", title: "흐름 개요", desc: "기본 흐름 한눈에 보기", tone: "primary" },
      { mode: "basic", focus: "source", no: "기본 2", title: "원천 데이터 준비", desc: "지역/학원 자료부터 동기화" },
      { mode: "basic", focus: "slot-create", no: "기본 3", title: "글 후보 만들기", desc: "글유형·개수로 후보 생성" },
      { mode: "basic", focus: "test-write", no: "기본 4", title: "1개 테스트 작성", desc: "대량 작성 전 안전 확인" },
    ],
  },
  {
    title: "고급 후보 생성",
    desc: "기획과 생성 조건을 세밀하게 잡을 때",
    steps: [
      { mode: "advanced", focus: "workflow", no: "고급 1", title: "흐름 개요", desc: "고급 흐름 한눈에 보기", tone: "primary" },
      { mode: "advanced", focus: "plan", no: "고급 2", title: "공통원칙/제외어", desc: "공통 작성 원칙과 금지어 정리" },
      { mode: "advanced", focus: "template-design", no: "고급 3", title: "유형/디자인", desc: "글 종류와 디자인 선택" },
      { mode: "advanced", focus: "academy-types", no: "고급 4", title: "학원 타입 제한", desc: "추천에 쓸 원천 타입 제한" },
      { mode: "advanced", focus: "slot-filter", no: "고급 5", title: "후보 필터/확장", desc: "조건을 좁혀 후보 운영" },
    ],
  },
  {
    title: "검수/마감",
    desc: "생성 이후 확인, 내보내기, 색인 요청",
    steps: [
      { mode: "review", focus: "workflow", no: "검수 1", title: "흐름 개요", desc: "검수 흐름 한눈에 보기", tone: "primary" },
      { mode: "review", focus: "jobs", no: "검수 2", title: "작업 상태", desc: "대기·진행·실패 확인" },
      { mode: "review", focus: "posts", no: "검수 3", title: "완성 글 검수", desc: "미리보기/export/indexing" },
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

export default function DomainClient({ domain, view = "overview" }: { domain: string; view?: DomainPageView }) {
  const initialTab = view === "generate" ? "slots" : view === "posts" ? "posts" : "overview";
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

  function goToTourStep(mode: TourMode, focus?: TourFocus, opts: { overlay?: boolean } = {}) {
    // 항상 개요(intro) 단계를 포함한다. focus 는 해당 튜토리얼 단계로 그대로 매핑된다(개요=focus "workflow").
    const nextSteps = buildOperatorTourSteps(mode, payload?.slot_counts);
    const startIndex = focus ? Math.max(0, nextSteps.findIndex((step) => step.focus === focus || step.target === focus)) : 0;
    // 오버레이 없이 조용히 진입(튜토리얼 OFF)할 때, focus 없는 '흐름 시작'은 개요 탭(overview=현재 화면)이 아니라 첫 실작업 탭으로 보낸다.
    const landingIndex = opts.overlay === false ? (focus ? startIndex : Math.min(1, nextSteps.length - 1)) : startIndex;
    setTourMode(mode);
    setTab(nextSteps[landingIndex]?.tab ?? nextSteps[0]?.tab ?? "overview");
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
          <span className="badge">{domainConfig.vertical}</span>
          <span className="badge">{domainConfig.theme}</span>
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
          <p className="eyebrow">검수 전용 페이지</p>
          <h2>완성 글 확인, 내보내기, 색인 요청을 한곳에서 처리하세요</h2>
          <p className="muted">제목을 눌러 상세 미리보기를 확인하고 필요한 글만 선택해 Markdown/HTML로 내보내거나 색인 요청을 등록합니다.</p>
        </div>
        <Posts domain={domainConfig} posts={payload.posts ?? []} onRefresh={refresh} />
      </div>}

      {view === "overview" && tab === "overview" && <Overview domain={domainConfig} counts={counts} onTab={setTab} onStartFlow={startTour} />}
      {view === "overview" && tab === "plan" && <><Principles domain={domainConfig} busy={busy} onSave={saveDomain} onRefresh={refresh} onTab={setTab} /><KeywordMaster domain={domainConfig.domain} presetKey={domainConfig.vertical || "driving"} keywordAxis={(payload.axes?.keyword ?? []) as AxisValue[]} onRefresh={refresh} /></>}
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
  const sharedStart: TourStep = { focus: "workflow", tab: "overview", target: "workflow", title: `${TOUR_MODE_COPY[mode].label} 흐름을 먼저 봅니다`, body: `지금은 ${TOUR_MODE_COPY[mode].desc}입니다. 초록은 끝난 단계, 강조된 카드는 현재 단계라서 어디서 시작할지 바로 알 수 있습니다.`, action: "포커스되는 영역만 순서대로 따라가면 됩니다." };
  const sourceSync: TourStep = { focus: "source", tab: "academies", target: "academies-sync", title: "원천 데이터를 먼저 준비", body: "지역과 학원 데이터를 가져와야 생성 글이 검증된 자료를 기반으로 작성됩니다. 처음이면 지역 동기화 후 학원 동기화 순서를 권장합니다.", action: "데이터가 이미 있으면 다음 단계로 넘어가도 됩니다." };
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

  if (mode === "basic") {
    return [sharedStart, sourceSync, slotGenerate, testWrite, jobsBoard, postsReview];
  }

  if (mode === "review") {
    return [sharedStart, jobsBoard, postsReview];
  }

  const steps: TourStep[] = [
    sharedStart,
    { focus: "plan", tab: "plan", target: "plan-brief", title: "공통 원칙과 제외어를 저장", body: "모든 글 유형에 공통 적용될 안전·데이터 원칙과, 절대 넣지 말아야 할 키워드를 먼저 정합니다. 글 유형별 방향성은 「글유형/디자인」 탭의 커스텀 글유형에서 지정합니다.", action: "입력 후 ‘저장’을 누르고 다음으로 이동하세요." },
    { focus: "template-type", tab: "templates", target: "templates-types", title: "만들 글 유형 선택", body: "비교형, 지역형, 체크리스트형처럼 어떤 검색 의도에 맞출지 고릅니다. 켜고 끄면 즉시 저장됩니다. 너무 많이 켜면 후보가 빠르게 늘어나니 운영 초반엔 필요한 유형만 켜는 편이 안전합니다.", action: "필요한 유형만 켜세요. 커스텀 유형은 아래에서 만들어 함께 켤 수 있습니다." },
    { focus: "template-design", tab: "templates", target: "templates-design", title: "디자인 (자동 매칭)", body: "글 유형마다 기본 디자인이 자동으로 적용됩니다. 여기서는 디자인 종류를 참고하거나, 특별한 레이아웃이 필요하면 커스텀 디자인 메모를 남길 수 있습니다. 특정 글의 디자인을 바꾸려면 「커스텀 글유형」에서 그 유형을 복제해 조정하세요.", action: "대부분 그대로 두면 됩니다." },
    sourceSync,
    slotGenerate,
    { focus: "slot-filter", tab: "slots", target: "slots-filter", title: "후보 목록에서 조건 좁히기", body: "필터 줄에서 상태·유형·검색어로 범위를 줄입니다. 「현재 검색 10개 작성」도 이 조건 안에서 선별합니다.", action: "필요한 후보만 남긴 뒤 2단계 글 작성으로 넘어가세요." },
    testWrite,
    jobsBoard,
    postsReview,
  ];
  return steps;
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
  const steps = [
    { tab: "plan", title: "공통 설정", done: Boolean(domain.common_principles), count: domain.common_principles ? "완료" : "필요" },
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
        <p className="muted">처음 운영자는 기본 글 생성만 누르면 되고, 세부 조건을 만질 때만 고급 후보 생성을 쓰면 됩니다.</p>
      </div>
      <div className="grid grid-3">
        <FlowStartCard title="기본 글 생성" badge="추천" body="원천 데이터 → 1단계 후보 만들기 → 2단계 테스트 작성 → 검수까지 순서대로 안내합니다." cta="기본 흐름 시작" tone="primary" onClick={() => onStartFlow("basic")} />
        <FlowStartCard title="고급 후보 생성" badge="운영자용" body="기획·글유형·디자인·학원 타입·필터를 직접 조정하고 대량 후보로 확장합니다." cta="고급 흐름 시작" onClick={() => onStartFlow("advanced")} />
        <FlowStartCard title="검수/내보내기" badge="마감" body="작업 큐와 완성 글만 빠르게 확인해서 Markdown/HTML export와 색인 요청으로 넘깁니다." cta="검수 흐름 시작" onClick={() => onStartFlow("review")} />
      </div>
    </section>
    <StepLaunchPanel onStartFlow={onStartFlow} />
    <div className="grid grid-4">
      <Stat label="대기 후보" value={counts.planned} /><Stat label="진행" value={counts.in_progress} /><Stat label="발행" value={counts.published} accent /><Stat label="실패" value={counts.failed} />
    </div>
    <div className="grid grid-2">
      <div className="card card-pad"><h2>공통 작성 원칙</h2><p className="muted">{domain.common_principles || "아직 공통 원칙이 없습니다."}</p><button className="btn" onClick={() => onTab("plan")}>공통 설정 열기</button></div>
      <div className="card card-pad"><h2>글 유형/디자인</h2><p className="muted">글 유형 {domain.templates_enabled.length}개 · 디자인 {designSettingLabel(domain.design_template_id)}</p><button className="btn" onClick={() => onTab("templates")}>글유형/디자인 열기</button></div>
    </div>
    <div className="card card-pad" data-tour="overview-quickstart"><h2>빠른 시작</h2><ol className="muted"><li>대시보드나 이 화면에서 기본/고급/검수 흐름 선택</li><li>글 생성 탭: 1단계 후보 만들기 → 2단계 글 작성 → 후보 목록 확인</li><li>작업 큐 탭에서 진행 상태 확인</li><li>검수·내보내기 탭에서 검수하고 색인/중복/가지치기 실행</li></ol><p className="muted small">「기본 글 생성」을 누르면 분리된 카드 영역만 순서대로 포커싱합니다.</p></div>
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
  if (counts.failed > 0) return { title: "실패 작업부터 확인하세요", desc: `${counts.failed.toLocaleString()}개 실패가 있어 같은 조건으로 다시 만들기 전에 에러를 먼저 봐야 합니다.`, cta: "검수 2 시작", mode: "review", focus: "jobs" };
  if (counts.in_progress > 0) return { title: "진행 중인 작업을 확인하세요", desc: `${counts.in_progress.toLocaleString()}개 작업이 진행 중입니다. 새 대량 생성보다 큐 상태 확인이 먼저입니다.`, cta: "검수 2 시작", mode: "review", focus: "jobs" };
  if (counts.planned > 0) return { title: "1개 테스트 작성부터 하세요", desc: `${counts.planned.toLocaleString()}개 후보가 대기 중입니다. 품질 확인 없이 대량 생성하지 않도록 테스트 1개부터 시작합니다.`, cta: "기본 4 시작", mode: "basic", focus: "test-write" };
  if (totalSlots === 0) return { title: "기본 흐름 개요부터 보기", desc: "새 도메인입니다. 기본 생성 흐름을 개요로 훑어본 뒤 원천 데이터 준비로 이어가세요.", cta: "기본 1 시작", mode: "basic", focus: "workflow" };
  if (!domain.common_principles) return { title: "공통 원칙을 먼저 저장하세요", desc: "후보는 있지만 공통 작성 원칙이 비어 있습니다. 확인된 데이터 사용·과장 금지 같은 공통 기준을 잡으면 생성 품질이 안정됩니다.", cta: "고급 2 시작", mode: "advanced", focus: "plan" };
  if (counts.published > 0) return { title: "완성 글을 검수하고 내보내세요", desc: `${counts.published.toLocaleString()}개 완성 글이 있습니다. 미리보기 후 Markdown/HTML export와 색인 요청으로 마감하세요.`, cta: "검수 3 시작", mode: "review", focus: "posts" };
  return { title: "글 후보를 새로 만드세요", desc: "현재 바로 작성할 대기 후보가 없습니다. 조건을 확인하고 후보를 다시 생성하세요.", cta: "기본 3 시작", mode: "basic", focus: "slot-create" };
}

// 공통 설정 탭: 공통 작성 원칙 + 제외어 + 키워드 마스터. 지역 축은 「원천 데이터」 탭에서 관리한다.
function Principles({ domain, busy, onSave, onRefresh, onTab }: { domain: DomainConfig; busy: boolean; onSave: (f: Record<string, unknown>) => Promise<void>; onRefresh: () => Promise<void>; onTab: (v: string) => void }) {
  const [brief, setBrief] = useState(domain.common_principles ?? domain.content_brief ?? "");
  const [excludedKeywords, setExcludedKeywords] = useState(domain.excluded_keywords ?? "");
  async function save() {
    await onSave({ common_principles: brief.trim(), excluded_keywords: excludedKeywords.trim() });
    await onRefresh();
  }
  return <div className="card card-pad grid" data-tour="plan-brief">
    <h2>공통 작성 원칙</h2>
    <p className="muted">모든 글 유형에 공통 적용되는 안전·데이터 원칙, 제외어, 그리고 <b>키워드 마스터</b>(아래 표)입니다. 글 유형별 방향성·축·키워드 선택은 「글유형/디자인」 탭의 커스텀 글유형에서 관리합니다.</p>
    <Field label="공통 작성 원칙 (모든 글 유형 공통)"><textarea className="textarea" rows={7} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="확인된 데이터만 사용하고, 가격·합격률·셔틀은 자료가 있을 때만 단정한다. 확인 가능한 사실이 부족하면 숫자를 부풀리지 말고 확인 방법 중심으로 정직하게 작성한다." /></Field>
    <Field label="생성 제외 키워드/문구"><textarea className="textarea" rows={4} value={excludedKeywords} onChange={(e) => setExcludedKeywords(e.target.value)} placeholder={"실내운전연습장\n실내운전연습장 추천\n대성자동차학원 찾기 전 볼 인근 후보"} /><p className="muted small">한 줄에 하나씩 입력하면 후보 생성, 후보 검색, 작성 큐, 최종 저장 전에 제외됩니다.</p></Field>
    <div className="row"><button className="btn primary" onClick={save} disabled={busy}>{busy ? "저장 중..." : "저장"}</button><button className="btn" onClick={() => onTab("templates")}>글 유형/방향성</button><button className="btn" onClick={() => onTab("academies")}>원천 데이터</button></div>
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
  const availableBuiltins = availableItems.filter((it) => !it.isCustom);
  const availableCustoms = availableItems.filter((it) => it.isCustom);
  const specMeta = (spec: TemplateSpec) => `primary: ${spec.primary.join(", ")} · persona ${spec.use_persona ? "사용" : "미사용"} · intent ${spec.with_intent ? "사용" : "미사용"} · modifier ${spec.modifier_count}`;
  const specBadges = (spec: TemplateSpec) => <div className="row">{spec.primary.map((axis) => <span key={axis} className="badge">{axis}</span>)}{spec.use_persona && <span className="badge">persona</span>}{spec.with_intent && <span className="badge">intent</span>}{spec.modifier_count > 0 && <span className="badge">modifier {spec.modifier_count}</span>}<span className="badge info">디자인 {designNameOf(spec.default_design)}</span></div>;
  const customBadges = (t: CustomTemplate) => <div className="row"><span className="badge">아키타입 {t.kind}</span>{t.use_persona ? <span className="badge">persona</span> : null}{t.with_intent ? <span className="badge">intent</span> : null}{t.modifier_count > 0 ? <span className="badge">modifier {t.modifier_count}</span> : null}<span className="badge info">디자인 {designNameOf(t.default_design)}</span></div>;
  const itemBody = (it: TypeItem) => it.isCustom ? customBadges(it.custom!) : <><p className="muted small">{specMeta(it.spec!)}</p>{specBadges(it.spec!)}</>;
  const cardOf = (it: TypeItem, mode: "active" | "add") => mode === "active"
    ? <div key={it.id} className="option-card active"><div className="spread"><b><span className="badge">{it.id}</span> {it.name}</b><button type="button" className="btn ghost" style={{ padding: "2px 8px" }} disabled={busy} onClick={() => toggle(it.id)}>제거</button></div>{itemBody(it)}</div>
    : <button key={it.id} type="button" className="option-card" disabled={busy} onClick={() => toggle(it.id)}><div className="spread"><b><span className="badge">{it.id}</span> {it.name}</b><span className="badge success">+ 추가</span></div>{itemBody(it)}</button>;
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

  const designChoices = useMemo(() => [...options.design_templates], [options.design_templates]);
  const designNameOf = (id?: string) => designChoices.find((d) => d.id === id)?.name ?? id ?? "local-guide";
  const kindOptions = useMemo(() => {
    const map = new Map<string, { label: string; primary: string }>();
    for (const spec of Object.values(options.template_specs)) {
      const k = spec.kind ?? "";
      if (k && !map.has(k)) map.set(k, { label: `${k} — ${spec.name} 계열`, primary: spec.primary?.[0] ?? "keyword" });
    }
    return [...map.entries()].map(([kind, v]) => ({ kind, label: v.label, primary: v.primary }));
  }, [options.template_specs]);
  const primaryOfKind = (kind: string) => kindOptions.find((o) => o.kind === kind)?.primary ?? "keyword";
  // 커스텀 만들기 '시작점' 옵션: 빌트인 + 기존 커스텀. 고르면 폼에 값을 채워 시작(복제 통합).
  const createSources: TemplateSource[] = useMemo(() => [
    ...Object.entries(options.template_specs).map(([id, spec]) => ({
      id, label: `${id} ${spec.name} (빌트인)`, name: spec.name, kind: spec.kind ?? "",
      use_persona: spec.use_persona, with_intent: Boolean(spec.with_intent), modifier_count: spec.modifier_count,
      default_design: spec.default_design ?? "local-guide", default_direction: spec.default_direction ?? "", axis_values: spec.axis_values, academy_types: spec.academy_types, keyword_filter: spec.keyword_filter, primary_override: spec.primary_override,
    })),
    ...custom.map((t) => ({
      id: t.template_id, label: `${t.template_id} ${t.name} (커스텀)`, name: t.name, kind: t.kind,
      use_persona: t.use_persona, with_intent: t.with_intent, modifier_count: t.modifier_count,
      default_design: t.default_design ?? "local-guide", default_direction: t.default_direction ?? "", axis_values: t.axis_values, academy_types: t.academy_types, keyword_filter: t.keyword_filter, primary_override: t.primary_override,
    })),
  ], [options.template_specs, custom]);

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
    <p className="toast-info small"><b>아키타입</b>은 글의 검증된 &apos;동작 원형&apos;입니다 — 주축(지역/키워드)·주키워드 생성 규칙·작성 지침·품질 규칙을 정해 둔 틀이에요. 커스텀 글유형은 이 중 하나를 <b>골라 참조</b>하고, 페르소나·디자인·방향성 같은 세부만 조정합니다(주키워드 규칙·품질 지침은 아키타입 그대로).<br /><b>주축</b>(아키타입이 결정, 변경 불가) — <b>지역형</b>: 지역(강남·수원 등)을 기준으로 &quot;지역 + 운전면허학원&quot;처럼 주키워드를 만들어 지역별 학원을 비교·소개. <b>키워드형</b>: 키워드 자체를 주제로 삼는 정보형(가이드·시험·비용 등).</p>
    {error && <p className="toast-warn">{error}</p>}

    <CustomTemplateForm mode="create" domain={domain} kindOptions={kindOptions} designChoices={designChoices} sources={createSources} academyTypeOptions={academyTypeOptions} keywordPool={keywordPool} brandColor={domainConfig.brand_color} brand={publicBrandName(domainConfig.display_name)} busy={busy}
      onSubmit={(body) => run(() => createTemplate(domain, body))}
      onClone={(sourceId, name, overrides) => run(() => cloneTemplate(domain, { source_template_id: sourceId, name, overrides }))} />

    {loading ? <p className="muted small">불러오는 중...</p> : custom.length === 0
      ? <p className="muted small">아직 커스텀 글유형이 없습니다. 위에서 만들거나 복제해 보세요.</p>
      : <div className="grid">{custom.map((t) => {
        const coh = coherence[t.template_id];
        if (editId === t.template_id) return <CustomTemplateForm key={t.template_id} mode="edit" domain={domain} initial={t} kindOptions={kindOptions} designChoices={designChoices} academyTypeOptions={academyTypeOptions} keywordPool={keywordPool} brandColor={domainConfig.brand_color} brand={publicBrandName(domainConfig.display_name)} busy={busy}
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
          </div>
          {t.default_direction && <p className="muted small">방향성: {t.default_direction}</p>}
          {coh && <>
            <p className="small"><b>예상 후보 상한:</b> {coh.estimated_slot_upperbound.toLocaleString()}</p>
            {coh.warnings.length > 0 && <div className="grid">{coh.warnings.map((w, i) => <p key={i} className={w.level === "error" ? "toast-warn" : "muted small"}>{w.level === "error" ? "⚠️ " : "• "}{w.message}</p>)}</div>}
          </>}
        </div>;
      })}</div>}
  </section>;
}

// 커스텀 만들기 '시작점' 옵션 형태(빌트인/커스텀 공통). 고르면 폼 값을 채운다.
type TemplateSource = { id: string; label: string; name: string; kind: string; use_persona: boolean; with_intent: boolean; modifier_count: number; default_design: string; default_direction: string; axis_values?: { persona?: string[]; intent?: string[]; modifier?: string[] }; academy_types?: string[]; keyword_filter?: string[]; primary_override?: "region" | "keyword" };

// 커스텀 글유형 생성/편집 폼. 생성 모드에선 '시작점'을 골라 기존 글유형(빌트인/커스텀) 값을 채워 시작할 수 있다(복제 통합).
function CustomTemplateForm({ mode, domain, initial, kindOptions, designChoices, sources, academyTypeOptions, keywordPool, brandColor, brand, busy, onSubmit, onClone, onCancel }: {
  mode: "create" | "edit"; domain: string; initial?: CustomTemplate; kindOptions: { kind: string; label: string; primary: string }[]; designChoices: DesignTemplateOption[];
  sources?: TemplateSource[]; academyTypeOptions?: Array<{ value: string; count: number }>; keywordPool?: string[]; brandColor?: string | null; brand?: string; busy: boolean;
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
  const [source, setSource] = useState(""); // 시작점(빈값=직접 입력). create 모드 전용.
  const sourceLocked = mode === "edit" || Boolean(source); // 시작점을 고르면 아키타입은 소스로 고정.
  // 학원 타입은 지역형(primary=region) 글유형에서만 효과가 있으므로(키워드형은 지역이 없어 학원 미수집) 그때만 노출한다.
  const isRegionPrimary = (kindOptions.find((o) => o.kind === kind)?.primary ?? "keyword") === "region";
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");

  // 켜 놓은 축(persona/intent/modifier)의 값을 LLM 이 이 글유형(kind/이름/방향성)에 맞게 제안해 텍스트영역을 채운다.
  // 제안일 뿐이라 사용자가 검토/수정 후 저장(품질 관문=사람). 저장은 하지 않는다.
  async function suggestAxes() {
    const wanted: string[] = [];
    if (usePersona) wanted.push("persona");
    if (withIntent) wanted.push("intent");
    if (modifierCount > 0) wanted.push("modifier");
    if (!wanted.length) { setAiError("먼저 제안받을 축(persona·intent·modifier)을 ‘사용’으로 켜세요."); return; }
    setAiBusy(true); setAiError("");
    try {
      const res = await suggestTemplateAxes(domain, { kind, name: name.trim(), direction: direction.trim(), axes: wanted });
      if (res.suggestions.persona) setPersonaVals(res.suggestions.persona.join("\n"));
      if (res.suggestions.intent) setIntentVals(res.suggestions.intent.join("\n"));
      if (res.suggestions.modifier) setModifierVals(res.suggestions.modifier.join("\n"));
    } catch (e) { setAiError(e instanceof Error ? e.message : String(e)); }
    finally { setAiBusy(false); }
  }

  function selectSource(id: string) {
    setSource(id);
    const src = sources?.find((s) => s.id === id);
    if (!src) return; // 직접 입력: 현재 값 유지, 아키타입만 다시 선택 가능.
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
  }

  function submit() {
    if (!name.trim()) { alert("이름을 입력하세요."); return; }
    // 축을 '사용'으로 켰으면 값 입력 필수(빈 채로 저장하면 그 축은 생성에서 무시됨 = 품질 이슈). 폴백 없음.
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
      const overrides: Record<string, unknown> = { axis_values: axisValues, academy_types: academyTypesArr, keyword_filter: keywordFilterArr, primary_override: primaryOverrideVal ?? null };
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
    onSubmit({ name: name.trim(), kind, default_design: design, use_persona: usePersona, with_intent: withIntent, modifier_count: modifierCount, default_direction: direction.trim() || undefined, axis_values: axisValues, academy_types: academyTypesArr, keyword_filter: keywordFilterArr, primary_override: primaryOverrideVal });
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
    <div className="grid grid-2">
      <Field label="이름"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 심야 학원 특집" /></Field>
      <Field label="참조 아키타입 (kind)">
        <select className="select" value={kind} onChange={(e) => setKind(e.target.value)} disabled={sourceLocked}>
          {kindOptions.map((o) => <option key={o.kind} value={o.kind}>{o.label}</option>)}
        </select>
        <p className="muted small">주축 <b>{(kindOptions.find((o) => o.kind === kind)?.primary ?? "keyword") === "region" ? "지역형(지역+키워드)" : "키워드형"}</b> · 주키워드 규칙·품질 지침은 참조 아키타입이 결정합니다(직접 변경 불가).{source ? " 시작점을 고르면 소스의 아키타입으로 고정됩니다." : ""}</p>
      </Field>
      <Field label="디자인"><select className="select" value={design} onChange={(e) => setDesign(e.target.value)}>
        {designChoices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select><p className="muted small">각 디자인의 구성은 아래 「디자인」 영역에서 확인할 수 있고, 「커스텀」을 고르면 그 영역의 커스텀 디자인 메모가 적용됩니다.</p></Field>
    </div>
    <Field label="방향성 (선택)"><textarea className="textarea" rows={2} value={direction} onChange={(e) => setDirection(e.target.value)} placeholder="이 글유형의 기본 방향성" /></Field>
    <div className="grid" style={{ gap: 8 }}>
      <div className="spread">
        <div><b className="small">축 구성 · 값 프리셋</b><p className="muted small">이 글유형이 쓸 persona·intent·modifier 값입니다. <b>쓸 축을 켜면 값을 반드시 입력하세요</b> — 이 값이 유일한 소스이고(도메인 공통 축 폴백 없음), 비어 있으면 그 축은 생성에서 무시됩니다. 한 줄에 하나씩.</p></div>
        <button type="button" className="btn" style={{ flexShrink: 0, whiteSpace: "nowrap" }} disabled={aiBusy || busy} onClick={() => void suggestAxes()} title="켜 놓은 축의 값을 LLM 이 이 글유형(이름·방향성·아키타입)에 맞게 제안해 채웁니다. 제안이므로 검토·수정 후 저장하세요.">{aiBusy ? "AI 제안 중..." : "🤖 AI로 축 값 제안"}</button>
      </div>
      {aiError && <p className="toast-warn small">{aiError}</p>}
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
      <div><b className="small">학원 타입 (선택)</b><p className="muted small">이 글유형이 후보로 쓸 학원 타입입니다. <b>비우면 학원정보를 쓰지 않고</b> 지역 가이드/체크리스트 중심으로 작성합니다. 지역형 글유형에만 적용됩니다.</p></div>
      <div className="info-panel grid grid-3" style={{ gap: 6 }}>
        {(academyTypeOptions ?? []).map((t) => <label key={t.value} className="row" style={{ gap: 6 }}>
          <input type="checkbox" checked={academyTypes.has(t.value)} onChange={(e) => setAcademyTypes((prev) => { const next = new Set(prev); if (e.target.checked) next.add(t.value); else next.delete(t.value); return next; })} /> {t.value} <span className="muted small">({t.count})</span>
        </label>)}
        {!(academyTypeOptions ?? []).length && <p className="muted small">먼저 학원 동기화를 실행하면 타입 목록이 표시됩니다.</p>}
      </div>
    </div>}
    <div className="grid" style={{ gap: 8 }}>
      <div><b className="small">키워드 선택 (선택)</b><p className="muted small">이 글유형이 쓸 키워드를 한 줄에 하나씩 적습니다. <b>적으면 그 키워드를 그대로 사용</b>(아키타입 패턴 무시), <b>비우면 아키타입 패턴</b>으로 자동 선택. 아래 풀에서 클릭하면 추가되고, 풀에 없는 키워드도 직접 입력할 수 있습니다.</p></div>
      <Field label="주축(지역 결합)">
        <select className="select" value={primaryOverride} onChange={(e) => setPrimaryOverride(e.target.value)} style={{ maxWidth: 320 }}>
          <option value="">아키타입 기본 ({(kindOptions.find((o) => o.kind === kind)?.primary ?? "keyword") === "region" ? "지역형" : "키워드형"})</option>
          <option value="region">지역형 — 지역 × 키워드 (예: &quot;강남 운전면허학원&quot;)</option>
          <option value="keyword">키워드형 — 지역 없이 키워드만</option>
        </select>
        <p className="muted small">위에서 키워드를 적은 경우에만 적용됩니다(미입력 시 아키타입 규칙을 따름).</p>
      </Field>
      <textarea className="textarea" rows={3} value={keywordVals} onChange={(e) => setKeywordVals(e.target.value)} placeholder={"운전면허학원\n자동차운전전문학원   (한 줄에 하나 · 비우면 아키타입 패턴)"} />
      {(keywordPool ?? []).length > 0 && <div className="row" style={{ flexWrap: "wrap", gap: 4 }}>
        <span className="muted small" style={{ alignSelf: "center" }}>풀에서 추가:</span>
        {(keywordPool ?? []).map((kw) => {
          const has = parseLines(keywordVals).includes(kw);
          return <button key={kw} type="button" className={`btn small ${has ? "primary" : ""}`} style={{ padding: "2px 8px" }}
            onClick={() => setKeywordVals((prev) => { const list = parseLines(prev); return (has ? list.filter((k) => k !== kw) : [...list, kw]).join("\n"); })}>{has ? "✓ " : "+ "}{kw}</button>;
        })}
      </div>}
    </div>
    <details className="template-subsection">
      <summary className="template-subsection-summary"><div className="template-subsection-head"><div><h3>미리보기 (디자인 목업)</h3><p className="muted small">선택한 디자인의 레이아웃만 보여주는 예시 목업입니다. 실제 글 내용·방향성·축 값은 반영하지 않습니다.</p></div><span className="badge info">열기</span></div></summary>
      {(() => {
        const opt = designChoices.find((d) => d.id === design);
        return <DesignPreview blueprint={designBlueprintFor(design, opt)} designId={design} designOption={opt} brandColor={brandColor} brand={brand ?? "브랜드"} title={opt?.name ?? design} summary={opt?.summary ?? ""} />;
      })()}
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
    label: option?.summary || "업로드 HTML에서 추출한 디자인",
    title: `${option?.name || "업로드 디자인"} 예시 글`,
    lead: option?.summary || "업로드한 HTML의 섹션 흐름과 시각 스타일 힌트를 반영합니다.",
    chips: ["HTML 기반", "사용자 프리셋", "디자인"],
    sections,
    tone: option?.tone || "업로드 예시 기반 브랜드 톤",
    blocks: sections.slice(0, 4).map((section, index) => ({
      title: section.replace(/^\d+\)\s*/, ""),
      body: index === 0 ? "예시 HTML에서 추출한 상단 구성과 문단 리듬을 따릅니다." : "색상, 카드감, 여백, CTA 강조 방식은 업로드 예시의 분위기를 참고합니다.",
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
  const [regionLevel, setRegionLevel] = useState<"2" | "3" | "all">("2");
  const [replaceRegionAxis, setReplaceRegionAxis] = useState(true);
  const [syncResult, setSyncResult] = useState("");
  const [q, setQ] = useState("");
  const [region, setRegion] = useState("");
  const [academyType, setAcademyType] = useState("");
  const [hasPhotos, setHasPhotos] = useState(false);
  const [remoteAcademies, setRemoteAcademies] = useState(academies);
  const [remoteTotal, setRemoteTotal] = useState(academies.length);
  const [academyTypes, setAcademyTypes] = useState<Array<{ value: string; count: number }>>([]);
  const [manualToolsOpen, setManualToolsOpen] = useState(false);
  const [runtimeApis, setRuntimeApis] = useState<RuntimeApis | null>(null);
  const [loading, setLoading] = useState(false);
  const [filterError, setFilterError] = useState("");
  const [lastSync, setLastSync] = useState<SyncSummary>({});
  useEffect(() => { setLastSync(getSyncSummary(domain.domain)); }, [domain.domain]);
  // 학원 행에 남은 synced_at 중 가장 최근 값(다른 브라우저에서 동기화된 경우의 폴백).
  const academySyncedAt = useMemo(() => remoteAcademies.reduce<string | null>((max, a) => (a.synced_at && (!max || a.synced_at > max) ? a.synced_at : max), null), [remoteAcademies]);
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
  async function syncAcademies() {
    setSyncBusy("academies");
    try {
      const res = await syncDrivingplusAcademies(domain.domain, { include_reviews: true, review_limit: 5, review_sort: "point", include_blog_reviews: true, blog_review_limit: 3 });
      setSyncResult(`학원 ${res.fetched}개 조회 · ${res.upserted}개 반영 · 일반 리뷰 ${res.review_count}개 · 블로그 리뷰 ${res.blog_review_count}개 · ${res.skipped}개 제외${res.warnings?.length ? ` · 경고 ${res.warnings.length}개` : ""}`);
      setLastSync(recordSync(domain.domain, "academies", { count: res.upserted, at: new Date().toISOString(), detail: `조회 ${res.fetched}개 · 리뷰 ${res.review_count}/블로그 ${res.blog_review_count}` }));
      await onRefresh();
      await loadAcademies();
    } catch (e) { alert((e as Error).message); }
    finally { setSyncBusy(""); }
  }
  async function syncRegions() {
    setSyncBusy("regions");
    try {
      const res = await syncDrivingplusRegions(domain.domain, { level: regionLevel, replace_axis: replaceRegionAxis, max: regionLevel === "3" ? 500 : 10000 });
      setSyncResult(`지역 ${res.fetched}개 조회 · ${res.upserted}개 반영${res.axis_replaced ? " · region 축 교체" : ""}`);
      setLastSync(recordSync(domain.domain, "regions", { count: res.upserted, at: new Date().toISOString(), detail: `조회 ${res.fetched}개${res.axis_replaced ? " · region 축 교체" : ""}` }));
      await onRefresh();
    } catch (e) { alert((e as Error).message); }
    finally { setSyncBusy(""); }
  }
  return <div className="grid">
    <div className="card card-pad grid" data-tour="academies-sync">
      <div className="spread"><div><h2>학원/지역자료 — 생성용 배경 데이터</h2><p className="muted">DrivingPlus 원천 API의 지역·학원 데이터를 가져와 글 생성 프롬프트의 검증된 자료로 씁니다. 지역 → 학원 순서로 한 번 준비해두면 생성 때 다시 열 필요는 없습니다.</p></div><span className="badge info">{remoteTotal}개 학원</span></div>
      <div className="writer-hint">
        <b>현재 적용 API</b>
        <span>관리자/Nest: <code>{runtimeApis?.admin_api_base ?? "확인 중..."}</code></span>
        <span>DrivingPlus 원천: <code>{runtimeApis?.drivingplus_api_base ?? "확인 중..."}</code></span>
        {runtimeApis && <span>지역: <code>{runtimeApis.drivingplus_endpoints.seo_regions}</code></span>}
        {runtimeApis && <span>학원: <code>{runtimeApis.drivingplus_endpoints.academies}</code></span>}
        {runtimeApis && <span>일반 리뷰: <code>{runtimeApis.drivingplus_endpoints.reviews}</code></span>}
        {runtimeApis && <span>블로그 리뷰: <code>{runtimeApis.drivingplus_endpoints.blog_reviews}</code></span>}
        {runtimeApis && <span>동기화 기본값: 일반 리뷰 {runtimeApis.sync_defaults.review_limit}개({runtimeApis.sync_defaults.review_sort}), 블로그 리뷰 {runtimeApis.sync_defaults.blog_review_limit}개</span>}
        {runtimeApis && <span className="muted small">{runtimeApis.sync_defaults.review_source_note}</span>}
      </div>
      <div className="card card-pad grid" style={{ background: "#f8fafc" }}>
        <div className="spread"><h3 style={{ margin: 0 }}>1단계 · 지역자료 동기화</h3><span className="badge">지역 데이터 · region 축</span></div>
        <p className="muted small">지역(시군구/읍면동) 목록을 가져오고, 옵션을 켜면 region 축을 교체합니다. 아래 옵션은 <b>지역 동기화에만</b> 적용됩니다.</p>
        <div className="grid grid-3">
          <Field label="지역 레벨"><select className="select" value={regionLevel} onChange={(e) => setRegionLevel(e.target.value as "2" | "3" | "all")}><option value="2">시군구(level=2, 권장)</option><option value="3">읍면동(level=3, 최대 500개)</option><option value="all">전체</option></select></Field>
          <Field label="지역 축 반영"><label className="row small" style={{ minHeight: 42 }}><input type="checkbox" checked={replaceRegionAxis} onChange={(e) => setReplaceRegionAxis(e.target.checked)} /> axes.region 교체</label></Field>
          <div className="row" style={{ alignItems: "end" }}><button className="btn" onClick={syncRegions} disabled={Boolean(syncBusy)}>{syncBusy === "regions" ? "지역 동기화 중..." : "지역 동기화"}</button></div>
        </div>
        <p className="muted small">최근 지역 동기화: {lastSync.regions ? `${formatDateTime(lastSync.regions.at)} · ${lastSync.regions.count.toLocaleString()}개 반영${lastSync.regions.detail ? ` (${lastSync.regions.detail})` : ""}` : "아직 기록 없음"}</p>
        <details className="template-subsection">
          <summary className="template-subsection-summary"><div className="template-subsection-head"><div><h3 style={{ margin: 0 }}>지역 축 직접 편집 (고급)</h3><p className="muted small">보통은 위 동기화로 채웁니다. 지역 목록을 수동 조정할 때만 여세요.</p></div><span className="badge info">{regionAxis.length}개</span></div></summary>
          <form className="grid" style={{ marginTop: 8 }} onSubmit={(e) => { e.preventDefault(); saveRegionAxis(e.currentTarget); }}>
            <textarea className="textarea mono" name="values" rows={8} defaultValue={regionAxis.map((r) => `${r.value},${r.weight},${r.monthly_search_volume ?? ""},${r.competition_kd ?? ""}`).join("\n")} placeholder="값,가중치,월검색량,KD" />
            <div className="row"><button className="btn primary">지역 축 저장</button></div>
          </form>
        </details>
      </div>
      <div className="card card-pad grid" style={{ background: "#f8fafc" }}>
        <div className="spread"><h3 style={{ margin: 0 }}>2단계 · 학원자료 동기화</h3><span className="badge">학원 상세 · 사진 · 리뷰</span></div>
        <p className="muted small">각 지역의 학원 상세(사진·별점리뷰·블로그 리뷰 포함)를 가져옵니다. 지역 동기화 이후 실행을 권장하며, 위 지역 옵션은 여기에 영향을 주지 않습니다.</p>
        <div className="row"><button className="btn primary" onClick={syncAcademies} disabled={Boolean(syncBusy)}>{syncBusy === "academies" ? "학원 동기화 중..." : "학원 동기화"}</button></div>
        <p className="muted small">현재 {remoteTotal.toLocaleString()}개 보유 · 최근 동기화: {lastSync.academies ? `${formatDateTime(lastSync.academies.at)} · ${lastSync.academies.count.toLocaleString()}개 반영${lastSync.academies.detail ? ` (${lastSync.academies.detail})` : ""}` : academySyncedAt ? formatDateTime(academySyncedAt) : "아직 기록 없음"}</p>
      </div>
      {syncResult && <p className="small badge success" style={{ width: "fit-content" }}>{syncResult}</p>}
      <div className="card card-pad grid" style={{ background: "#f8fafc" }}>
        <div className="spread"><div><h3 style={{ margin: 0 }}>선택 · 수동 자료 보완</h3><p className="muted small">DrivingPlus 동기화에 없는 검증 자료가 있을 때만 직접 채웁니다. 필수 단계는 아니며, 위 지역·학원 동기화만으로도 글을 생성할 수 있습니다.</p></div><button className="btn" type="button" onClick={() => setManualToolsOpen((open) => !open)}>{manualToolsOpen ? "닫기" : "열기"}</button></div>
      {manualToolsOpen && <>
        <p className="small" style={{ color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 10px", margin: 0 }}>⚠️ 같은 학원(지역+이름)을 다시 등록하면 비운 항목이 기존 값을 덮어 지웁니다. 일부만 수정할 땐 나머지 항목도 함께 채워주세요. 단건·JSON 일괄 등록 모두 동일합니다.</p>
        <form className="grid" onSubmit={(e) => { e.preventDefault(); add(e.currentTarget); }}><h3>1. 단건 등록</h3><p className="muted small">학원 1곳의 지역, 이름, 주소, 전화, 검증 메모를 직접 입력합니다.</p><div className="grid grid-3">{["region","name","address","price","shuttle","hours","pass_rate","phone","source_name","source_url","review"].map((n) => <input key={n} className="input" name={n} placeholder={n} required={n === "name"} />)}</div><button className="btn primary">단건 등록</button></form>
        <form className="grid" onSubmit={(e) => { e.preventDefault(); bulk(e.currentTarget); }}><h3>2. JSON 일괄 등록</h3><p className="muted small">여러 학원 자료를 JSON 객체 또는 배열로 한 번에 등록합니다.</p><textarea className="textarea mono" name="json" placeholder='[{"region":"대구","name":"OO학원","price":"65만원"}]' /><button className="btn">JSON 일괄 등록</button></form>
      </>}
      </div>
    </div>
    <div className="card card-pad grid">
      <div className="spread"><h2>학원자료 목록 · 필터</h2><span className="muted small">{remoteTotal.toLocaleString()}개{loading ? " 검색 중" : ""}</span></div>
      <p className="muted small">아래 필터로 표에서 자료를 찾아봅니다. 글 생성에 쓰는 학원 타입은 이제 글유형별로 정합니다(글유형 탭의 “학원 타입 필터”).</p>
      <div className="grid grid-4">
        <Field label="검색"><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="학원명, 주소, SEO 설명" /></Field>
        <Field label="지역"><input className="input" value={region} onChange={(e) => setRegion(e.target.value)} placeholder="서울, 부산, 강남구" /></Field>
        <Field label="API 타입"><select className="select" value={academyType} onChange={(e) => setAcademyType(e.target.value)}><option value="">전체 타입</option>{academyTypes.map((type) => <option key={type.value} value={type.value}>{type.value} ({type.count})</option>)}</select></Field>
        <Field label="사진"><label className="row small" style={{ minHeight: 42 }}><input type="checkbox" checked={hasPhotos} onChange={(e) => setHasPhotos(e.target.checked)} /> 사진 있는 학원만</label></Field>
      </div>
      {filterError && <p className="small" style={{ color: "var(--danger)" }}>필터 오류: {filterError}</p>}
      <div className="table-wrap"><table><thead><tr><th>지역</th><th>학원명</th><th>API 타입</th><th>전화/사진</th><th>SEO 설명</th><th>출처</th><th></th></tr></thead><tbody>{remoteAcademies.map((a) => {
        const photoCount = parsePhotoCount(a.photos);
        const reviewCount = parseJsonCount(a.review_json);
        const blogReviewCount = parseJsonCount(a.blog_reviews);
        return <tr key={a.id}><td>{a.region}</td><td><b>{a.name}</b><p className="muted small">{a.address}</p><p className="muted small">{a.external_id ? `#${a.external_id}` : ""}</p></td><td><span className="badge">{a.academy_type || "-"}</span></td><td>{a.vphone || a.phone}<p className="muted small">{photoCount ? `사진 ${photoCount}장` : "사진 없음"} · 리뷰 {reviewCount}개 · 블로그 {blogReviewCount}개</p></td><td><span className="small">{a.seo_description || a.review || "-"}</span></td><td>{a.source_url ? <a href={a.source_url} target="_blank">{a.source_name || "링크"}</a> : a.source_name}</td><td><button className="btn danger" onClick={() => del(a.id)}>삭제</button></td></tr>;
      })}</tbody></table></div>
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


  async function gen() { if (busy || queueBusy || !genType) return; setBusy(true); try { await api(`/domains/${encodeURIComponent(domain.domain)}/slots/generate`, { method: "POST", body: JSON.stringify({ template: genType, max_per_template: max }) }); await onRefresh(); await loadCurrentSlots(); } catch (err) { alert(err instanceof Error ? err.message : String(err)); } finally { setBusy(false); } }
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
        {enabledTypes.length === 0 && <p className="muted small">활성화된 글유형이 없습니다. <button className="btn" onClick={() => onTab("templates")}>글유형/디자인 탭</button>에서 유형을 켜세요.</p>}
        <p className="muted small">조합 재료는 「원천 데이터」 탭 지역·「공통 설정」 키워드 마스터·「글유형/디자인」 설정을 따릅니다. 프리셋을 적용했다면 별도 동기화 없이도 후보를 만들 수 있습니다.</p>
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
          <Field label="모델"><input className="input" value={model} onChange={(e) => setModel(e.target.value)} placeholder="비우면 기본 codex" /></Field>
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
          <select className="select" style={{ width: 150 }} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">전체 상태</option>{["planned","in_progress","published","failed","pruned"].map((s) => <option key={s}>{s}</option>)}</select>
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
            <thead><tr><th><input type="checkbox" checked={selectedAllVisible} onChange={toggleAllVisible} /></th><th>유형</th><th>키워드</th><th>지역</th><th>페르소나</th><th>점수</th><th>상태</th></tr></thead>
            <tbody>{filtered.map((s) => <tr key={s.slot_id}><td><input type="checkbox" checked={selected.has(s.slot_id)} onChange={() => setSelected((p) => { const n = new Set(p); n.has(s.slot_id) ? n.delete(s.slot_id) : n.add(s.slot_id); return n; })} /></td><td><span className="badge">{s.template_id}</span></td><td><b>{s.primary_keyword}</b><p className="muted small mono">{s.slot_id}</p>{s.last_error && <p className="small" style={{ color: "var(--danger)" }}>{s.last_error}</p>}</td><td>{s.region ?? "-"}</td><td>{s.persona ?? "-"}</td><td>{s.priority_score?.toFixed(1) ?? "-"}</td><td><Status status={s.status} /></td></tr>)}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
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

function Settings({ domain, options, onSave, onRefresh }: { domain: DomainConfig; options: AdminOptions; onSave: (f: Record<string, unknown>) => Promise<void>; onRefresh: () => Promise<void> }) {
  const [form, setForm] = useState({ display_name: domain.display_name, vertical: domain.vertical, theme: domain.theme, brand_color: domain.brand_color ?? "#2563eb", daily_limit: domain.daily_limit });
  const [delBusy, setDelBusy] = useState(false);
  const previewTheme = getDesignTheme(domain.design_template_id, form.brand_color);
  async function deleteDomain() { if (delBusy || !confirm("정말 삭제할까요? 모든 데이터가 삭제됩니다.")) return; setDelBusy(true); try { await api(`/domains/${encodeURIComponent(domain.domain)}`, { method: "DELETE" }); location.href = "/"; } catch (err) { setDelBusy(false); alert(err instanceof Error ? err.message : String(err)); } }
  return <div className="grid"><div className="card card-pad grid"><h2>메타 정보</h2><Field label="표시 이름"><input className="input" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} /></Field><div className="grid grid-2"><Field label="업종"><input className="input" value={form.vertical} onChange={(e) => setForm({ ...form, vertical: e.target.value })} /></Field><Field label="테마"><select className="select" value={form.theme} onChange={(e) => setForm({ ...form, theme: e.target.value })}>{options.themes.map((t) => <option key={t}>{t}</option>)}</select></Field></div><div className="grid grid-2"><Field label="브랜드 컬러"><div className="row"><input className="input-color" type="color" value={form.brand_color} onChange={(e) => setForm({ ...form, brand_color: e.target.value })} /><code className="mono small">{form.brand_color}</code></div></Field><Field label="일일 한도 (0=무제한)"><input className="input" type="number" min={0} value={form.daily_limit} onChange={(e) => setForm({ ...form, daily_limit: Math.max(0, Number(e.target.value) || 0) })} /></Field></div><div className="brand-color-preview" style={{ ["--accent" as string]: previewTheme.accent, ["--accent-soft" as string]: previewTheme.soft, ["--primary" as string]: previewTheme.accent }}><div className="preview-top"><b>브랜드 컬러 미리보기</b><span className="preview-cta">CTA</span></div><div className="preview-bottom-cta"><b>하단 CTA 영역</b><button type="button" className="btn primary">버튼</button></div></div><p className="muted small">미리보기·발행 글·외부 사이트 CTA에 이 색이 반영됩니다. 저장 후 글 유형/디자인 탭에서도 확인하세요.</p><button className="btn primary" onClick={() => onSave(form)}>저장</button></div><div className="card card-pad grid"><h2>도메인 삭제</h2><p className="muted small">이 도메인과 모든 후보·글 데이터가 함께 삭제됩니다. 되돌릴 수 없습니다.</p><button className="btn danger" disabled={delBusy} onClick={deleteDomain}>{delBusy ? "삭제 중..." : "도메인 삭제"}</button></div></div>;
}

function DesignPreview({ blueprint, designId, designOption, brandColor, brand, title, summary }: { blueprint: typeof DESIGN_BLUEPRINTS[string]; designId: string; designOption?: DesignTemplateOption; brandColor?: string | null; brand: string; title: string; summary: string }) {
  const isUploaded = designOption?.source_type === "uploaded_html";
  const spec = isUploaded ? { topCta: "HTML 스타일", bottomCta: "문의하기" } : PREVIEW_DESIGN_SPECS[designId] ?? PREVIEW_DESIGN_SPECS.editorial;
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
    {isUploaded && <UploadedPresetSourcePreview html={designOption?.source_html} />}
    {isUploaded && <div className="preview-subhead preset-info"><b>생성 구조 미리보기</b><p className="small">업로드 HTML의 구조와 CSS 힌트를 참고하지만, 실제 글은 글 유형/검증 자료를 우선해 재구성됩니다. 원본과 1:1 동일 렌더링을 보장하지 않습니다.</p></div>}
    <div className={`preview-phone design-${designId} ${isUploaded ? "uploaded-preview" : ""}`} style={previewStyle}>
      {isUploaded
        ? <UploadedPresetPreview brand={brand} blueprint={blueprint} />
        : <>
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
        </>}
    </div>
    <div className="card card-pad preview-spec">
      <h3>{title}</h3>
      <p className="muted small">{summary}</p>
      <p className="small"><b>톤:</b> {blueprint.tone}</p>
      <div className="row">{blueprint.sections.map((s, index) => <span className="badge" key={`${s}-${index}`}>{s}</span>)}</div>
    </div>
  </aside>;
}

function UploadedPresetSourcePreview({ html }: { html?: string | null }) {
  if (!html) return <div className="uploaded-source-empty">원본 HTML이 저장되지 않은 프리셋입니다.</div>;
  return <section className="uploaded-source-preview">
    <div className="spread"><h3>원본 HTML 미리보기</h3><span className="badge info">sandbox</span></div>
    <iframe title="업로드 HTML 원본 미리보기" sandbox="" referrerPolicy="no-referrer" srcDoc={html} />
  </section>;
}

function UploadedPresetPreview({ brand, blueprint }: { brand: string; blueprint: typeof DESIGN_BLUEPRINTS[string] }) {
  const sections = blueprint.sections.length ? blueprint.sections : ["체크포인트", "BEST 후보", "비교표", "FAQ"];
  return <>
    <header className="uploaded-hero">
      <span className="uploaded-eyebrow">{brand} 가이드</span>
      <h4>{blueprint.title}</h4>
      <p>{blueprint.lead}</p>
      <div className="uploaded-meta"><span>2026.04.03</span><span>5개 후보 비교</span><span>셔틀·비용·동선</span></div>
    </header>
    <div className="uploaded-wrap">
      <div className="uploaded-notice"><b>확인 포인트</b> 실제 글에서는 후보/검증 자료의 지역과 학원 정보만 사용합니다.</div>
      <nav className="uploaded-toc">
        <b>목차</b>
        <ol>{sections.slice(0, 5).map((section, index) => <li key={`${section}-${index}`}>{section.replace(/^\d+\)\s*/, "")}</li>)}</ol>
      </nav>
      <ul className="uploaded-checklist">
        <li><b>거리/셔틀</b><span>생활권 기준으로 통학 부담 확인</span></li>
        <li><b>비용/과정</b><span>총액과 추가 비용을 분리해서 비교</span></li>
      </ul>
      {[1, 2, 3].map((rank) => <section className="uploaded-school" key={rank}>
        <div className="uploaded-school-head"><span className={rank === 1 ? "gold" : ""}>{rank}</span><div><b>후보 학원 {rank}</b><p>추천 태그와 핵심 장점을 한 줄로 표시</p></div></div>
        <div className="uploaded-spec"><span>주소</span><b>검증된 주소</b><span>셔틀</span><b>상담 확인</b><span>추천</span><b>생활권·목적별 판단</b></div>
        <div className="uploaded-procon"><p><b>좋아요</b> 접근성/과정 장점</p><p><b>확인하세요</b> 비용/일정/셔틀</p></div>
      </section>)}
      <div className="uploaded-table"><b>한눈에 보는 비교표</b><div><span>학원</span><span>동선</span><span>강점</span><span>A</span><span>가까움</span><span>셔틀</span><span>B</span><span>보통</span><span>자체 시험</span></div></div>
      <section className="uploaded-cta"><b>내 조건에 맞는 후보를 다시 확인하세요</b><button type="button" className="btn primary">상담/문의</button></section>
    </div>
  </>;
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
function publicBrandName(value: string): string {
  return value.replace(/\s*(?:샘플|데모)\s*$/u, "").trim() || value;
}
