"use client";

import { getOptions } from "@/lib/api";
import { DEFAULT_GENERATION_DEFAULTS, useGenerationDefaults } from "@/lib/generation-defaults";
import { useTourEnabled } from "@/lib/tour";
import type { Provider } from "@/lib/types";
import { useEffect, useState } from "react";

const IMAGE_SIZES: Array<{ value: string; label: string }> = [
  { value: "1024x1024", label: "1024 정방형" },
  { value: "1536x1024", label: "1536 가로형" },
  { value: "1024x1536", label: "1024 세로형" },
];

export default function SettingsClient() {
  const [savedTourEnabled, setSavedTourEnabled] = useTourEnabled();
  const [savedGen, setSavedGen] = useGenerationDefaults();
  const [tourDraft, setTourDraft] = useState(savedTourEnabled);
  const [genDraft, setGenDraft] = useState(savedGen);
  const [providers, setProviders] = useState<Provider[]>(["codex", "claude"]);
  const [localNotice, setLocalNotice] = useState("");

  async function loadOptions() {
    const opts = await getOptions();
    if (opts.providers?.length) setProviders(opts.providers);
  }

  useEffect(() => {
    // 백엔드 미연결 시 provider 내장 목록/빈 색인값을 유지한다.
    loadOptions().catch(() => {});
  }, []);

  useEffect(() => {
    setTourDraft(savedTourEnabled);
  }, [savedTourEnabled]);

  useEffect(() => {
    setGenDraft(savedGen);
  }, [savedGen]);

  function saveLocalSettings() {
    setSavedTourEnabled(tourDraft);
    setSavedGen(genDraft);
    setLocalNotice("전역 설정 저장됨");
  }

  const patch = (fields: Partial<typeof genDraft>) => {
    setGenDraft((current) => ({ ...current, ...fields }));
    setLocalNotice("");
  };
  const localDirty = tourDraft !== savedTourEnabled || JSON.stringify(genDraft) !== JSON.stringify(savedGen);
  const isDefault = JSON.stringify(genDraft) === JSON.stringify(DEFAULT_GENERATION_DEFAULTS);

  return (
    <div>
      <div className="page-head">
        <div>
          <p className="eyebrow">관리자</p>
          <h1>작업환경</h1>
          <p className="muted">튜토리얼·생성 기본값처럼 이 브라우저의 작업 편의에만 영향을 주는 설정입니다.</p>
        </div>
      </div>

      <section className="card card-pad grid" style={{ maxWidth: 720 }}>
        <div>
          <div className="row" style={{ gap: 8 }}>
            <h2 style={{ margin: 0 }}>운영 튜토리얼</h2>
            <span className={`badge ${tourDraft ? "success" : ""}`}>{tourDraft ? "켜짐" : "꺼짐"}</span>
          </div>
          <p className="muted small" style={{ marginTop: 6 }}>
            「기본/고급/검수 흐름 시작」이나 「기본 N 시작」을 누르면 단계별 가이드가 표시됩니다.
            × 또는 Esc로 이번 안내만 닫을 수 있고, 「더 이상 안 보기」는 이후 자동 제안을 끕니다.
          </p>
        </div>
        <label className="row">
          <input
            type="checkbox"
            checked={tourDraft}
            onChange={(e) => {
              setTourDraft(e.target.checked);
              setLocalNotice("");
            }}
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
            「글 후보 만들기 / 글 작성」 화면의 작성 엔진·모델·이미지 옵션 초기값입니다.
            자주 쓰는 조합을 저장해두면 매번 다시 고르지 않아도 됩니다.
          </p>
        </div>

        <div className="grid grid-2">
          <label>
            <span className="label">작성 엔진</span>
            <select className="select" value={genDraft.provider} onChange={(e) => patch({ provider: e.target.value as Provider })}>
              {providers.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label>
            <span className="label">모델 (비우면 엔진 기본)</span>
            <input className="input" value={genDraft.model} onChange={(e) => patch({ model: e.target.value })} placeholder="비우면 기본 codex" />
          </label>
          <label>
            <span className="label">제한시간(초)</span>
            <input className="input" type="number" value={genDraft.timeoutSec} onChange={(e) => patch({ timeoutSec: Number(e.target.value) })} />
          </label>
          <label>
            <span className="label">대량 대기시간(초)</span>
            <input className="input" type="number" value={genDraft.cooldownSec} onChange={(e) => patch({ cooldownSec: Number(e.target.value) })} />
          </label>
          <label>
            <span className="label">이미지 크기</span>
            <select className="select" value={genDraft.imageSize} onChange={(e) => patch({ imageSize: e.target.value })}>
              {IMAGE_SIZES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
        </div>

        <label className="row">
          <input type="checkbox" checked={genDraft.web} onChange={(e) => patch({ web: e.target.checked })} />
          <span>웹 자료 수집 후 작성</span>
        </label>
        <label className="row">
          <input type="checkbox" checked={genDraft.imageGen} onChange={(e) => patch({ imageGen: e.target.checked })} />
          <span>Codex 이미지 생성</span>
        </label>

        <div className="row">
          <button className="btn" disabled={isDefault} onClick={() => {
            setGenDraft(DEFAULT_GENERATION_DEFAULTS);
            setLocalNotice("");
          }}>기본값으로 초기화</button>
        </div>
        <p className="muted small">저장 후 이미 열려 있는 작성 화면에는 다음에 그 화면을 다시 열 때부터 반영됩니다.</p>
      </section>

      <section className="card card-pad grid" style={{ maxWidth: 720, marginTop: 18 }}>
        <div>
          <h2 style={{ margin: 0 }}>변경사항 저장</h2>
          <p className="muted small" style={{ marginTop: 6 }}>
            튜토리얼·생성 옵션 기본값 변경사항을 이 브라우저에 저장합니다.
          </p>
        </div>
        <div className="row">
          <button className="btn primary" disabled={!localDirty} onClick={saveLocalSettings}>전역 설정 저장</button>
          {localNotice && <span className="badge success">{localNotice}</span>}
          {localDirty && <span className="badge warn">저장되지 않은 변경</span>}
        </div>
      </section>
    </div>
  );
}
