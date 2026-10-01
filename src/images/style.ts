import { CHANNELS } from "../channels.ts";
import { type AppConfig, IMAGE_STYLES, type ImageStyleSetting } from "../config.ts";
import type { Database } from "../db/database.ts";

// 생성 삽화 화풍 설정. 관리 화면(/settings/images)에서 저장한 값이 있으면 그것을, 없으면 config.json 값을 쓴다.
// 글을 생성할 때마다 읽으므로 화면에서 바꾸면 재시작 없이 다음 글부터 적용된다.

export type ImageStyleSettings = AppConfig["images"];

export const IMAGE_STYLE_LABEL: Record<ImageStyleSetting, string> = {
  photo: "사진풍",
  illustration: "일러스트",
  mixed: "섞어서 (글마다 둘 중 하나)",
};

const STATE_KEY = "image_styles";

export const isImageStyle = (v: unknown): v is ImageStyleSetting =>
  typeof v === "string" && (IMAGE_STYLES as readonly string[]).includes(v);

/** 저장 값이 깨졌거나 채널이 없어진 경우는 버리고 읽는다. */
function parseStored(raw: string): ImageStyleSettings | undefined {
  try {
    const data = JSON.parse(raw) as { style?: unknown; styleByChannel?: Record<string, unknown> };
    if (!isImageStyle(data.style)) return undefined;
    const known = new Set<string>(CHANNELS.map((c) => c.id));
    const styleByChannel: Record<string, ImageStyleSetting> = {};
    for (const [id, style] of Object.entries(data.styleByChannel ?? {})) {
      if (known.has(id) && isImageStyle(style)) styleByChannel[id] = style;
    }
    return { style: data.style, styleByChannel };
  } catch {
    return undefined;
  }
}

/** 화면에서 저장한 화풍이 있는지 */
export function hasSavedImageStyles(db: Database): boolean {
  const raw = db.getState(STATE_KEY);
  return raw !== undefined && parseStored(raw) !== undefined;
}

/** 지금 적용되는 화풍 설정 (화면 저장 값 → config.json) */
export function imageStyleSettings(db: Database, config: AppConfig): ImageStyleSettings {
  const raw = db.getState(STATE_KEY);
  return (raw !== undefined && parseStored(raw)) || config.images;
}

export function saveImageStyles(db: Database, settings: ImageStyleSettings): void {
  db.setState(STATE_KEY, JSON.stringify(settings));
}

/** 화면 저장 값을 지워 config.json 값으로 돌아간다. */
export function resetImageStyles(db: Database): void {
  db.run("DELETE FROM app_state WHERE key = ?", [STATE_KEY]);
}

/** 채널에 적용할 화풍. 채널별 값이 없으면 공통 값을 쓴다. */
export function imageStyleFor(settings: ImageStyleSettings, channelId: string): ImageStyleSetting {
  return settings.styleByChannel[channelId] ?? settings.style;
}
