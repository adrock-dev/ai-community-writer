import { copyFileSync } from "node:fs";
import sharp from "sharp";

// 생성 삽화 용량 줄이기. Codex 가 만든 1536x1024 PNG 는 2~6MB 라 대상 서버 업로드 한도(10MB)에
// 가깝고 블로그 로딩도 느리다. 본문 폭에 맞춰 줄이고 WebP 로 바꿔 보통 수백 KB 로 만든다.
// 미리보기·내보내기·자동 발행이 모두 이 파일을 쓰므로 저장할 때 한 번만 줄인다.

/** 본문 이미지 최대 가로(px). 두 블로그·커뮤니티 본문 폭보다 넉넉하다. */
export const IMAGE_MAX_WIDTH = 1200;
export const IMAGE_WEBP_QUALITY = 80;

/**
 * 원본을 줄여 `<destBase>.webp` 로 저장하고 그 확장자를 돌려준다.
 * 변환에 실패하면 원본을 그대로 복사하고 원본 확장자를 돌려준다(삽화 생성은 막지 않는다).
 */
export async function saveOptimizedImage(
  src: string,
  destBase: string,
  srcExt: string,
  log: (message: string) => void = (m) => console.warn(m),
): Promise<string> {
  try {
    await sharp(src)
      .resize({ width: IMAGE_MAX_WIDTH, withoutEnlargement: true })
      .webp({ quality: IMAGE_WEBP_QUALITY })
      .toFile(`${destBase}.webp`);
    return ".webp";
  } catch (error) {
    log(`[writer] 삽화 용량 줄이기 실패, 원본 저장: ${(error as Error).message}`);
    copyFileSync(src, `${destBase}${srcExt}`);
    return srcExt;
  }
}
