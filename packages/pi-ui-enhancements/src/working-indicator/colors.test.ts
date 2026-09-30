import { describe, expect, it } from "bun:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  indexedColor,
  oklchColor,
  rgbColor,
  type Color as ThemeColor,
} from "@earendil-works/pi-tui";
import { blend, resolveTheme, rgbFg } from "./colors";

function themeContext(
  colors: { muted: ThemeColor; accent: ThemeColor },
  ansi = "",
  mode = "truecolor",
): ExtensionContext {
  return {
    ui: {
      theme: {
        colors,
        getFgAnsi: () => ansi,
        getColorMode: () => mode,
      },
    },
  } as unknown as ExtensionContext;
}

describe("resolveTheme", () => {
  for (const [name, ansi] of [
    ["terminal-default", "\x1b[39m"],
    ["faint", "\x1b[38;2;40;50;60m\x1b[2m"],
  ] as const) {
    it(`uses resolved ${name} colors instead of ANSI escapes`, () => {
      const ctx = themeContext(
        { muted: rgbColor(10, 20, 30), accent: rgbColor(100, 150, 200) },
        ansi,
      );

      expect(resolveTheme(ctx)).toEqual({
        baseRgb: { r: 10, g: 20, b: 30 },
        highlightRgb: { r: 100, g: 150, b: 200 },
      });
    });
  }

  it("converts indexed and OKLCH theme colors to RGB", () => {
    const ctx = themeContext({
      muted: indexedColor(196),
      accent: oklchColor(1, 0, 0),
    });

    expect(resolveTheme(ctx)).toEqual({
      baseRgb: { r: 255, g: 0, b: 0 },
      highlightRgb: { r: 255, g: 255, b: 255 },
    });
  });

  it("keeps shimmer disabled outside truecolor mode", () => {
    const ctx = themeContext(
      { muted: rgbColor(10, 20, 30), accent: rgbColor(100, 150, 200) },
      "",
      "256color",
    );
    Object.defineProperty(ctx.ui.theme, "colors", {
      get() {
        throw new Error("Non-truecolor rendering must not resolve RGB colors");
      },
    });

    expect(resolveTheme(ctx)).toEqual({
      baseRgb: undefined,
      highlightRgb: undefined,
    });
  });

  it("reads current resolved colors on each call", () => {
    const colors = {
      muted: rgbColor(10, 20, 30),
      accent: rgbColor(100, 150, 200),
    };
    const ctx = themeContext(colors);
    expect(resolveTheme(ctx).baseRgb).toEqual({ r: 10, g: 20, b: 30 });

    colors.muted = rgbColor(40, 50, 60);
    colors.accent = rgbColor(200, 150, 100);

    expect(resolveTheme(ctx)).toEqual({
      baseRgb: { r: 40, g: 50, b: 60 },
      highlightRgb: { r: 200, g: 150, b: 100 },
    });
  });
});

describe("blend", () => {
  it("interpolates colors", () => {
    expect(blend({ r: 0, g: 0, b: 0 }, { r: 100, g: 50, b: 200 }, 0.5)).toEqual(
      {
        r: 50,
        g: 25,
        b: 100,
      },
    );
  });

  it("returns low color when alpha is 0", () => {
    expect(blend({ r: 10, g: 20, b: 30 }, { r: 99, g: 88, b: 77 }, 0)).toEqual({
      r: 10,
      g: 20,
      b: 30,
    });
  });

  it("returns high color when alpha is 1", () => {
    expect(blend({ r: 10, g: 20, b: 30 }, { r: 99, g: 88, b: 77 }, 1)).toEqual({
      r: 99,
      g: 88,
      b: 77,
    });
  });
});

describe("rgbFg", () => {
  it("emits truecolor foreground ANSI", () => {
    expect(rgbFg({ r: 1, g: 2, b: 3 })).toBe("\x1b[38;2;1;2;3m");
  });
});
