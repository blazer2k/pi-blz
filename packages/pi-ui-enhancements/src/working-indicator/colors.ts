import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { colorToRgb } from "@earendil-works/pi-tui";

export const RESET_FG = "\x1b[39m";

export interface Color {
  r: number;
  g: number;
  b: number;
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
    const colors = theme.colors;
    baseRgb = colorToRgb(colors.muted);
    highlightRgb = colorToRgb(colors.accent);
  }

  return {
    baseRgb,
    highlightRgb,
  };
}
