"use client";

// 글 생성(작성) 옵션의 브라우저 로컬 기본값.
// 튜토리얼 토글과 동일한 성격 — 서버/도메인 데이터가 아니라 이 브라우저의 UI 선호값이다.
// Slots writer 가 마운트될 때 이 값을 초기값으로 사용하고, 설정 페이지에서 편집한다.

import { useCallback, useEffect, useState } from "react";
import type { Provider } from "@/lib/types";

export type GenerationDefaults = {
  provider: Provider;
  model: string;
  timeoutSec: number;
  cooldownSec: number;
  web: boolean;
  imageGen: boolean;
  imageSize: string;
};

export const DEFAULT_GENERATION_DEFAULTS: GenerationDefaults = {
  provider: "codex",
  model: "",
  timeoutSec: 600,
  cooldownSec: 60,
  web: true,
  imageGen: false,
  imageSize: "1024x1024",
};

const STORAGE_KEY = "adrock.generation.defaults";
export const GENERATION_DEFAULTS_EVENT = "adrock:generation-defaults";

export function getGenerationDefaults(): GenerationDefaults {
  if (typeof window === "undefined") return DEFAULT_GENERATION_DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_GENERATION_DEFAULTS;
    const parsed = JSON.parse(raw);
    // 저장된 값이 일부만 있어도 기본값으로 메꾼다(스키마 확장 대비).
    return { ...DEFAULT_GENERATION_DEFAULTS, ...(parsed && typeof parsed === "object" ? parsed : {}) };
  } catch {
    return DEFAULT_GENERATION_DEFAULTS;
  }
}

export function setGenerationDefaults(next: GenerationDefaults): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(GENERATION_DEFAULTS_EVENT));
  } catch {
    // localStorage 접근 불가(프라이빗 모드 등)면 무시한다.
  }
}

export function useGenerationDefaults(): [GenerationDefaults, (next: GenerationDefaults) => void] {
  const [defaults, setDefaults] = useState<GenerationDefaults>(DEFAULT_GENERATION_DEFAULTS);
  useEffect(() => {
    setDefaults(getGenerationDefaults());
    const onChange = () => setDefaults(getGenerationDefaults());
    window.addEventListener(GENERATION_DEFAULTS_EVENT, onChange);
    return () => window.removeEventListener(GENERATION_DEFAULTS_EVENT, onChange);
  }, []);
  const update = useCallback((next: GenerationDefaults) => setGenerationDefaults(next), []);
  return [defaults, update];
}
