// 원천이 이미 주는 사실을 추려, 조사에서 다시 캐지 않게 한다.
//
// 2026-07-27 파일럿(26곳) 실측: 겹치는 영역에서는 웹 조사가 원천을 이기지 못한다.
//   수강료 조사 23% vs 원천 87% · 셔틀 노선 23% vs 56% · 운영시간 42% vs 67% · 면허과정 46% vs 88%
// 그런데도 프롬프트가 23개 필드를 전부 요구해, 학원 1곳당 1분을 이미 아는 값을 찾는 데 쓰고 있었다.
//
// 필드를 스키마에서 영구히 빼지 않는다. 학원마다 원천에 값이 **있는 것만** 뺀다.
// 그래서 원천이 새 필드를 주기 시작하면 그 순간부터 자동으로 조사 대상에서 빠진다.

import type { DrivingplusAcademy } from "./drivingplus-api.service.js";
import { formatOperatingHoursFact, formatTuitionFact } from "./drivingplus-academy-facts.js";
import { formatShuttleFact } from "./drivingplus-shuttle-facts.js";

export interface KnownFacts {
  /** 프롬프트에 [이미 확인된 사실]로 제시할 항목. */
  lines: string[];
  /** 조사 스키마에서 뺄 필드 키. */
  skipFields: Set<string>;
  /** 과정별 가격 배열을 요구하지 않는다(원천 수강료가 있을 때). */
  skipCourses: boolean;
  /** 셔틀 노선 배열을 요구하지 않는다(원천 노선표가 있을 때). */
  skipShuttleRoutes: boolean;
}

export function emptyKnownFacts(): KnownFacts {
  return { lines: [], skipFields: new Set(), skipCourses: false, skipShuttleRoutes: false };
}

/**
 * academy_base.raw_json(정규화된 원천 응답)에서 이미 확정된 사실을 뽑는다.
 *
 * 조사 모듈이 admin.db 를 보지 않아도 되게 조사 DB 안에서 해결한다 — 조사는 도메인을
 * 몰라야 하는데 `academies` 는 도메인 스코프라 참조하면 결합이 생긴다.
 */
export function knownFactsFromSource(raw: unknown): KnownFacts {
  const out = emptyKnownFacts();
  if (!raw || typeof raw !== "object") return out;
  const academy = raw as Partial<DrivingplusAcademy>;

  const tuition = formatTuitionFact(academy.educationPerformance ?? null);
  if (tuition) {
    out.lines.push(`- 수강료: ${tuition}`);
    // price_disclosed 도 함께 확정된다 — 원천이 금액을 준다는 것 자체가 공개된 가격이라는 뜻이다.
    out.skipFields.add("fee_summary").add("price_disclosed");
    out.skipCourses = true;
  }

  // 운행 지역 사전은 넘기지 않는다. 여기서는 "원천이 노선을 준다"는 사실만 알리면 되고,
  // 지역 매칭은 글 생성 쪽(db.service)이 이미 하고 있다.
  const shuttle = formatShuttleFact(academy.shuttleBuses ?? null);
  if (shuttle) {
    out.lines.push(`- 셔틀: ${shuttle}`);
    out.skipFields.add("shuttle_available").add("shuttle_summary");
    out.skipShuttleRoutes = true;
  }

  const hours = formatOperatingHoursFact(academy.operateHour ?? null);
  if (hours) {
    out.lines.push(`- 운영시간: ${hours}`);
    // 요일별 개·폐점과 휴무가 모두 들어 있어 주말·휴무일도 함께 확정된다.
    out.skipFields.add("hours").add("weekend").add("closed_days");
  }

  const licenses = (academy.licenseTypes ?? []).map((type) => String(type?.label ?? "").trim()).filter(Boolean);
  if (licenses.length) {
    out.lines.push(`- 취득 가능 면허: ${licenses.join(", ")}`);
    out.skipFields.add("licenses");
  }

  return out;
}

// 야간반은 일부러 제외하지 않는다. 운영시간이 늦게까지라고 해서 야간반을 운영한다는 뜻은
// 아니고, 원천에 야간반 필드 자체가 없다. 추론으로 채우면 없는 과정을 만들어낸다.
