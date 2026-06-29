export const DEFAULT_DRIVINGPLUS_API_BASE_URL = "https://api-dev.drivingplus.me:18104";

export function adminApiBaseUrl(): string {
  return String(
    process.env.SEO_API_BASE_URL ||
      `http://${process.env.ADMIN_HOST || "127.0.0.1"}:${process.env.ADMIN_PORT || 8765}`,
  ).replace(/\/$/, "");
}

export function drivingplusApiBaseUrl(): string {
  return String(process.env.DRIVINGPLUS_API_BASE_URL || DEFAULT_DRIVINGPLUS_API_BASE_URL).replace(/\/$/, "");
}

