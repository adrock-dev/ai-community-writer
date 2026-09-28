// next dev/start 크로스 플랫폼 런처.
//
// dev.sh(루트)나 셸에서 NEXT_HOST·NEXT_PORT를 넘기면 그 값을, 없으면 기본값
// localhost:3001 을 쓴다. bash식 ${VAR:-기본값} 치환은 Windows cmd 에서 동작하지
// 않으므로, package.json 스크립트에 그 문법을 두지 않고 여기서 직접 기본값을 채운다.
// dev.sh 가 포트 충돌 시 증가시킨 NEXT_PORT 도 그대로 존중한다.
import { spawn } from "node:child_process";

const sub = process.argv[2] ?? "dev";
const host = process.env.NEXT_HOST || "localhost";
const port = process.env.NEXT_PORT || "3001";

const child = spawn("next", [sub, "--hostname", host, "--port", port], {
  stdio: "inherit",
  shell: true,
});
child.on("exit", (code) => process.exit(code ?? 0));
