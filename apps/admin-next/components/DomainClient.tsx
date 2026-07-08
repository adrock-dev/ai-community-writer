"use client";

import { api, createDesignPreset, deleteDesignPreset, downloadPostExport, enqueueGenerate, getDomainDetail, getOptions, getRuntimeApis, listAcademies, listPosts, listSlots, replaceAxis, syncDrivingplusAcademies, syncDrivingplusRegions, updateDomain } from "@/lib/api";
import { formatDateTime } from "@/lib/date";
import { designSettingLabel, getDesignTheme } from "@/lib/design-theme";
import { getGenerationDefaults } from "@/lib/generation-defaults";
import { rememberDomain } from "@/lib/recent-domain";
import { JobCard } from "./JobCard";
import { isTourEnabled, isTourFocus, isTourMode, setTourEnabled, type TourFocus, type TourMode } from "@/lib/tour";
import type { Academy, AdminOptions, Axis, AxisValue, DesignTemplateOption, DomainConfig, DomainDetailPayload, Job, PostSummary, Provider, RuntimeApis, Slot, SlotCounts } from "@/lib/types";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

const AXES: Axis[] = ["region", "keyword", "intent", "persona", "modifier"];
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
  ["overview", "개요"], ["plan", "기획"], ["templates", "글유형/디자인"], ["axes", "축"],
  ["academies", "학원자료"], ["slots", "슬롯"], ["jobs", "작업"], ["posts", "글"], ["settings", "설정"],
] as const;

const TOUR_MODE_COPY: Record<TourMode, { label: string; short: string; desc: string }> = {
  basic: { label: "기본 글 생성", short: "기본", desc: "원천 데이터 → 후보 → 테스트 작성 → 검수만 따라가는 가장 쉬운 시작" },
  advanced: { label: "고급 슬롯 생성", short: "고급", desc: "기획, 글 유형, 화면 구상, 학원 타입까지 세밀하게 잡는 운영자용 흐름" },
  review: { label: "검수/내보내기", short: "검수", desc: "작업 상태와 완성 글을 확인하고 export/indexing으로 넘기는 마감 흐름" },
};

