import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import type { SpawnSpec } from "./command.ts";

export interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** 실행 자체가 실패한 경우 (파일 없음 등). */
  spawnError?: string;
}

const active = new Set<ChildProcess>();

/**
 * 자식 프로세스를 트리째 종료한다. CLI가 내부적으로 다른 프로세스를 띄우므로
 * Windows는 taskkill /T, 그 외는 프로세스 그룹 단위로 보낸다.
 */
export function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  setTimeout(() => {
    if (child.exitCode !== null || child.pid === undefined) return;
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      /* 이미 종료 */
    }
  }, 5000).unref();
}

/** 앱 종료 시 실행 중인 CLI를 모두 정리한다. */
export function killAllChildren(): void {
  for (const child of active) killTree(child);
}

export function runProcess(
  spec: SpawnSpec,
  input: string,
  opts: { timeoutMs: number; cwd: string; env: NodeJS.ProcessEnv },
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(spec.file, spec.args, {
        cwd: opts.cwd,
        env: opts.env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        windowsVerbatimArguments: spec.windowsVerbatimArguments,
        // POSIX에서 그룹 단위 종료를 위해 새 프로세스 그룹으로 띄운다.
        detached: process.platform !== "win32",
      });
    } catch (error) {
      resolve({ code: null, stdout: "", stderr: "", timedOut: false, spawnError: String(error) });
      return;
    }
    active.add(child);
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const finish = (result: ProcessResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      active.delete(child);
      resolve(result);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, opts.timeoutMs);

    child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) =>
      finish({ code: null, stdout, stderr, timedOut, spawnError: error.message }),
    );
    child.on("close", (code) => finish({ code, stdout, stderr, timedOut }));
    child.stdin?.on("error", () => {
      /* 자식이 먼저 종료되면 EPIPE — close 이벤트에서 처리 */
    });
    child.stdin?.end(input, "utf8");
  });
}
