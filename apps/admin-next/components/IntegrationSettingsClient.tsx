"use client";

import { api, getOptions } from "@/lib/api";
import { useEffect, useState } from "react";

export default function IntegrationSettingsClient() {
  const [indexingHasKey, setIndexingHasKey] = useState(false);
  const [indexUrl, setIndexUrl] = useState("");
  const [saJson, setSaJson] = useState("");
  const [savingIndex, setSavingIndex] = useState(false);

  async function loadOptions() {
    const opts = await getOptions();
    setIndexingHasKey(opts.indexing.has_key);
    setIndexUrl((prev) => prev || opts.indexing.url_template);
  }

  useEffect(() => {
    // 백엔드 미연결 시 빈 색인값을 유지한다.
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

  return (
    <div>
      <div className="page-head">
        <div>
          <p className="eyebrow">관리자</p>
          <h1>연동 설정</h1>
          <p className="muted">Google 색인처럼 서버에 저장되고 모든 도메인에 공통 적용되는 외부 연동 설정입니다.</p>
        </div>
      </div>

      <section className="card card-pad grid" style={{ maxWidth: 720 }}>
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
    </div>
  );
}
