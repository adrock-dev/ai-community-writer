import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { resolvePath } from "./paths.ts";

// 모든 항목에 기본값이 있어 config.json 없이도 기동된다. 바꿀 값만 config.json에 적는다.

const providerSchema = z.object({
  /** PATH에서 찾을 실행 파일명 또는 절대 경로. Windows의 `.cmd` 확장자는 러너가 처리한다. */
  command: z.string().min(1),
  /** 비우면 CLI 기본 모델을 쓴다. */
  model: z.string().default(""),
});

/** 원천 데이터 API 주소. 각 프로젝트(api.drive, api.drivingzone)의 배포 환경 기준. */
export const SOURCE_PROFILES = {
  prod: {
    drivingplusApi: "https://api.drivingplus.me",
    drivingzoneApi: "https://api.drivingzone.co.kr",
  },
  dev: {
    drivingplusApi: "https://api-dev.drivingplus.me:18104",
    drivingzoneApi: "https://adrock.duckdns.org:18099",
  },
} as const;
export type SourceProfile = keyof typeof SOURCE_PROFILES;

export const LLM_PROVIDERS = ["codex", "claude"] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

/** 생성 삽화 화풍. mixed 는 글마다 사진풍·일러스트 중 하나를 무작위로 고른다(한 글 안에서는 같은 화풍). */
export const IMAGE_STYLES = ["photo", "illustration", "mixed"] as const;
export type ImageStyleSetting = (typeof IMAGE_STYLES)[number];

