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

/** 검수자가 올린 파일의 최대 크기. 휴대폰 원본 사진도 들어가게 넉넉히 둔다. */
export const UPLOAD_MAX_BYTES = 30 * 1024 * 1024;

/**
 * 검수자가 올린 이미지를 같은 규칙(가로 1200px·WebP)으로 줄여 `<destBase>.webp` 로 저장한다.
 * 삽화 생성과 달리 이미지가 아니면 원본을 남기지 않고 오류를 낸다.
 */
export async function saveUploadedImage(data: Uint8Array, destBase: string): Promise<string> {
  if (data.byteLength > UPLOAD_MAX_BYTES) {
    throw new Error(`파일이 너무 큽니다(최대 ${UPLOAD_MAX_BYTES / 1024 / 1024}MB)`);
  }
  try {
    await sharp(data)
      .rotate() // 휴대폰 사진의 EXIF 방향을 반영한다
      .resize({ width: IMAGE_MAX_WIDTH, withoutEnlargement: true })
      .webp({ quality: IMAGE_WEBP_QUALITY })
      .toFile(`${destBase}.webp`);
    return ".webp";
  } catch {
    throw new Error("이미지 파일을 읽지 못했습니다(PNG·JPG·WebP 등 이미지 파일을 올리세요)");
  }
}
