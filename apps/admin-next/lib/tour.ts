"use client";

import { useCallback, useEffect, useState } from "react";

export type TourMode = "basic" | "review";
export type TourFocus =
  | "workflow"
  | "source"
  | "slot-create"
  | "test-write"
  | "jobs"
  | "posts"
  | "plan"
  | "template-type"
  | "template-design"
  | "academy-types"
  | "slot-filter";

const STORAGE_KEY = "adrock.tutorial.enabled";
export const TOUR_PREFS_EVENT = "adrock:tutorial-prefs";

export function isTourEnabled(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(STORAGE_KEY) !== "false";
}

export function setTourEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, enabled ? "true" : "false");
  window.dispatchEvent(new CustomEvent(TOUR_PREFS_EVENT));
}

export function useTourEnabled(): [boolean, (enabled: boolean) => void] {
  const [enabled, setEnabled] = useState(true);
  useEffect(() => {
    setEnabled(isTourEnabled());
    const onChange = () => setEnabled(isTourEnabled());
    window.addEventListener(TOUR_PREFS_EVENT, onChange);
    return () => window.removeEventListener(TOUR_PREFS_EVENT, onChange);
  }, []);
  const update = useCallback((next: boolean) => setTourEnabled(next), []);
  return [enabled, update];
}

export function isTourMode(value: string | null): value is TourMode {
  return value === "basic" || value === "review";
}

export function isTourFocus(value: string | null): value is TourFocus {
  return value === "workflow"
    || value === "source"
    || value === "slot-create"
    || value === "test-write"
    || value === "jobs"
    || value === "posts"
    || value === "plan"
    || value === "template-type"
    || value === "template-design"
    || value === "academy-types"
    || value === "slot-filter";
}

export function tabForTourFocus(focus?: TourFocus): string {
  const map: Partial<Record<TourFocus, string>> = {
    workflow: "overview",
    source: "academies",
    "slot-create": "slots",
    "test-write": "slots",
    jobs: "jobs",
    posts: "posts",
    plan: "plan",
    "template-type": "templates",
    "template-design": "templates",
    "academy-types": "academies",
    "slot-filter": "slots",
  };
  return focus ? (map[focus] ?? "overview") : "overview";
}

/** 대시보드·도메인 관리 공통 — 도메인 개요에서 튜토리얼을 시작하는 링크 */
export function domainTourHref(domain: string, flow: TourMode, focus?: TourFocus): string {
  const base = `/t/${encodeURIComponent(domain)}`;
  const params = new URLSearchParams({ flow });
  if (focus) params.set("focus", focus);
  return `${base}?${params.toString()}`;
}
