import type { DomainConfig } from "./types";

export function pickDefaultDomain(domains: DomainConfig[]) {
  return [...domains].sort((a, b) => domainPriority(b) - domainPriority(a))[0];
}

function domainPriority(domain: DomainConfig) {
  if ((domain.planned_count ?? 0) > 0) return 100_000 + (domain.planned_count ?? 0);
  if ((domain.published_count ?? 0) > 0) return 50_000 + (domain.published_count ?? 0);
  if ((domain.slot_count ?? 0) === 0) return 10_000;
  return domain.slot_count ?? 0;
}
