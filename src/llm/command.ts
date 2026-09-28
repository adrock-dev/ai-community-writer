import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// CLI 실행 파일 찾기. Windows에서 npm 전역 설치 CLI는 `codex.cmd` 같은 배치 파일이라
// Node의 spawn으로 직접 실행할 수 없다(shell 없이 .cmd 실행 금지). 그래서
//   1) .exe/.com이면 그대로 실행
//   2) npm이 만든 .cmd면 안에 적힌 JS 진입점을 찾아 `node <js>`로 실행 (셸·인용 문제 없음)
//   3) 그 밖의 .cmd/.bat는 cmd.exe로 실행 (인자는 직접 인용)
// 순서로 처리한다.

export interface SpawnSpec {
  file: string;
  args: string[];
  /** cmd.exe 경유 시 Node가 인자를 다시 인용하지 않도록 한다. */
  windowsVerbatimArguments?: boolean;
}

export interface ResolveEnv {
  platform: NodeJS.Platform;
  pathEnv: string;
  pathExt: string;
  comSpec: string;
  nodePath: string;
  exists(file: string): boolean;
  read(file: string): string;
}

export function defaultResolveEnv(): ResolveEnv {
  return {
    platform: process.platform,
    pathEnv: process.env.PATH ?? process.env.Path ?? "",
    pathExt: process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD",
    comSpec: process.env.ComSpec ?? "cmd.exe",
    nodePath: process.execPath,
    exists: (f) => existsSync(f),
    read: (f) => readFileSync(f, "utf8"),
  };
}

/** npm cmd-shim 안의 `"%dp0%\node_modules\...\cli.js"` 진입점을 찾는다. */
export function parseNpmCmdShim(content: string): string | undefined {
  return /"%~?dp0%?\\([^"]+?\.(?:js|cjs|mjs))"/i.exec(content)?.[1];
}

/** cmd.exe 명령줄용 인자 인용. */
export function quoteCmdArg(arg: string): string {
  if (/^[\w\-.:=/\\@]+$/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '""').replace(/%/g, "%%")}"`;
}

/** 실행할 파일을 찾아 spawn 인자를 만든다. 찾지 못하면 undefined. */
export function resolveCommand(
  command: string,
  args: string[],
  env: ResolveEnv = defaultResolveEnv(),
): SpawnSpec | undefined {
  if (env.platform !== "win32") return { file: command, args };

  const p = path.win32;
  const exts = env.pathExt
    .split(";")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const hasExt = exts.includes(p.extname(command).toLowerCase());
  const names = hasExt ? [command] : exts.map((e) => command + e);
  const dirs = p.isAbsolute(command) || command.includes("\\") ? [""] : env.pathEnv.split(";");

  for (const dir of dirs) {
    for (const name of names) {
      const full = dir ? p.join(dir.replace(/^"|"$/g, ""), name) : name;
      if (!env.exists(full)) continue;
      const ext = p.extname(full).toLowerCase();
      if (ext === ".exe" || ext === ".com") return { file: full, args };
      if (ext === ".cmd" || ext === ".bat") {
        const js = parseNpmCmdShim(env.read(full));
        if (js) {
          const script = p.join(p.dirname(full), js);
          if (env.exists(script)) return { file: env.nodePath, args: [script, ...args] };
        }
        const line = [full, ...args].map(quoteCmdArg).join(" ");
        return {
          file: env.comSpec,
          args: ["/d", "/s", "/c", `"${line}"`],
          windowsVerbatimArguments: true,
        };
      }
    }
  }
  return undefined;
}
