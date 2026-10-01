import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { extname, join } from "node:path";
import type { AppConfig, ImageStyleSetting } from "../config.ts";
import { resolveCommand } from "../llm/command.ts";
import { looksRateLimited } from "../llm/limits.ts";
import { runProcess } from "../llm/process.ts";
import { childEnv, LLM_WORK_DIR, parseCodexStream } from "../llm/providers.ts";
import { PROJECT_ROOT } from "../paths.ts";

// 본문 삽화 생성. Codex CLI의 내장 이미지 생성 도구를 쓴다(구독 로그인 그대로, 키 불필요).
// 실제 사진이 부족한 글(시험·시험장 안내 등)에만 쓰고, 실제 학원·지점처럼 보이지 않게 만든다.

export const IMAGES_DIR = join(PROJECT_ROOT, "data", "images");
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

/** 실제로 그리는 화풍. 설정의 mixed 는 글마다 이 중 하나로 정한다(pickImageStyle). */
export type ImageStyle = Exclude<ImageStyleSetting, "mixed">;

export interface ImageGenerator {
  /** 장면 설명으로 이미지 1장을 만들어 IMAGES_DIR에 저장하고 파일 이름을 돌려준다. */
  generate(scene: string, fileBase: string, style: ImageStyle): Promise<string>;
}

/** 화풍 지시. 일러스트도 한국 환경(우측 통행·도로 표시)을 따르게 한다. */
export const STYLE_RULES: Record<ImageStyle, string> = {
  photo: "한국의 실제 환경처럼 자연스러운 사진풍.",
  illustration:
    "한국의 도로·생활 환경을 배경으로 한 깔끔한 일러스트(부드러운 색감의 플랫 또는 반실사 디지털 일러스트). 사진처럼 보이게 하지 않는다.",
};

/** 화풍과 상관없이 모든 생성 이미지에 붙는 공통 조건 */
export const IMAGE_RULES =
  "글자·숫자·로고·간판·번호판을 넣지 않는다. 사람은 뒷모습이나 손만 보이고 얼굴은 보이지 않게 한다. 특정 업체·브랜드로 보이지 않게 한다.";

/** 설정 화풍에서 이 글에 쓸 화풍을 정한다. mixed 는 글마다 무작위로 하나를 고른다. */
export function pickImageStyle(setting: ImageStyleSetting, random: () => number): ImageStyle {
  if (setting !== "mixed") return setting;
  return random() < 0.5 ? "photo" : "illustration";
}

export function imagePrompt(scene: string, fileName: string, style: ImageStyle): string {
  return [
    `이미지 생성 도구로 아래 장면의 이미지를 1장 만들어 현재 폴더에 ${fileName} 파일로 저장하세요.`,
    "크기는 가로형 1536x1024입니다. 저장한 뒤에는 파일 이름만 답하세요.",
    "",
    `장면: ${scene}`,
    `화풍: ${STYLE_RULES[style]}`,
    `조건: ${IMAGE_RULES}`,
  ].join("\n");
}

export function codexImageGenerator(llm: AppConfig["llm"]): ImageGenerator {
  return {
    async generate(scene, fileBase, style) {
      const work = join(
        LLM_WORK_DIR,
        `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      );
      mkdirSync(work, { recursive: true });
      try {
        const args = [
          "exec",
          "--json",
          "--skip-git-repo-check",
          "--sandbox",
          "workspace-write",
          "-c",
          'approval_policy="never"',
          "--color",
          "never",
          "-",
        ];
        const spec = resolveCommand(llm.codex.command, args);
        if (!spec)
          throw new Error(`${llm.codex.command} 실행 파일을 찾지 못해 이미지를 만들 수 없습니다`);
        const result = await runProcess(spec, imagePrompt(scene, "image.png", style), {
          timeoutMs: 600_000,
          cwd: work,
          env: childEnv("codex"),
        });
        const parsed = parseCodexStream(result.stdout);
        const file = readdirSync(work).find((f) => IMAGE_EXTS.has(extname(f).toLowerCase()));
        if (!file) {
          const detail = `${parsed.errorText} ${result.stderr}`.trim().slice(-300);
          const why = looksRateLimited(detail)
            ? "사용량 한도"
            : result.timedOut
              ? "시간 초과"
              : "실패";
          throw new Error(`이미지 생성 ${why}: ${detail || `종료 코드 ${result.code}`}`);
        }
        mkdirSync(IMAGES_DIR, { recursive: true });
        const name = `${fileBase}${extname(file).toLowerCase()}`;
        // 임시 폴더와 저장소가 다른 드라이브일 수 있어(Windows) 이동 대신 복사한다
        copyFileSync(join(work, file), join(IMAGES_DIR, name));
        return name;
      } finally {
        if (existsSync(work)) rmSync(work, { recursive: true, force: true });
      }
    },
  };
}
