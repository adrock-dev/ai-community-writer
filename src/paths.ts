import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

/** 저장소 루트. 설정·DB 상대 경로의 기준이다. */
export const PROJECT_ROOT = resolve(import.meta.dirname, "..");

/**
 * 설정에 적힌 경로를 실제 경로로 푼다.
 * `~`로 시작하면 홈 디렉터리(Windows는 %USERPROFILE%), 상대 경로면 저장소 루트 기준이다.
 */
export function resolvePath(p: string, base: string = PROJECT_ROOT): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) return join(homedir(), p.slice(2));
  return isAbsolute(p) ? p : resolve(base, p);
}