const STEP_GROUPS: Array<{ title: string; desc: string; steps: Array<{ mode: TourMode; focus: TourFocus; no: string; title: string; desc: string; tone?: "primary" }> }> = [
  {
    title: "기본 글 생성",
    desc: "처음 시작할 때 가장 안전한 최소 클릭 순서",
    steps: [
      { mode: "basic", focus: "workflow", no: "기본 1", title: "흐름 개요", desc: "기본 흐름 한눈에 보기", tone: "primary" },
      { mode: "basic", focus: "source", no: "기본 2", title: "원천 데이터 준비", desc: "지역/학원 자료부터 동기화" },
      { mode: "basic", focus: "slot-create", no: "기본 3", title: "글 후보 만들기", desc: "재료로 슬롯 후보 생성" },
      { mode: "basic", focus: "test-write", no: "기본 4", title: "1개 테스트 작성", desc: "대량 작성 전 안전 확인" },
    ],
  },
  {
    title: "고급 슬롯 생성",
    desc: "기획과 생성 조건을 세밀하게 잡을 때",
    steps: [
      { mode: "advanced", focus: "workflow", no: "고급 1", title: "흐름 개요", desc: "고급 흐름 한눈에 보기", tone: "primary" },
      { mode: "advanced", focus: "plan", no: "고급 2", title: "기획/제외어", desc: "생성 방향과 금지어 정리" },
      { mode: "advanced", focus: "template-design", no: "고급 3", title: "유형/디자인", desc: "글 종류와 화면 구상 선택" },
      { mode: "advanced", focus: "academy-types", no: "고급 4", title: "학원 타입 제한", desc: "추천에 쓸 원천 타입 제한" },
      { mode: "advanced", focus: "slot-filter", no: "고급 5", title: "슬롯 필터/확장", desc: "조건을 좁혀 후보 운영" },
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

const ACADEMY_TYPE_COPY: Record<string, { label: string; desc: string; tone: "success" | "warn" | "danger" | "info" }> = {
  exam_academy: { label: "운전면허시험/전문학원", desc: "지역 운전면허 학원 BEST 글에 우선 사용하는 타입", tone: "success" },
  academy: { label: "일반 자동차학원", desc: "실제 학원 후보로 함께 넣어도 되는 보조 타입", tone: "info" },
  indoor_academy: { label: "실내운전연습장", desc: "사용자가 원치 않으면 글 생성에서 빼야 하는 타입", tone: "danger" },
};

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
    title: "내가 정한 화면 구상을 반영한 글",
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
          <Link className={`btn ${view === "generate" ? "primary" : ""}`} href={`/t/${encodeURIComponent(domainConfig.domain)}/generate`}>글 생성</Link>
          <Link className={`btn ${view === "posts" ? "primary" : ""}`} href={`/t/${encodeURIComponent(domainConfig.domain)}/posts`}>검수·내보내기</Link>
          <Link href="/jobs" className="btn">작업 큐</Link>
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
          <p className="muted">슬롯 탭이 두 단계로 나뉩니다. 먼저 후보를 만들고, 2단계 카드에서 1개 테스트 작성으로 품질을 확인한 뒤 확장하세요.</p>
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
      {view === "overview" && tab === "plan" && <Plan domain={domainConfig} axes={payload.axes} busy={busy} onSave={saveDomain} onRefresh={refresh} onTab={setTab} />}
      {view === "overview" && tab === "templates" && <Templates domain={domainConfig} options={options} designPresets={payload.design_presets ?? []} busy={busy} onSave={saveDomain} onRefresh={refresh} />}
      {view === "overview" && tab === "axes" && <Axes domain={domainConfig} axes={payload.axes} options={options} onRefresh={refresh} />}
      {view === "overview" && tab === "academies" && <Academies domain={domainConfig} academies={payload.academies ?? []} busy={busy} onSave={saveDomain} onRefresh={refresh} />}
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
      ? "아래 목록에 후보가 있으면 1단계는 건너뛰어도 됩니다. 더 필요할 때만 「템플릿당 최대」를 조정하고 「재료로 글 후보 만들기」로 추가하세요."
      : "1단계 카드에서 「템플릿당 최대」만 조정한 뒤 「재료로 글 후보 만들기」를 누르세요. LLM은 호출하지 않고 기획 축·글유형 조합만 만듭니다.",
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
    action: "버튼을 누르면 작업 탭에서 진행 상태를 확인합니다.",
  };
  const jobsBoard: TourStep = { focus: "jobs", tab: "jobs", target: "jobs-board", title: "작업 상태 확인", body: "큐에 등록된 글 생성 작업이 대기·진행·완료·실패 중 어디에 있는지 봅니다. 실패하면 상세 카드의 에러를 확인하고 같은 조건으로 다시 시도합니다.", action: "완료 후 글 탭에서 결과를 검수합니다." };
  const postsReview: TourStep = { focus: "posts", tab: "posts", target: "posts-actions", title: hasPosts ? "완성 글 검수/내보내기" : "완성 글이 여기에 쌓입니다", body: hasPosts ? "제목을 눌러 상세 미리보기를 확인하고, 필요한 글을 선택해 Markdown/HTML로 내보내거나 색인 요청을 등록합니다." : "테스트 작성이 완료되면 이 화면에 글이 나타납니다. 여기서 검수, export, 색인 요청을 진행합니다.", action: "이 흐름이 안정적이면 현재 검색 10개, 이후 100개로 확장하세요." };

  if (mode === "basic") {
    return [sharedStart, sourceSync, slotGenerate, testWrite, jobsBoard, postsReview];
  }

  if (mode === "review") {
    return [sharedStart, jobsBoard, postsReview];
  }

  const steps: TourStep[] = [
    sharedStart,
    { focus: "plan", tab: "plan", target: "plan-brief", title: "글 방향과 제외어를 저장", body: "어떤 글을 만들지, 절대 넣지 말아야 할 키워드는 무엇인지 먼저 정합니다. 이 내용이 뒤의 후보 생성과 프롬프트에 계속 반영됩니다.", action: "입력 후 ‘기획 저장’을 누르고 다음으로 이동하세요." },
    { focus: "template-type", tab: "templates", target: "templates-types", title: "만들 글 유형 선택", body: "비교형, 지역형, 체크리스트형처럼 어떤 검색 의도에 맞출지 고릅니다. 너무 많이 켜면 후보가 많아지므로 운영 초반엔 필요한 유형만 켜는 편이 안전합니다.", action: "유형을 확인한 뒤 화면 구상으로 넘어갑니다." },
    { focus: "template-design", tab: "templates", target: "templates-design", title: "발행 화면 구상 저장", body: "완성 글이 어떤 형태로 보일지 미리 고릅니다. 오른쪽 미리보기가 실제 상세 화면의 톤과 구조를 이해시키는 기준입니다.", action: "‘글 유형/화면 구상 저장’을 누르면 새 글부터 적용됩니다." },
    sourceSync,
    { focus: "academy-types", tab: "academies", target: "academies-types", title: "글에 넣을 학원 타입 제한", body: "운영 정책에 맞지 않는 타입은 글 생성에서 제외합니다. 예를 들어 실내운전연습장을 빼고 싶으면 추천 설정을 적용하세요.", action: "‘생성 타입 저장’ 후 후보 작성 단계로 이동합니다." },
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
    { tab: "plan", title: "기획", done: Boolean(domain.content_brief), count: domain.content_brief ? "완료" : "필요" },
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
        <p className="muted">처음 운영자는 기본 글 생성만 누르면 되고, 세부 조건을 만질 때만 고급 슬롯 생성을 쓰면 됩니다.</p>
      </div>
      <div className="grid grid-3">
        <FlowStartCard title="기본 글 생성" badge="추천" body="원천 데이터 → 1단계 후보 만들기 → 2단계 테스트 작성 → 검수까지 순서대로 안내합니다." cta="기본 흐름 시작" tone="primary" onClick={() => onStartFlow("basic")} />
        <FlowStartCard title="고급 슬롯 생성" badge="운영자용" body="기획·글유형·디자인·학원 타입·필터를 직접 조정하고 대량 후보로 확장합니다." cta="고급 흐름 시작" onClick={() => onStartFlow("advanced")} />
        <FlowStartCard title="검수/내보내기" badge="마감" body="작업 큐와 완성 글만 빠르게 확인해서 Markdown/HTML export와 색인 요청으로 넘깁니다." cta="검수 흐름 시작" onClick={() => onStartFlow("review")} />
      </div>
    </section>
    <StepLaunchPanel onStartFlow={onStartFlow} />
    <div className="grid grid-4">
      <Stat label="대기 슬롯" value={counts.planned} /><Stat label="진행" value={counts.in_progress} /><Stat label="발행" value={counts.published} accent /><Stat label="실패" value={counts.failed} />
    </div>
    <div className="grid grid-2">
      <div className="card card-pad"><h2>콘텐츠 기획</h2><p className="muted">{domain.content_brief || "아직 기획 메모가 없습니다."}</p><button className="btn" onClick={() => onTab("plan")}>기획 열기</button></div>
      <div className="card card-pad"><h2>글 유형/디자인</h2><p className="muted">글 유형 {domain.templates_enabled.length}개 · 디자인 {designSettingLabel(domain.design_template_id)}</p><button className="btn" onClick={() => onTab("templates")}>디자인 고르기</button></div>
    </div>
    <div className="card card-pad" data-tour="overview-quickstart"><h2>빠른 시작</h2><ol className="muted"><li>대시보드나 이 화면에서 기본/고급/검수 흐름 선택</li><li>슬롯 탭: 1단계 후보 만들기 → 2단계 글 작성 → 후보 목록 확인</li><li>작업 탭에서 진행 상태 확인</li><li>글 탭에서 검수하고 색인/중복/가지치기 실행</li></ol><p className="muted small">「기본 글 생성」을 누르면 분리된 카드 영역만 순서대로 포커싱합니다.</p></div>
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
  if (!domain.content_brief) return { title: "생성 방향을 먼저 저장하세요", desc: "후보는 있지만 기획 메모가 비어 있습니다. 어떤 글을 만들지 기준을 잡으면 생성 품질이 안정됩니다.", cta: "고급 2 시작", mode: "advanced", focus: "plan" };
  if (counts.published > 0) return { title: "완성 글을 검수하고 내보내세요", desc: `${counts.published.toLocaleString()}개 완성 글이 있습니다. 미리보기 후 Markdown/HTML export와 색인 요청으로 마감하세요.`, cta: "검수 3 시작", mode: "review", focus: "posts" };
  return { title: "글 후보를 새로 만드세요", desc: "현재 바로 작성할 대기 후보가 없습니다. 조건을 확인하고 후보를 다시 생성하세요.", cta: "기본 3 시작", mode: "basic", focus: "slot-create" };
}

function Plan({ domain, axes, busy, onSave, onRefresh, onTab }: { domain: DomainConfig; axes: DomainDetailPayload["axes"]; busy: boolean; onSave: (f: Record<string, unknown>) => Promise<void>; onRefresh: () => Promise<void>; onTab: (v: string) => void }) {
  const [brief, setBrief] = useState(domain.content_brief ?? "");
  const [excludedKeywords, setExcludedKeywords] = useState(domain.excluded_keywords ?? "");
  const [texts, setTexts] = useState<Record<Axis, string>>(() => Object.fromEntries(AXES.map((a) => [a, axes[a]?.map((v) => v.value).join("\n") ?? ""])) as Record<Axis, string>);
  async function save() {
    await Promise.all(AXES.map((axis) => {
      const values = parseLines(texts[axis]).map((value) => ({ value, weight: 3, monthly_search_volume: null, competition_kd: null }));
      return values.length ? replaceAxis(domain.domain, axis, values) : Promise.resolve();
    }));
    await onSave({ content_brief: brief.trim(), excluded_keywords: excludedKeywords.trim() });
    await onRefresh();
  }
  return <div className="card card-pad grid" data-tour="plan-brief">
    <h2>생성할 글 기획</h2>
    <Field label="이번에 생성할 글의 방향 / 검증된 자료"><textarea className="textarea" rows={7} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="수도권 직장인이 빠르게 운전면허를 따기 위해 지역별 학원, 비용, 셔틀 여부를 비교하는 글을 만든다." /></Field>
    <Field label="생성 제외 키워드/문구"><textarea className="textarea" rows={4} value={excludedKeywords} onChange={(e) => setExcludedKeywords(e.target.value)} placeholder={"실내운전연습장\n실내운전연습장 추천\n대성자동차학원 찾기 전 볼 인근 후보"} /><p className="muted small">한 줄에 하나씩 입력하면 후보 생성, 슬롯 검색, 작성 큐, 최종 저장 전에 제외됩니다.</p></Field>
    <div className="grid grid-2">{AXES.map((axis) => <Field key={axis} label={AXIS_LABEL[axis]}><textarea className="textarea" value={texts[axis]} onChange={(e) => setTexts((p) => ({ ...p, [axis]: e.target.value }))} placeholder={AXIS_PLACEHOLDER[axis]} /></Field>)}</div>
    <div className="row"><button className="btn primary" onClick={save} disabled={busy}>{busy ? "저장 중..." : "기획 저장"}</button><button className="btn" onClick={() => onTab("templates")}>글 유형 고르기</button><button className="btn" onClick={() => onTab("slots")}>글 후보 만들기</button></div>
  </div>;
}

// 도메인 디자인 설정의 특수값: 글마다 슬롯의 글 유형 기본 디자인(default_design)을 자동 적용한다.
const AUTO_DESIGN_ID = "auto";
const AUTO_DESIGN_OPTION = { id: AUTO_DESIGN_ID, name: "자동 (글 유형별 매칭)", summary: "글마다 슬롯의 글 유형에 맞는 기본 디자인을 자동으로 골라 발행합니다.", best_for: "여러 글 유형을 함께 켜서 운영할 때" };

function Templates({ domain, options, designPresets, busy, onSave, onRefresh }: { domain: DomainConfig; options: AdminOptions; designPresets: DesignTemplateOption[]; busy: boolean; onSave: (f: Record<string, unknown>) => Promise<void>; onRefresh: () => Promise<void> }) {
  const [enabled, setEnabled] = useState(new Set(domain.templates_enabled));
  const [design, setDesign] = useState<string>(domain.design_template_id ?? AUTO_DESIGN_ID);
  const [overrides, setOverrides] = useState<Record<string, string>>(domain.design_template_overrides ?? {});
  const [custom, setCustom] = useState(domain.custom_design_templates ?? "");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewTemplateId, setPreviewTemplateId] = useState(domain.templates_enabled[0] ?? Object.keys(options.template_specs)[0] ?? "");
  const [presetName, setPresetName] = useState("");
  const [presetHtml, setPresetHtml] = useState("");
  const [presetBusy, setPresetBusy] = useState(false);
  const allDesignTemplates: DesignTemplateOption[] = [...options.design_templates, ...designPresets];
  const designNameOf = (id?: string) => allDesignTemplates.find((d) => d.id === id)?.name ?? id ?? "local-guide";
  const designOptions = allDesignTemplates.filter((tpl) => tpl.id !== "custom");
  const cleanOverrides = () => Object.fromEntries(Object.entries(overrides).filter(([templateId, designId]) => enabled.has(templateId) && Boolean(designId)));
  const effectiveDesignForTemplate = (id: string) => cleanOverrides()[id] ?? options.template_specs[id]?.default_design ?? "local-guide";
  const enabledTemplateIds = Array.from(enabled).sort();
  const previewTemplate = enabled.has(previewTemplateId) ? previewTemplateId : enabledTemplateIds[0] ?? Object.keys(options.template_specs)[0] ?? "";
  // 자동 매칭이 실제로 적용할 디자인 목록: 켜진 글 유형(없으면 전체)의 기본 디자인.
  const autoTargetIds = Array.from(new Set((enabled.size ? enabledTemplateIds : Object.keys(options.template_specs)).map(effectiveDesignForTemplate)));
  const isAuto = design === AUTO_DESIGN_ID;
  const previewDesignId = isAuto ? effectiveDesignForTemplate(previewTemplate) : design;
  const previewModeLabel = isAuto ? (cleanOverrides()[previewTemplate] ? "수동 변경" : "자동 추천") : "전체 강제";
  const previewModeClass = isAuto ? (cleanOverrides()[previewTemplate] ? "warn" : "success") : "warn";
  const activeDesign = allDesignTemplates.find((d) => d.id === previewDesignId) ?? (isAuto ? AUTO_DESIGN_OPTION : options.design_templates[0]);
  const blueprint = designBlueprintFor(previewDesignId, activeDesign);
  if (previewDesignId === "custom" && custom.trim()) blueprint.lead = custom.trim();
  if (isAuto) blueprint.lead = `${previewTemplate} 글 유형에는 ${designNameOf(previewDesignId)} 화면 구상이 적용됩니다.`;
  const toggle = (id: string) => setEnabled((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const save = () => {
    if (enabled.size === 0 && !confirm("글 유형이 0개면 새 글 후보를 만들 수 없습니다. 디자인 설정만 저장할까요?")) return;
    onSave({ templates_enabled: Array.from(enabled).sort(), design_template_id: design, design_template_overrides: cleanOverrides(), custom_design_templates: custom.trim() });
  };
  async function uploadPreset() {
    if (!presetHtml.trim()) { alert("HTML 파일을 선택하거나 HTML 내용을 붙여넣어 주세요."); return; }
    setPresetBusy(true);
    try {
      await createDesignPreset(domain.domain, { name: presetName.trim(), html: presetHtml });
      setPresetName("");
      setPresetHtml("");
      await onRefresh();
    } catch (err) { alert(err instanceof Error ? err.message : String(err)); }
    finally { setPresetBusy(false); }
  }
  async function removePreset(id: string) {
    if (!confirm("이 HTML 기반 화면 구상을 삭제할까요? 이미 생성된 글에는 영향이 없습니다.")) return;
    setPresetBusy(true);
    try { await deleteDesignPreset(domain.domain, id); await onRefresh(); }
    catch (err) { alert(err instanceof Error ? err.message : String(err)); }
    finally { setPresetBusy(false); }
  }
  async function readPresetFile(file: File | null) {
    if (!file) return;
    setPresetName((prev) => prev || file.name.replace(/\.html?$/i, ""));
    setPresetHtml(await file.text());
  }
  return <div className="grid">
    <section className="card card-pad grid" data-tour="templates-types">
      <div className="spread"><div><h2>글 유형</h2><p className="muted">어떤 종류의 글을 만들지 고릅니다. 너무 많이 켜면 후보 수가 빠르게 늘어납니다.</p></div><span className="badge info">{enabled.size}개 사용 중</span></div>
      <div className="grid grid-2">{Object.entries(options.template_specs).map(([id, spec]) => <button key={id} className={`option-card ${enabled.has(id) ? "active" : ""}`} onClick={() => toggle(id)}>
        <div className="spread"><b><span className="badge">{id}</span> {spec.name}</b><span>{enabled.has(id) ? "✓" : ""}</span></div>
        <p className="muted small">primary: {spec.primary.join(", ")} · persona {spec.use_persona ? "사용" : "미사용"} · intent {spec.with_intent ? "사용" : "미사용"} · modifier {spec.modifier_count}</p>
        <div className="row">{spec.primary.map((axis) => <span key={axis} className="badge">{axis}</span>)}{spec.use_persona && <span className="badge">persona</span>}{spec.with_intent && <span className="badge">intent</span>}{spec.modifier_count > 0 && <span className="badge">modifier {spec.modifier_count}</span>}<span className="badge info">디자인 {designNameOf(spec.default_design)}</span></div>
      </button>)}</div>
    </section>

    <section className="grid">
      <div className="card card-pad grid" data-tour="templates-design">
        <div><h2>화면 구상 / 디자인</h2><p className="muted">기본은 글 유형별 자동 매칭입니다. 아래 표에서 특정 글 유형만 바꿀 수 있고, 전체 강제는 고급 설정에서만 사용합니다.</p></div>
        <div className="toast-info">
          <div className="spread"><div><b>{isAuto ? AUTO_DESIGN_OPTION.name : "전체 화면 구상 강제"}</b><p className="muted small">{isAuto ? AUTO_DESIGN_OPTION.summary : "모든 글 유형에 같은 화면 구상을 적용합니다. 글 유형별 수동 변경보다 우선합니다."}</p></div><span className={`badge ${isAuto ? "success" : "warn"}`}>{isAuto ? "권장" : "예외"}</span></div>
          <div className="row">{autoTargetIds.slice(0, 6).map((id) => <span key={id} className="badge">{designNameOf(id)}</span>)}</div>
        </div>
        <div className="grid">
          <div><h3>화면 구상 종류</h3><p className="muted small">아래 항목은 설명용입니다. 실제 적용은 글 유형별 표에서 변경하세요.</p></div>
          <div className="grid grid-2">{allDesignTemplates.map((tpl) => {
            const bp = designBlueprintFor(tpl.id, tpl);
            return <div key={tpl.id} className="option-card">
              <div className="spread"><b>{tpl.name}</b><span className="badge">{tpl.source_type === "uploaded_html" ? "HTML" : tpl.id}</span></div>
              <p className="muted small">{tpl.summary}</p>
              <p className="small"><b>추천:</b> {tpl.best_for}</p>
              <p className="small"><b>톤:</b> {bp.tone}</p>
              <div className="row">{bp.sections.slice(0, 4).map((section) => <span key={section} className="badge">{section}</span>)}</div>
              {tpl.source_type === "uploaded_html" && <button type="button" className="btn danger" disabled={presetBusy} onClick={() => removePreset(tpl.id)}>삭제</button>}
            </div>;
          })}</div>
        </div>
        <div className="grid">
          <div><h3>HTML 예시로 화면 구상 추가</h3><p className="muted small">블로그 예시 HTML을 업로드하면 섹션 흐름, 톤, CSS 힌트를 추출해 화면 구상 프리셋으로 저장합니다.</p></div>
          <div className="grid grid-2">
            <Field label="프리셋 이름"><input className="input" value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="예: 우리 블로그 카드형 스타일" /></Field>
            <Field label="HTML 파일"><input className="input" type="file" accept=".html,.htm,text/html" onChange={(e) => readPresetFile(e.target.files?.[0] ?? null)} /></Field>
          </div>
          <Field label="HTML 내용"><textarea className="textarea mono" rows={7} value={presetHtml} onChange={(e) => setPresetHtml(e.target.value)} placeholder="<html>...</html>" /></Field>
          <div className="row"><button type="button" className="btn" disabled={presetBusy || !presetHtml.trim()} onClick={uploadPreset}>{presetBusy ? "저장 중..." : "HTML 화면 구상 저장"}</button><span className="muted small">저장 후 아래 수동 변경 드롭다운에 표시됩니다.</span></div>
        </div>
        <div className="grid">
          <div><h3>글 유형별 화면 구상</h3><p className="muted small">자동 모드에서만 적용됩니다. 대부분은 자동 추천 그대로 두고, 특정 글 유형만 다른 화면으로 바꾸고 싶을 때 오른쪽에서 변경하세요.</p></div>
          <div className="table-wrap"><table>
            <thead><tr><th>글 유형</th><th>자동 추천 화면</th><th>수동 변경</th><th>실제 적용</th></tr></thead>
            <tbody>{Object.entries(options.template_specs).filter(([id]) => enabled.has(id)).map(([id, spec]) => {
              const defaultDesign = spec.default_design ?? "local-guide";
              const manualDesign = overrides[id] ?? "";
              const effectiveDesign = manualDesign || defaultDesign;
              return <tr key={id}>
                <td><b>{id}</b><p className="muted small">{spec.name}</p></td>
                <td><span className="badge">{designNameOf(defaultDesign)}</span></td>
                <td><select className="select" value={manualDesign} onChange={(e) => setOverrides((prev) => {
                  const next = { ...prev };
                  if (e.target.value) next[id] = e.target.value;
                  else delete next[id];
                  return next;
                })}>
                  <option value="">자동 추천 그대로</option>
                  {allDesignTemplates.map((tpl) => <option key={tpl.id} value={tpl.id}>{tpl.name}</option>)}
                </select></td>
                <td><span className={`badge ${manualDesign ? "warn" : "success"}`}>{manualDesign ? "수동 변경" : "자동 추천"}</span><p className="muted small">{designNameOf(effectiveDesign)}</p></td>
              </tr>;
            })}</tbody>
          </table></div>
        </div>
        <Field label="직접 만드는 화면 구상 메모">
          <textarea className="textarea" rows={7} value={custom} onChange={(e) => setCustom(e.target.value)} placeholder={`첫 화면에는 큰 제목과 핵심 요약 3개를 둔다.
비교표는 본문 상단에 배치한다.
CTA는 중간 1회, 마지막 1회만 사용한다.
모바일에서는 카드형 목록으로 보이게 한다.`} />
          <p className="muted small">글 유형별 화면 구상에서 '커스텀'을 선택한 글에만 이 메모가 작성 프롬프트로 들어갑니다.</p>
        </Field>
        <Field label="고급: 전체 화면 구상 강제">
          <select className="select" value={design} onChange={(e) => setDesign(e.target.value)}>
            <option value={AUTO_DESIGN_ID}>사용 안 함 - 글 유형별 자동 추천</option>
            {designOptions.map((tpl) => <option key={tpl.id} value={tpl.id}>모든 글을 {tpl.name}으로 강제</option>)}
          </select>
          <p className="muted small">특별한 브랜드 운영 정책이 있을 때만 사용하세요. 강제하면 글 유형별 수동 변경은 저장만 되고 생성에는 적용되지 않습니다.</p>
        </Field>
        {!isAuto && <p className="toast-warn">전체 화면 구상 강제 모드입니다. 글 유형별 화면 구상보다 현재 고급 설정이 우선 적용됩니다.</p>}
        <div className="preview-toggle-panel">
          <div className="spread">
            <div>
              <h3>실제 적용 미리보기</h3>
              <p className="muted small">선택한 글 유형에 적용될 화면 구상을 예시로 확인합니다.</p>
            </div>
            <button type="button" className="btn" onClick={() => setPreviewOpen((v) => !v)}>{previewOpen ? "미리보기 닫기" : "미리보기 열기"}</button>
          </div>
          <div className="row">
            <Field label="미리볼 글 유형">
              <select className="select" value={previewTemplate} onChange={(e) => setPreviewTemplateId(e.target.value)}>
                {(enabledTemplateIds.length ? enabledTemplateIds : Object.keys(options.template_specs)).map((id) => <option key={id} value={id}>{id} {options.template_specs[id]?.name ?? ""}</option>)}
              </select>
            </Field>
            <span className={`badge ${previewModeClass}`}>{previewModeLabel}</span>
            <span className="badge info">{designNameOf(previewDesignId)}</span>
          </div>
          {previewOpen && <DesignPreview blueprint={blueprint} designId={previewDesignId} brandColor={domain.brand_color} brand={publicBrandName(domain.display_name)} title={activeDesign.name} summary={activeDesign.summary} />}
        </div>
        <div className="row"><button className="btn primary" disabled={busy} onClick={save}>{busy ? "저장 중..." : "글 유형/화면 구상 저장"}</button><span className="muted small">저장 후 새 글 후보/생성글부터 적용됩니다.</span></div>
      </div>
    </section>
  </div>;
}

function designBlueprintFor(id: string, option?: DesignTemplateOption): typeof DESIGN_BLUEPRINTS[string] {
  const builtin = DESIGN_BLUEPRINTS[id];
  if (builtin) return { ...builtin };
  const sections = option?.structure_guide?.length ? option.structure_guide : ["상단 구성", "본문 섹션", "비교/요약", "CTA"];
  return {
    label: option?.summary || "업로드 HTML에서 추출한 화면 구상",
    title: `${option?.name || "업로드 화면 구상"} 예시 글`,
    lead: option?.summary || "업로드한 HTML의 섹션 흐름과 시각 스타일 힌트를 반영합니다.",
    chips: ["HTML 기반", "사용자 프리셋", "화면 구상"],
    sections,
    tone: option?.tone || "업로드 예시 기반 브랜드 톤",
    blocks: sections.slice(0, 4).map((section, index) => ({
      title: section.replace(/^\d+\)\s*/, ""),
      body: index === 0 ? "예시 HTML에서 추출한 상단 구성과 문단 리듬을 따릅니다." : "색상, 카드감, 여백, CTA 강조 방식은 업로드 예시의 분위기를 참고합니다.",
      kind: index === 2 ? "table" : index === 3 ? "cta" : undefined,
    })),
  };
}

function Axes({ domain, axes, options, onRefresh }: { domain: DomainConfig; axes: DomainDetailPayload["axes"]; options: AdminOptions; onRefresh: () => Promise<void> }) {
  const [aiBusy, setAiBusy] = useState(false);
  async function saveAxis(axis: Axis, form: HTMLFormElement) {
    const values = parseCsv(String(new FormData(form).get("values") || ""));
    await replaceAxis(domain.domain, axis, values); await onRefresh();
  }
  async function preset(form: HTMLFormElement) { const preset_key = String(new FormData(form).get("preset_key") || ""); await api(`/domains/${encodeURIComponent(domain.domain)}/axes/preset`, { method: "POST", body: JSON.stringify({ preset_key }) }); await onRefresh(); }
  async function ai(form: HTMLFormElement) { setAiBusy(true); try { const fd = new FormData(form); await api(`/domains/${encodeURIComponent(domain.domain)}/axes/ai-fill`, { method: "POST", body: JSON.stringify({ provider: fd.get("provider"), model: fd.get("model"), extra_context: fd.get("extra_context"), timeout_sec: 300 }) }); await onRefresh(); } catch (e) { alert((e as Error).message); } finally { setAiBusy(false); } }
  return <div className="grid">
    <div className="grid grid-2">
      <form className="card card-pad grid" onSubmit={(e) => { e.preventDefault(); ai(e.currentTarget); }}><h2>🤖 AI로 축 자동 생성</h2><textarea className="textarea" name="extra_context" placeholder="추가 컨텍스트" /><div className="row"><select className="select" name="provider" style={{ maxWidth: 160 }}><option>codex</option><option>claude</option></select><input className="input" name="model" placeholder="모델 선택" style={{ maxWidth: 180 }} /><button className="btn primary" disabled={aiBusy}>{aiBusy ? "생성 중..." : "생성"}</button></div></form>
      <form className="card card-pad grid" onSubmit={(e) => { e.preventDefault(); if (confirm("현재 축을 프리셋으로 덮어쓸까요?")) preset(e.currentTarget); }}><h2>프리셋 적용</h2><select className="select" name="preset_key">{options.preset_options.map((p) => <option key={p}>{p}</option>)}</select><button className="btn">덮어쓰기</button></form>
    </div>
    {AXES.map((axis) => <form key={axis} className="card card-pad grid" onSubmit={(e) => { e.preventDefault(); saveAxis(axis, e.currentTarget); }}><div className="spread"><h2>{axis} 축 ({axes[axis]?.length ?? 0}개)</h2><button className="btn primary">저장</button></div><textarea className="textarea mono" name="values" rows={6} defaultValue={(axes[axis] ?? []).map((r) => `${r.value},${r.weight},${r.monthly_search_volume ?? ""},${r.competition_kd ?? ""}`).join("\n")} placeholder="값,가중치,월검색량,KD" /></form>)}
  </div>;
}

function Academies({ domain, academies, busy, onSave, onRefresh }: { domain: DomainConfig; academies: Academy[]; busy: boolean; onSave: (f: Record<string, unknown>) => Promise<void>; onRefresh: () => Promise<void> }) {
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
  const [generationTypes, setGenerationTypes] = useState(new Set(domain.academy_type_filter ?? []));
  const [runtimeApis, setRuntimeApis] = useState<RuntimeApis | null>(null);
  const [loading, setLoading] = useState(false);
  const [filterError, setFilterError] = useState("");
  useEffect(() => { setRemoteAcademies(academies); setRemoteTotal(academies.length); }, [academies]);
  useEffect(() => { setGenerationTypes(new Set(domain.academy_type_filter ?? [])); }, [domain.academy_type_filter]);
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
      await onRefresh();
    } catch (e) { alert((e as Error).message); }
    finally { setSyncBusy(""); }
  }
  function toggleGenerationType(type: string) {
    setGenerationTypes((prev) => {
      const next = new Set(prev);
      next.has(type) ? next.delete(type) : next.add(type);
      return next;
    });
  }
  async function saveGenerationTypes() {
    await onSave({ academy_type_filter: Array.from(generationTypes) });
    await onRefresh();
  }
  const knownTypeValues = academyTypes.map((type) => type.value);
  const includedTypes = generationTypes.size ? knownTypeValues.filter((type) => generationTypes.has(type)) : knownTypeValues;
  const excludedTypes = generationTypes.size ? knownTypeValues.filter((type) => !generationTypes.has(type)) : [];
  const generationRuleText = generationTypes.size ? `${includedTypes.map(typeLabel).join(", ")}만 사용` : "전체 타입 사용";
  const recommendedTypes = knownTypeValues.filter((type) => type !== "indoor_academy");
  return <div className="grid">
    <div className="card card-pad grid" data-tour="academies-sync">
      <div className="spread"><div><h2>DrivingPlus 원천 데이터 동기화</h2><p className="muted">Swagger API의 학원/지역 데이터를 가져와 글 생성 프롬프트의 검증된 자료로 사용합니다.</p></div><span className="badge info">{remoteTotal}개 학원</span></div>
      <div className="writer-hint">
        <b>현재 적용 API</b>
        <span>관리자/Nest: <code>{runtimeApis?.admin_api_base ?? "확인 중..."}</code></span>
        <span>DrivingPlus 원천: <code>{runtimeApis?.drivingplus_api_base ?? "확인 중..."}</code></span>
        {runtimeApis && <span>학원: <code>{runtimeApis.drivingplus_endpoints.academies}</code></span>}
        {runtimeApis && <span>일반 리뷰: <code>{runtimeApis.drivingplus_endpoints.reviews}</code></span>}
        {runtimeApis && <span>블로그 리뷰: <code>{runtimeApis.drivingplus_endpoints.blog_reviews}</code></span>}
        {runtimeApis && <span>동기화 기본값: 일반 리뷰 {runtimeApis.sync_defaults.review_limit}개({runtimeApis.sync_defaults.review_sort}), 블로그 리뷰 {runtimeApis.sync_defaults.blog_review_limit}개</span>}
        {runtimeApis && <span className="muted small">{runtimeApis.sync_defaults.review_source_note}</span>}
      </div>
      <div className="grid grid-3">
        <Field label="지역 레벨"><select className="select" value={regionLevel} onChange={(e) => setRegionLevel(e.target.value as "2" | "3" | "all")}><option value="2">시군구(level=2, 권장)</option><option value="3">읍면동(level=3, 최대 500개)</option><option value="all">전체</option></select></Field>
        <Field label="지역 축 반영"><label className="row small" style={{ minHeight: 42 }}><input type="checkbox" checked={replaceRegionAxis} onChange={(e) => setReplaceRegionAxis(e.target.checked)} /> axes.region 교체</label></Field>
        <div className="row" style={{ alignItems: "end" }}><button className="btn" onClick={syncRegions} disabled={Boolean(syncBusy)}>{syncBusy === "regions" ? "지역 동기화 중..." : "지역 동기화"}</button><button className="btn primary" onClick={syncAcademies} disabled={Boolean(syncBusy)}>{syncBusy === "academies" ? "학원 동기화 중..." : "학원 동기화"}</button></div>
      </div>
      {syncResult && <p className="small badge success" style={{ width: "fit-content" }}>{syncResult}</p>}
      <p className="muted small">권장 순서: 지역 동기화(level=2, 축 교체) → 학원 동기화(사진·별점리뷰·블로그 리뷰 포함) → 슬롯 탭에서 후보 생성.</p>
    </div>
    <div className="card card-pad"><p className="muted">슬롯 지역과 일치하거나 가까운 원천 자료가 생성 프롬프트에 주입됩니다. 외부 원천 API 자료는 SEO 설명, vphone, 사진 URL, 별점 리뷰, 블로그 리뷰글도 함께 사용됩니다.</p></div>
    <div className="card card-pad grid">
      <div className="spread"><h2>학원자료 필터</h2><span className="muted small">{remoteTotal.toLocaleString()}개{loading ? " 검색 중" : ""}</span></div>
      <p className="muted small">아래 필터는 표에서 자료를 찾아보는 용도입니다. 글 생성 기준을 바꾸려면 다음 카드의 “글 생성 사용 타입”을 저장하세요.</p>
      <div className="grid grid-4">
        <Field label="검색"><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="학원명, 주소, SEO 설명" /></Field>
        <Field label="지역"><input className="input" value={region} onChange={(e) => setRegion(e.target.value)} placeholder="서울, 부산, 강남구" /></Field>
        <Field label="API 타입"><select className="select" value={academyType} onChange={(e) => setAcademyType(e.target.value)}><option value="">전체 타입</option>{academyTypes.map((type) => <option key={type.value} value={type.value}>{type.value} ({type.count})</option>)}</select></Field>
        <Field label="사진"><label className="row small" style={{ minHeight: 42 }}><input type="checkbox" checked={hasPhotos} onChange={(e) => setHasPhotos(e.target.checked)} /> 사진 있는 학원만</label></Field>
      </div>
      {filterError && <p className="small" style={{ color: "var(--danger)" }}>필터 오류: {filterError}</p>}
    </div>
    <div className="card card-pad grid" data-tour="academies-types">
      <div className="spread"><div><h2>글 생성 사용 타입</h2><p className="muted small">저장한 타입만 글 생성 프롬프트의 학원 후보로 들어갑니다. 실내운전연습장을 빼고 싶으면 추천 설정을 쓰면 됩니다.</p></div><button className="btn primary" onClick={saveGenerationTypes} disabled={busy || !academyTypes.length}>{busy ? "저장 중..." : "생성 타입 저장"}</button></div>
      <div className="writer-hint"><b>현재 생성 기준</b><span>{generationRuleText}</span>{excludedTypes.length > 0 && <span>제외: {excludedTypes.map(typeLabel).join(", ")}</span>}</div>
      <div className="row">
        <button className="btn" onClick={() => setGenerationTypes(new Set(recommendedTypes))} disabled={!recommendedTypes.length}>추천 적용: 실내운전연습장 제외</button>
        <button className="btn" onClick={() => setGenerationTypes(new Set(["exam_academy"].filter((type) => knownTypeValues.includes(type))))} disabled={!knownTypeValues.includes("exam_academy")}>전문학원만</button>
        <button className="btn" onClick={() => setGenerationTypes(new Set())}>전체 타입 사용</button>
      </div>
      <div className="grid grid-3">{academyTypes.map((type) => {
        const copy = ACADEMY_TYPE_COPY[type.value] ?? { label: type.value, desc: "DrivingPlus API에서 받은 원천 타입", tone: "info" as const };
        const active = generationTypes.size ? generationTypes.has(type.value) : true;
        return <button key={type.value} className={`option-card ${active ? "active" : ""}`} onClick={() => toggleGenerationType(type.value)}>
          <div className="spread"><b>{copy.label}</b><span className={`badge ${copy.tone}`}>{type.count}개</span></div>
          <p className="muted small">{copy.desc}</p>
          <p className="muted small mono">{type.value}</p>
          <span className={`badge ${active ? "success" : "danger"}`}>{active ? "글 생성에 포함" : "글 생성에서 제외"}</span>
        </button>;
      })}</div>
      {!academyTypes.length && <p className="muted small">먼저 학원 동기화를 실행하면 API 타입 목록이 표시됩니다.</p>}
    </div>
    <form className="card card-pad grid" onSubmit={(e) => { e.preventDefault(); add(e.currentTarget); }}><h2>학원 1곳 추가</h2><div className="grid grid-3">{["region","name","address","price","shuttle","hours","pass_rate","phone","source_name","source_url","review"].map((n) => <input key={n} className="input" name={n} placeholder={n} required={n === "name"} />)}</div><button className="btn primary">추가</button></form>
    <form className="card card-pad grid" onSubmit={(e) => { e.preventDefault(); bulk(e.currentTarget); }}><h2>JSON 일괄 업로드</h2><textarea className="textarea mono" name="json" placeholder='[{"region":"대구","name":"OO학원","price":"65만원"}]' /><button className="btn">업로드</button></form>
    <div className="table-wrap"><table><thead><tr><th>지역</th><th>학원명</th><th>API 타입</th><th>전화/사진</th><th>SEO 설명</th><th>출처</th><th></th></tr></thead><tbody>{remoteAcademies.map((a) => {
      const photoCount = parsePhotoCount(a.photos);
      const reviewCount = parseJsonCount(a.review_json);
      const blogReviewCount = parseJsonCount(a.blog_reviews);
      return <tr key={a.id}><td>{a.region}</td><td><b>{a.name}</b><p className="muted small">{a.address}</p><p className="muted small">{a.external_id ? `#${a.external_id}` : ""}</p></td><td><span className="badge">{a.academy_type || "-"}</span></td><td>{a.vphone || a.phone}<p className="muted small">{photoCount ? `사진 ${photoCount}장` : "사진 없음"} · 리뷰 {reviewCount}개 · 블로그 {blogReviewCount}개</p></td><td><span className="small">{a.seo_description || a.review || "-"}</span></td><td>{a.source_url ? <a href={a.source_url} target="_blank">{a.source_name || "링크"}</a> : a.source_name}</td><td><button className="btn danger" onClick={() => del(a.id)}>삭제</button></td></tr>;
    })}</tbody></table></div>
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
  const [timeout, setTimeout] = useState(genDefaults.timeoutSec);
  const [web, setWeb] = useState(genDefaults.web);
  const [imageGen, setImageGen] = useState(genDefaults.imageGen);
  const [imageSize, setImageSize] = useState(genDefaults.imageSize);
  const [max, setMax] = useState(200);
  const [remoteSlots, setRemoteSlots] = useState(slots);
  const [remoteTotal, setRemoteTotal] = useState(slots.length);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [queueBusy, setQueueBusy] = useState(false);
  const [busy, setBusy] = useState(false); // 후보 생성/삭제 등 느린 작업 로딩
  const [slotError, setSlotError] = useState("");

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
  const writerPayload = { provider, model, design_template_id: domain.design_template_id, use_web_research: web, cooldown_sec: cooldown, timeout_sec: timeout, enable_image_generation: imageGen, image_size: imageSize, image_count: 1, image_provider: "private-codex" };
  const exclusionLines = parseLines(domain.excluded_keywords ?? "");

  async function gen() { if (busy || queueBusy) return; setBusy(true); try { await api(`/domains/${encodeURIComponent(domain.domain)}/slots/generate`, { method: "POST", body: JSON.stringify({ max_per_template: max }) }); await onRefresh(); await loadCurrentSlots(); } catch (err) { alert(err instanceof Error ? err.message : String(err)); } finally { setBusy(false); } }
  async function queue(ids: string[]) {
    if (!ids.length || queueBusy) return;
    setQueueBusy(true);
    try {
      const r = await enqueueGenerate(domain.domain, { slot_ids: ids, max_per_template: max, ...writerPayload });
      alert(`작업 큐 등록: ${r.job_id} · ${r.slot_count ?? ids.length}개\\n작업 탭에서 진행상태를 확인하세요.`);
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
      alert(`${label} 큐 등록: ${r.job_id} · ${r.slot_count ?? count}개\\n작업 탭에서 진행상태를 확인하세요.`);
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
          <p className="muted small">지역·키워드·의도 축을 조합해 작성 대기 목록(planned 슬롯)을 만듭니다. LLM을 호출하지 않습니다.</p>
        </div>
        <div className="row slot-panel-actions">
          <Field label="템플릿당 최대">
            <input className="input" type="number" value={max} onChange={(e) => setMax(Number(e.target.value))} style={{ width: 120 }} />
          </Field>
          <button className="btn primary" data-tour="slots-create" disabled={busy || queueBusy} onClick={gen}>{busy ? "만드는 중..." : "재료로 글 후보 만들기"}</button>
        </div>
        <p className="muted small">조합 재료는 기획 탭 축·글유형 설정·제외어를 따릅니다. 프리셋을 적용했다면 별도 동기화 없이도 후보를 만들 수 있습니다.</p>
        {exclusionLines.length > 0 && <p className="muted small">적용 중인 제외: {exclusionLines.slice(0, 5).join(", ")}{exclusionLines.length > 5 ? " ..." : ""}</p>}
      </div>

      <div className="card card-pad grid slot-panel" data-tour="slots-writer">
        <div>
          <p className="eyebrow">2단계</p>
          <h2>글 작성</h2>
          <p className="muted small">후보를 골라 생성 작업 큐에 넣습니다. 후보가 없으면 먼저 ‘재료로 글 후보 만들기’로 후보를 만든 뒤 작성하세요. (작성 버튼은 후보를 자동 생성하지 않습니다.)</p>
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
          <label className="row small"><input type="checkbox" checked={imageGen} onChange={(e) => setImageGen(e.target.checked)} /> Codex 이미지 생성</label>
          <Field label="이미지 크기"><select className="select" value={imageSize} onChange={(e) => setImageSize(e.target.value)}><option value="1024x1024">1024 정방형</option><option value="1536x1024">1536 가로형</option><option value="1024x1536">1024 세로형</option></select></Field>
        </div>
        <div className="writer-hint"><b>작성 옵션</b><span>{provider}{model ? ` / ${model}` : " / 기본"}</span><span>디자인 {designSettingLabel(domain.design_template_id)}</span><span>웹자료 {web ? "사용" : "미사용"}</span><span>이미지 {imageGen ? `생성 / ${imageSize}` : "미사용"}</span><span>선택 기준 예상 {expectedMinutes}분</span></div>
        <p className="muted small">추천: 1개 테스트 작성 → QA 확인 → 현재 검색 10개 → 전국 골고루 100개. 전국 작성은 지역을 라운드로빈으로 섞습니다.</p>
      </div>

      <div className="card card-pad grid" data-tour="slots-list">
        <div data-tour="slots-list-head">
          <p className="eyebrow">후보 목록</p>
          <h2>슬롯 검색·선택</h2>
          <p className="muted small">아래 필터는 목록 표시와 「현재 검색 N개 작성」 선별에 쓰입니다.</p>
        </div>
        <div className="row" data-tour="slots-filter">
          <select className="select" style={{ width: 150 }} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">전체 상태</option>{["planned","in_progress","published","failed","pruned"].map((s) => <option key={s}>{s}</option>)}</select>
          <select className="select" style={{ width: 150 }} value={template} onChange={(e) => setTemplate(e.target.value)}><option value="">전체 유형</option>{options.templates.map((t) => <option key={t}>{t}</option>)}</select>
          <input className="input" style={{ width: 320 }} placeholder="지역/키워드/슬롯 검색 예: 서울, 강남구" value={q} onChange={(e) => setQ(e.target.value)} />
          {["서울","강남구","송파구","경기","부산","대구","제주"].map((label) => <button className="btn" key={label} onClick={() => setQ(label)}>{label}</button>)}
          <span className="muted small">{selected.size}개 선택 / {remoteTotal.toLocaleString()}개{loadingSlots ? " 검색 중" : ""}</span>
          <button className="btn primary" disabled={!selected.size || queueBusy || busy} onClick={() => queue(Array.from(selected))}>{queueBusy ? "큐 등록 중..." : "선택 글 작성"}</button>
          <button className="btn danger" disabled={!selected.size || busy || queueBusy} onClick={delSelected}>{busy ? "삭제 중..." : "삭제"}</button>
        </div>
        {slotError && <p className="small" style={{ color: "var(--danger)" }}>슬롯 검색 오류: {slotError}</p>}
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
      <div className="writer-hint"><b>운영 순서</b><span>슬롯 탭에서 작성 등록</span><span>작업 탭에서 진행 확인</span><span>완료 후 글 탭에서 검수</span><span>필요 시 npm run worker:once</span></div>
      {active > 0 && <p className="muted small">대기/진행 작업이 멈춰 있으면 서버 터미널에서 <code>npm run worker:once</code>를 실행해 처리할 수 있습니다.</p>}
    </div>
    <div className="row">
      <select className="select" style={{ width: 180 }} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">전체 상태</option>{["queued", "running", "done", "failed"].map((s) => <option key={s}>{s}</option>)}</select>
      <span className="muted small">{filtered.length}개 표시 / 전체 {jobs.length}개</span>
      <Link href="/jobs" className="btn">전체 작업 큐 열기</Link>
    </div>
    {filtered.length === 0 && <div className="card card-pad muted">아직 작업이 없습니다. 슬롯 탭에서 “1개 테스트 작성”부터 등록하세요.</div>}
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
  return <div className="grid"><div className="card card-pad grid"><h2>메타 정보</h2><Field label="표시 이름"><input className="input" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} /></Field><div className="grid grid-2"><Field label="업종"><input className="input" value={form.vertical} onChange={(e) => setForm({ ...form, vertical: e.target.value })} /></Field><Field label="테마"><select className="select" value={form.theme} onChange={(e) => setForm({ ...form, theme: e.target.value })}>{options.themes.map((t) => <option key={t}>{t}</option>)}</select></Field></div><div className="grid grid-2"><Field label="브랜드 컬러"><div className="row"><input className="input-color" type="color" value={form.brand_color} onChange={(e) => setForm({ ...form, brand_color: e.target.value })} /><code className="mono small">{form.brand_color}</code></div></Field><Field label="일일 한도 (0=무제한)"><input className="input" type="number" min={0} value={form.daily_limit} onChange={(e) => setForm({ ...form, daily_limit: Math.max(0, Number(e.target.value) || 0) })} /></Field></div><div className="brand-color-preview" style={{ ["--accent" as string]: previewTheme.accent, ["--accent-soft" as string]: previewTheme.soft, ["--primary" as string]: previewTheme.accent }}><div className="preview-top"><b>브랜드 컬러 미리보기</b><span className="preview-cta">CTA</span></div><div className="preview-bottom-cta"><b>하단 CTA 영역</b><button type="button" className="btn primary">버튼</button></div></div><p className="muted small">미리보기·발행 글·외부 사이트 CTA에 이 색이 반영됩니다. 저장 후 글 유형/디자인 탭에서도 확인하세요.</p><button className="btn primary" onClick={() => onSave(form)}>저장</button></div><div className="card card-pad grid"><h2>도메인 삭제</h2><p className="muted small">이 도메인과 모든 슬롯·글 데이터가 함께 삭제됩니다. 되돌릴 수 없습니다.</p><button className="btn danger" disabled={delBusy} onClick={deleteDomain}>{delBusy ? "삭제 중..." : "도메인 삭제"}</button></div></div>;
}

function DesignPreview({ blueprint, designId, brandColor, brand, title, summary }: { blueprint: typeof DESIGN_BLUEPRINTS[string]; designId: string; brandColor?: string | null; brand: string; title: string; summary: string }) {
  const spec = PREVIEW_DESIGN_SPECS[designId] ?? PREVIEW_DESIGN_SPECS.editorial;
  const theme = getDesignTheme(designId, brandColor);
  const previewStyle = { ["--accent" as string]: theme.accent, ["--accent-soft" as string]: theme.soft, ["--primary" as string]: theme.accent, background: theme.pageBg };
  return <aside className="preview-panel">
    <div className="preview-head"><div><b>디자인 미리보기</b><p className="muted small">{blueprint.label}</p></div><span className="badge info">{designId}</span></div>
    <div className={`preview-phone design-${designId}`} style={previewStyle}>
      <div className="preview-top"><div><b>{brand}</b><p>{blueprint.tone}</p></div><span className="preview-cta">{spec.topCta}</span></div>
      <div className="preview-hero"><span>대표 영역</span></div>
      <div className="preview-body">
        <div className="preview-meta"><span>26.04.03</span><span>조회 0</span></div>
        <h4>{blueprint.title}</h4>
        <div className="preview-divider" />
        <div className="row">{blueprint.chips.map((chip) => <span className="badge" key={chip}>{chip}</span>)}</div>
        <p className="muted small">{blueprint.lead}</p>
        {blueprint.blocks.map((block) => <PreviewBlock key={block.title} block={block} />)}
        <section className="preview-bottom-cta"><b>{brand}에서 {spec.bottomCta}</b><button className="btn primary">{spec.bottomCta}</button></section>
      </div>
    </div>
    <div className="card card-pad preview-spec">
      <h3>{title}</h3>
      <p className="muted small">{summary}</p>
      <p className="small"><b>톤:</b> {blueprint.tone}</p>
      <div className="row">{blueprint.sections.map((s) => <span className="badge" key={s}>{s}</span>)}</div>
    </div>
  </aside>;
}

function PreviewBlock({ block }: { block: typeof DESIGN_BLUEPRINTS[string]["blocks"][number] }) {
  if (block.kind === "table") return <div className="preview-block"><b>{block.title}</b><div className="mini-table"><span>항목</span><span>장점</span><span>추천</span><span>A 학원</span><span>셔틀</span><span>직장인</span><span>B 학원</span><span>단기반</span><span>대학생</span></div><p>{block.body}</p></div>;
  if (block.kind === "quote") return <blockquote className="preview-quote">{block.body}</blockquote>;
  if (block.kind === "cta") return <div className="preview-block preview-cta-block"><b>{block.title}</b><p>{block.body}</p><button className="btn primary">상담/예약으로 연결</button></div>;
  if (block.kind === "list") return <div className="preview-block"><b>{block.title}</b><ul>{block.body.split("|").map((item) => <li key={item}>✓ {item}</li>)}</ul></div>;
  return <div className="preview-block"><b>{block.title}</b><p>{block.body}</p></div>;
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) { return <div className="card stat"><div className="muted small">{label}</div><div className="num" style={{ color: accent ? "var(--success)" : undefined }}>{value}</div></div>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label><span className="label">{label}</span>{children}</label>; }
function Status({ status }: { status: string }) { const cls = status === "published" || status === "done" ? "success" : status === "failed" ? "danger" : status === "running" || status === "in_progress" ? "info" : status === "planned" || status === "queued" ? "warn" : ""; return <span className={`badge ${cls}`}>{status}</span>; }
function typeLabel(type: string): string { return ACADEMY_TYPE_COPY[type]?.label ?? type; }
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
