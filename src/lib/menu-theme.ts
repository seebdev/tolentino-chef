import type { CSSProperties } from "react";
import { DEFAULT_APPEARANCE, type Appearance } from "./types";

export const MENU_TOKEN_DEFAULTS = {
  background: "#fcfcf8",
  card: "#ffffff",
  text: "#253026",
  muted: "#596a4c",
  cover_overlay: "#132417",
  cover_overlay_opacity: 0.7,
  columns_mobile: 1 as 1 | 2,
  columns_desktop: 2 as 1 | 2,
};
export function menuAppearance(value?: Partial<Appearance> | null) {
  return {
    ...DEFAULT_APPEARANCE,
    ...MENU_TOKEN_DEFAULTS,
    ...Object.fromEntries(
      Object.entries(value || {}).filter(
        ([, v]) => v !== null && v !== undefined,
      ),
    ),
  } as Appearance & typeof MENU_TOKEN_DEFAULTS;
}
export function themeStyle(value?: Partial<Appearance> | null): CSSProperties {
  const a = menuAppearance(value);
  const alpha = (n: number) =>
    Math.round(Math.max(0, Math.min(1, n)) * 255)
      .toString(16)
      .padStart(2, "0");
  return {
    "--menu-primary": a.primary,
    "--menu-secondary": a.secondary,
    "--menu-background": a.background,
    "--menu-card": a.card,
    "--menu-text": a.text,
    "--menu-muted": a.muted,
    "--menu-cover-shade": `linear-gradient(180deg,${a.cover_overlay}${alpha(a.cover_overlay_opacity * 0.48)},${a.cover_overlay}${alpha(a.cover_overlay_opacity)})`,
    "--menu-columns-mobile": a.columns_mobile,
    "--menu-columns-desktop": a.columns_desktop,
  } as CSSProperties;
}
export function contrastRatio(first: string, second: string) {
  const luminance = (hex: string) => {
    const c = hex.replace("#", "");
    const rgb = [0, 2, 4]
      .map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  };
  const a = luminance(first),
    b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
export function contrastWarnings(value?: Partial<Appearance> | null) {
  const a = menuAppearance(value);
  const checks = [
    ["Texto / fondo", a.text, a.background],
    ["Texto / tarjeta", a.text, a.card],
    ["Texto secundario / fondo", a.muted, a.background],
    ["Texto secundario / tarjeta", a.muted, a.card],
    ["Principal / tarjeta (precios)", a.primary, a.card],
    ["Principal / secundario", a.primary, a.secondary],
    ["Blanco / principal (botón activo)", "#ffffff", a.primary],
  ] as const;
  return checks
    .map(([label, fg, bg]) => ({ label, ratio: contrastRatio(fg, bg) }))
    .filter((x) => x.ratio < 4.5);
}
