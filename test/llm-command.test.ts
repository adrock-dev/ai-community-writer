import { describe, expect, it } from "vitest";
import {
  parseNpmCmdShim,
  quoteCmdArg,
  type ResolveEnv,
  resolveCommand,
} from "../src/llm/command.ts";

const NPM_SHIM = `@ECHO off
GOTO start
:find_dp0
SET dp0=%~dp0
EXIT /b
:start
SETLOCAL
CALL :find_dp0
IF EXIST "%dp0%\\node.exe" (
  SET "_prog=%dp0%\\node.exe"
) ELSE (
  SET "_prog=node"
  SET PATHEXT=%PATHEXT:;.JS;=;%
)
endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*
`;

function winEnv(files: Record<string, string>): ResolveEnv {
  return {
    platform: "win32",
    pathEnv:
      "C:\\Windows\\system32;C:\\Users\\me\\AppData\\Roaming\\npm;C:\\Users\\me\\.local\\bin",
    pathExt: ".COM;.EXE;.BAT;.CMD",
    comSpec: "C:\\Windows\\system32\\cmd.exe",
    nodePath: "C:\\Program Files\\nodejs\\node.exe",
    exists: (f) => f in files,
    read: (f) => files[f] ?? "",
  };
}

describe("parseNpmCmdShim", () => {
  it("npm 전역 설치 .cmd에서 JS 진입점을 찾는다", () => {
    expect(parseNpmCmdShim(NPM_SHIM)).toBe("node_modules\\@openai\\codex\\bin\\codex.js");
    expect(parseNpmCmdShim("@echo off\r\nfoo.exe %*")).toBeUndefined();
  });
});

describe("resolveCommand", () => {
  it("POSIX는 그대로 실행한다", () => {
    expect(resolveCommand("codex", ["exec"], { ...winEnv({}), platform: "darwin" })).toEqual({
      file: "codex",
      args: ["exec"],
    });
  });

  it("Windows npm shim은 node로 JS를 직접 실행한다 (셸·인용 문제 회피)", () => {
    const npm = "C:\\Users\\me\\AppData\\Roaming\\npm";
    const env = winEnv({
      [`${npm}\\codex.cmd`]: NPM_SHIM,
      [`${npm}\\node_modules\\@openai\\codex\\bin\\codex.js`]: "",
    });
    expect(resolveCommand("codex", ["exec", "-c", 'approval_policy="never"'], env)).toEqual({
      file: "C:\\Program Files\\nodejs\\node.exe",
      args: [
        `${npm}\\node_modules\\@openai\\codex\\bin\\codex.js`,
        "exec",
        "-c",
        'approval_policy="never"',
      ],
    });
  });

  it("Windows .exe가 있으면 .cmd보다 먼저 쓴다 (PATHEXT 순서)", () => {
    const env = winEnv({ "C:\\Users\\me\\.local\\bin\\claude.exe": "" });
    expect(resolveCommand("claude", ["--print"], env)).toEqual({
      file: "C:\\Users\\me\\.local\\bin\\claude.exe",
      args: ["--print"],
    });
  });

  it("해석할 수 없는 .cmd는 cmd.exe로 인용해 실행한다", () => {
    const env = winEnv({ "C:\\tools\\codex.cmd": "@echo off\r\nC:\\bin\\codex.exe %*" });
    const spec = resolveCommand("C:\\tools\\codex.cmd", ["--tools", "", "a b"], env);
    expect(spec).toEqual({
      file: "C:\\Windows\\system32\\cmd.exe",
      args: ["/d", "/s", "/c", '"C:\\tools\\codex.cmd --tools "" "a b""'],
      windowsVerbatimArguments: true,
    });
  });

  it("찾지 못하면 undefined", () => {
    expect(resolveCommand("codex", [], winEnv({}))).toBeUndefined();
  });
});

describe("quoteCmdArg", () => {
  it("공백·따옴표·% 를 인용한다", () => {
    expect(quoteCmdArg("--json")).toBe("--json");
    expect(quoteCmdArg('approval_policy="never"')).toBe('"approval_policy=""never"""');
    expect(quoteCmdArg("100%")).toBe('"100%%"');
  });
});
