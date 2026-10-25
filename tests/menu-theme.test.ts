import { describe, it, expect } from "vitest";
import {
  contrastRatio,
  contrastWarnings,
  menuAppearance,
  themeStyle,
} from "../src/lib/menu-theme";
describe("published/preview appearance contract", () => {
  it("keeps legacy page/card/text colors and one mobile/two desktop columns", () => {
    expect(
      menuAppearance({ primary: "#112233", secondary: "#efeedd" }),
    ).toMatchObject({
      primary: "#112233",
      secondary: "#efeedd",
      background: "#fcfcf8",
      card: "#ffffff",
      text: "#253026",
      muted: "#596a4c",
      columns_mobile: 1,
      columns_desktop: 2,
    });
  });
  it("uses chosen colors exactly instead of silently correcting poor contrast", () => {
    const a = {
      primary: "#ffffff",
      background: "#ffffff",
      card: "#ffffff",
      text: "#ffffff",
      muted: "#ffffff",
      columns_mobile: 2 as const,
      columns_desktop: 1 as const,
    };
    expect(themeStyle(a)).toMatchObject({
      "--menu-primary": "#ffffff",
      "--menu-text": "#ffffff",
      "--menu-columns-mobile": 2,
      "--menu-columns-desktop": 1,
    });
    expect(contrastWarnings(a).length).toBeGreaterThan(0);
  });
  it("computes reference contrast and accepts legible default text", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21);
    expect(contrastRatio("#ffffff", "#ffffff")).toBe(1);
    expect(
      contrastWarnings().filter((x) => x.label.startsWith("Texto")),
    ).toEqual([]);
  });
  it("keeps legacy images/font when only one new token is supplied", () => {
    expect(
      menuAppearance({
        logo_path: "a/logo.webp",
        font: "serif",
        card: "#ffeecc",
      }),
    ).toMatchObject({
      logo_path: "a/logo.webp",
      font: "serif",
      card: "#ffeecc",
      background: "#fcfcf8",
    });
  });
});