const configSchema = z.object({
  server: z
    .object({
      host: z.string().default("127.0.0.1"),
      port: z.number().int().min(1).max(65535).default(8787),
    })
    .prefault({}),
  dbPath: z.string().default("data/writer.db"),
  llm: z
    .object({
      /** 앞에서부터 시도하고, 사용량 한도에 걸리면 다음 프로바이더로 넘어간다. */
      order: z.array(z.enum(LLM_PROVIDERS)).min(1).default(["codex", "claude"]),
      timeoutSec: z.number().int().positive().default(600),
      /** 5시간·주간 사용률이 이 값(%) 이상이면 리셋 시각까지 해당 프로바이더를 쉰다.
       *  같은 계정을 사람도 쓰므로 여유를 남긴다. */
      pauseAtUsagePercent: z.number().min(1).max(100).default(80),
      /** 한도에 걸렸는데 해제 시각을 알 수 없을 때 쉬는 시간(분). */
      limitCooldownMin: z.number().int().positive().default(60),
      codex: providerSchema.prefault({ command: "codex" }),
      claude: providerSchema.prefault({ command: "claude" }),
    })
    .prefault({}),
  pacing: z
    .object({
      /** 글 생성 사이 대기 시간. 이 범위에서 무작위로 고른다. */
      minIntervalSec: z.number().int().nonnegative().default(300),
      maxIntervalSec: z.number().int().nonnegative().default(900),
      /** 하루 최대 생성 편수. */
      dailyLimit: z.number().int().positive().default(10),
    })
    .prefault({})
    .refine((p) => p.maxIntervalSec >= p.minIntervalSec, {
      message: "pacing.maxIntervalSec는 minIntervalSec 이상이어야 합니다",
    }),
  writer: z
    .object({
      /**
       * 자사 사이트 링크(채널 linkTargets)를 넣을 수 있는 글의 비율(0~1). 모든 글에 같은 링크가
       * 들어가지 않게 글마다 무작위로 정한다. 0이면 넣지 않는다.
       */
      linkChance: z.number().min(0).max(1).default(0.3),
    })
    .prefault({}),
  images: z
    .object({
      /** 생성 삽화 화풍. 실제 사진(학원·지점)에는 영향이 없다. */
      style: z.enum(IMAGE_STYLES).default("photo"),
    })
    .prefault({}),
  worker: z
    .object({
      /** 작업 큐 확인 주기(초). */
      pollSec: z.number().int().positive().default(5),
    })
    .prefault({}),
  keywords: z
    .object({
      /** 30일 검색 수(PC+모바일)가 이보다 적은 키워드는 버린다. */
      minMonthlyVolume: z.number().int().nonnegative().default(30),
      /** 섹션마다 저장할 주제 후보 최대 수 (검색 수 순). */
      maxTopicsPerSection: z.number().int().positive().default(50),
      /** 키워드 묶기 기준 (글자 2-gram 유사도, 0~1). 낮출수록 크게 묶인다. */
      clusterThreshold: z.number().min(0).max(1).default(0.5),
      /** 데이터랩 추세를 조회할 상위 묶음 수. */
      trendTopN: z.number().int().nonnegative().default(30),
    })
    .prefault({}),
  naver: z
    .object({
      /** 검색광고 API 인증 파일(KEY=VALUE 형식). 저장소 밖에 둔다. */
      searchadEnvFile: z.string().default("~/.naver-searchad.env"),
      datalabClientId: z.string().default(""),
      datalabClientSecret: z.string().default(""),
    })
    .prefault({}),
  sources: z
    .object({
      /** 글 근거는 실제 공개 데이터여야 하므로 기본은 운영(prod). 테스트할 때만 dev. */
      profile: z.enum(["prod", "dev"]).default("prod"),
      /** 비우면 profile의 주소를 쓴다. 다른 서버를 가리킬 때만 적는다. */
      drivingplusApi: z.string().default(""),
      drivingzoneApi: z.string().default(""),
      /** 원천 응답 캐시 유지 시간. 학원 정보는 자주 바뀌지 않는다. */
      cacheTtlHours: z.number().positive().default(24),
      timeoutSec: z.number().int().positive().default(60),
    })
    .prefault({})
    .transform((s) => {
      const preset = SOURCE_PROFILES[s.profile];
      return {
        profile: s.profile,
        cacheTtlHours: s.cacheTtlHours,
        timeoutSec: s.timeoutSec,
        drivingplusApi: (s.drivingplusApi || preset.drivingplusApi).replace(/\/+$/, ""),
        drivingzoneApi: (s.drivingzoneApi || preset.drivingzoneApi).replace(/\/+$/, ""),
      };
    }),
  publish: z
    .object({
      /** 발행 API 키 파일(KEY=VALUE). DRIVINGPLUS_WRITER_API_KEY / DRIVINGZONE_WRITER_API_KEY. 저장소 밖에 둔다. */
      credentialsFile: z.string().default("~/.ai-community-writer.env"),
      /** 발행할 API 서버. 비우면 sources 의 주소(profile)를 쓴다. */
      drivingplusApi: z.string().default(""),
      drivingzoneApi: z.string().default(""),
      /** 게시 주소를 만들 공개 사이트. */
      drivingplusSiteUrl: z.string().default("https://app.drivingplus.me"),
      drivingzoneSiteUrl: z.string().default("https://www.drivingzone.co.kr"),
      dztrainingSiteUrl: z.string().default("https://www.dztraining.co.kr"),
      /**
       * 발행 뒤 IndexNow(공용 + 네이버)로 글 주소를 알린다. 키는 사이트 루트의 `{key}.txt` 와 같아야 한다.
       * 운전면허PLUS 키는 web.drivingplus `public/` 에 이미 공개돼 있다. 드라이빙존 사이트는 키 파일이 없어 비워 둔다.
       */
      indexNowKeys: z
        .object({
          drivingplus: z.string().default("b3174e2477a5465399e5c71adf308a6f"),
          drivingzone: z.string().default(""),
          dztraining: z.string().default(""),
        })
        .prefault({}),
      timeoutSec: z.number().int().positive().default(60),
    })
    .prefault({}),
});

export type AppConfig = z.infer<typeof configSchema>;

export const DEFAULT_CONFIG_PATH = "config.json";

/** JSON 객체를 검증해 기본값이 채워진 설정으로 만든다. */
export function parseConfig(raw: unknown): AppConfig {
  const result = configSchema.safeParse(raw ?? {});
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`config.json 설정 오류:\n${detail}`);
  }
  return result.data;
}

/** config.json을 읽는다. 파일이 없으면 기본값만으로 설정을 만든다. */
export function loadConfig(
  path: string = process.env.WRITER_CONFIG || DEFAULT_CONFIG_PATH,
): AppConfig {
  const file = resolvePath(path);
  if (!existsSync(file)) return parseConfig({});
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new Error(
      `config.json을 JSON으로 읽지 못했습니다 (${file}): ${(error as Error).message}`,
    );
  }
  return parseConfig(raw);
}
