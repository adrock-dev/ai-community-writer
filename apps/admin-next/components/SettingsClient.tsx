"use client";

import { api, getOptions } from "@/lib/api";
import { DEFAULT_GENERATION_DEFAULTS, useGenerationDefaults } from "@/lib/generation-defaults";
import { useTourEnabled } from "@/lib/tour";
import type { Provider } from "@/lib/types";
import Link from "next/link";
import { useEffect, useState } from "react";

const IMAGE_SIZES: Array<{ value: string; label: string }> = [
  { value: "1024x1024", label: "1024 정방형" },
  { value: "1536x1024", label: "1536 가로형" },
  { value: "1024x1536", label: "1024 세로형" },
];

export default function SettingsClient() {
  const [tourEnabled, setTourEnabled] = useTourEnabled();
  const [gen, setGen] = useGenerationDefaults();
  const [providers, setProviders] = useState<Provider[]>(["codex", "claude"]);
  const [indexingHasKey, setIndexingHasKey] = useState(false);
  const [indexUrl, setIndexUrl] = useState("");
  const [saJson, setSaJson] = useState("");
  const [savingIndex, setSavingIndex] = useState(false);

  async function loadOptions() {
    const opts = await getOptions();
    if (opts.providers?.length) setProviders(opts.providers);
    setIndexingHasKey(opts.indexing.has_key);
    setIndexUrl((prev) => prev || opts.indexing.url_template);
  }

  useEffect(() => {
    // 백엔드 미연결 시 provider 내장 목록/빈 색인값을 유지한다.
    loadOptions().catch(() => {});
  }, []);

  async function saveIndexing() {
    setSavingIndex(true);
    try {
      await api("/settings/indexing", { method: "PUT", body: JSON.stringify({ sa_json: saJson, url_template: indexUrl }) });
      setSaJson("");
      await loadOptions();
      alert("색인 설정 저장됨 — 전 도메인 공통 적용");
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setSavingIndex(false);
    }
  }

  const patch = (fields: Partial<typeof gen>) => setGen({ ...gen, ...fields });
  const isDefault = JSON.stringify(gen) === JSON.stringify(DEFAULT_GENERATION_DEFAULTS);

  return (
    <div>
      <div className="page-head">
        <div>
          <p className="eyebrow">관리자</p>
          <h1>설정</h1>
          <p className="muted">튜토리얼·생성 기본값은 이 브라우저에만 저장됩니다. Google 색인 설정은 서버에 저장되어 전 도메인에 공통 적용됩니다.</p>
        </div>
      </div>

      <section className="card card-pad grid" style={{ maxWidth: 720 }}>
        <div>
          <div className="row" style={{ gap: 8 }}>
            <h2 style={{ margin: 0 }}>운영 튜토리얼</h2>
            <span className={`badge ${tourEnabled ? "success" : ""}`}>{tourEnabled ? "켜짐" : "꺼짐"}</span>
          </div>
          <p className="muted small" style={{ marginTop: 6 }}>
            「기본/고급/검수 흐름 시작」이나 「기본 N 시작」을 누르면 단계별 가이드가 표시됩니다.
            × 또는 Esc로 이번 안내만 닫을 수 있고, 「더 이상 안 보기」는 이후 자동 제안을 끕니다.
          </p>
        </div>
        <label className="row">
          <input
            type="checkbox"
            checked={tourEnabled}
            onChange={(e) => setTourEnabled(e.target.checked)}
          />
          <span>흐름 시작 시 튜토리얼 표시 (기본값)</span>
        </label>
        <p className="muted small">
          튜토리얼 안에서 「더 이상 안 보기」를 눌러도 여기서 다시 켤 수 있습니다.
          설정은 이 브라우저에만 저장됩니다.
        </p>
      </section>

      <section className="card card-pad grid" style={{ maxWidth: 720, marginTop: 18 }}>
        <div>
          <div className="row" style={{ gap: 8 }}>
            <h2 style={{ margin: 0 }}>생성 옵션 기본값</h2>
            <span className={`badge ${isDefault ? "" : "info"}`}>{isDefault ? "기본값" : "사용자 지정"}</span>
          </div>
          <p className="muted small" style={{ marginTop: 6 }}>
            「재료로 글 후보 만들기 / 작성」 화면의 작성 엔진·모델·이미지 옵션 초기값입니다.
            자주 쓰는 조합을 저장해두면 매번 다시 고르지 않아도 됩니다. 변경 즉시 이 브라우저에 저장됩니다.
          </p>
        </div>

        <div className="grid grid-2">
          <label>
            <span className="label">작성 엔진</span>
            <select className="select" value={gen.provider} onChange={(e) => patch({ provider: e.target.value as Provider })}>
              {providers.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label>
            <span className="label">모델 (비우면 엔진 기본)</span>
            <input className="input" value={gen.model} onChange={(e) => patch({ model: e.target.value })} placeholder="비우면 기본 codex" />
          </label>
          <label>
            <span className="label">제한시간(초)</span>
            <input className="input" type="number" value={gen.timeoutSec} onChange={(e) => patch({ timeoutSec: Number(e.target.value) })} />
          </label>
          <label>
            <span className="label">대량 대기시간(초)</span>
            <input className="input" type="number" value={gen.cooldownSec} onChange={(e) => patch({ cooldownSec: Number(e.target.value) })} />
          </label>
          <label>
            <span className="label">이미지 크기</span>
            <select className="select" value={gen.imageSize} onChange={(e) => patch({ imageSize: e.target.value })}>
              {IMAGE_SIZES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
        </div>

        <label className="row">
          <input type="checkbox" checked={gen.web} onChange={(e) => patch({ web: e.target.checked })} />
          <span>웹 자료 수집 후 작성</span>
        </label>
        <label className="row">
          <input type="checkbox" checked={gen.imageGen} onChange={(e) => patch({ imageGen: e.target.checked })} />
          <span>Codex 이미지 생성</span>
        </label>

        <div className="row">
          <button className="btn" disabled={isDefault} onClick={() => setGen(DEFAULT_GENERATION_DEFAULTS)}>기본값으로 초기화</button>
        </div>
        <p className="muted small">이미 열려 있는 작성 화면에는 다음에 그 화면을 다시 열 때부터 반영됩니다.</p>
      </section>

      <section className="card card-pad grid" style={{ maxWidth: 720, marginTop: 18 }}>
        <div>
          <div className="row" style={{ gap: 8 }}>
            <h2 style={{ margin: 0 }}>Google 색인 설정</h2>
            <span className={`badge ${indexingHasKey ? "success" : "warn"}`}>{indexingHasKey ? "키 설정됨" : "키 미설정"}</span>
          </div>
          <p className="muted small" style={{ marginTop: 6 }}>
            서비스계정 키와 발행 URL 템플릿입니다. <b>서버에 저장되어 모든 도메인에 공통</b>으로 적용됩니다.
            URL 템플릿의 <code>{"{domain}"}</code>·<code>{"{slug}"}</code>는 색인 시 각 글의 도메인/슬러그로 자동 치환됩니다.
          </p>
        </div>
        <label>
          <span className="label">서비스계정 JSON</span>
          <textarea
            className="textarea mono"
            value={saJson}
            onChange={(e) => setSaJson(e.target.value)}
            placeholder={indexingHasKey ? "이미 저장됨 — 교체하려면 새 JSON 붙여넣기" : "서비스계정 JSON 붙여넣기 (client_email/private_key 포함)"}
          />
        </label>
        <label>
          <span className="label">발행 URL 템플릿</span>
          <input className="input mono" value={indexUrl} onChange={(e) => setIndexUrl(e.target.value)} placeholder="https://{domain}/community/{slug}" />
        </label>
        <div className="row">
          <button className="btn primary" onClick={saveIndexing} disabled={savingIndex}>{savingIndex ? "저장 중..." : "색인 설정 저장"}</button>
        </div>
      </section>

      <div className="row" style={{ marginTop: 18 }}>
        <Link className="btn" href="/">대시보드로</Link>
      </div>
    </div>
  );
}
