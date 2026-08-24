import type { Theme } from "@earendil-works/pi-coding-agent";
import { getMaxCallWidth } from "../rendering/state";
import { normalizeOutput } from "../rendering/text";
import { formatTreeLine } from "../rendering/tree";

// "● " (status symbol + space) + "├─ " (tree connector) + 1 buffer.
const TREE_PREFIX_WIDTH = 6;

export function getBashOutputWidth(): number {
  return Math.max(1, getMaxCallWidth() - TREE_PREFIX_WIDTH);
}

export function formatDuration(milliseconds: number): string {
  return milliseconds < 1000
    ? `${milliseconds}ms`
    : `${(milliseconds / 1000).toFixed(1)}s`;
}

export function formatHiddenLinesLabel(
  hiddenLines: number,
  theme: Theme,
): string {
  const label = `${hiddenLines} more ${hiddenLines === 1 ? "line" : "lines"}`;
  return theme.fg("dim", "┊  ") + theme.italic(theme.fg("muted", label));
}

export function formatOutputLines(
  text: string,
  theme: Theme,
  color: "toolOutput" | "error" = "toolOutput",
  maxLineWidth?: number,
  options: { closeLastLine?: boolean } = {},
): { text: string; truncated: boolean } {
  const output = normalizeOutput(text);
  if (!output) return { text: "", truncated: false };

  let truncated = false;
  const lines = output.split("\n");
  const renderedLines = lines.map((line, index) => {
    const closeLine = options.closeLastLine && index === lines.length - 1;
    const rendered = formatTreeLine(line, {
      theme,
      prefix: closeLine ? "╰─ " : "│  ",
      width: (maxLineWidth ?? getBashOutputWidth()) + 3,
      mode: maxLineWidth === undefined ? "preserve" : "truncate",
      color,
    });
    truncated ||= rendered.truncated;
    return rendered.text;
  });

  return { text: renderedLines.join("\n"), truncated };
}
