export function normalizeHexColor(value: string | null | undefined, fallback = "#2563eb"): string {
  let raw = String(value || "").trim();
  if (!raw) return fallback.toLowerCase();
  if (!raw.startsWith("#")) raw = `#${raw}`;
  if (/^#[0-9a-f]{3}$/i.test(raw)) {
    const [, a, b, c] = raw.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i) ?? [];
    if (a && b && c) raw = `#${a}${a}${b}${b}${c}${c}`;
  }
  if (!/^#[0-9a-f]{6}$/i.test(raw)) return fallback.toLowerCase();
  return raw.toLowerCase();
}

export function brandAccentSoft(accent: string, mix = 0.88): string {
  const hex = normalizeHexColor(accent);
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const mixChannel = (c: number) => Math.round(c + (255 - c) * mix);
  return `#${[mixChannel(r), mixChannel(g), mixChannel(b)].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

export function brandThemeStyle(brandColor: string | null | undefined, fallbackAccent = "#2563eb"): Record<string, string> {
  const accent = normalizeHexColor(brandColor, fallbackAccent);
  const soft = brandAccentSoft(accent);
  return {
    "--accent": accent,
    "--accent-soft": soft,
    "--primary": accent,
  };
}

export function applyBrandToDesignSpec<T extends { accent: string; soft: string }>(spec: T, brandColor: string | null | undefined): T {
  if (!brandColor) return spec;
  const accent = normalizeHexColor(brandColor, spec.accent);
  return { ...spec, accent, soft: brandAccentSoft(accent) };
}
