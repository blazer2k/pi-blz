import { type ExtensionContext } from "@earendil-works/pi-coding-agent";

export const RESET_FG = "\x1b[39m";

export interface Color {
  r: number;
  g: number;
  b: number;
}

// Extract [r, g, b] from a truecolor ANSI sequence like \x1b[38;2;r;g;bm
export function parseRgb(ansi: string): Color | undefined {
  const m = ansi.match(/^\x1b\[38;2;(\d+);(\d+);(\d+)m$/);
  if (!m || !m[1] || !m[2] || !m[3]) return undefined;
  return {
    r: Math.min(255, +m[1]),
    g: Math.min(255, +m[2]),
    b: Math.min(255, +m[3]),
  };
}

// Blend two RGB colors by alpha (0 = low, 1 = high)
export function blend(low: Color, high: Color, a: number): Color {
  return {
    r: Math.round(low.r + (high.r - low.r) * a),
    g: Math.round(low.g + (high.g - low.g) * a),
    b: Math.round(low.b + (high.b - low.b) * a),
  };
}

// ANSI fg for an RGB color
export function rgbFg(c: Color): string {
  return `\x1b[38;2;${c.r};${c.g};${c.b}m`;
}

export function resolveTheme(ctx: ExtensionContext): {
  baseRgb: Color | undefined;
  highlightRgb: Color | undefined;
} {
  const theme = ctx.ui.theme;
  let baseRgb: Color | undefined, highlightRgb: Color | undefined;

  if (theme.getColorMode() === "truecolor") {
    baseRgb = parseRgb(theme.getFgAnsi("muted"));
    highlightRgb = parseRgb(theme.getFgAnsi("accent"));
  }

  return {
    baseRgb,
    highlightRgb,
  };
}
