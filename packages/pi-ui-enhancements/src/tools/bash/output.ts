import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  formatTreeLine,
  getMaxCallWidth,
  normalizeOutput,
} from "../tool-rendering";
import type { BashDetailsWithTiming } from "./types";

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

const BASH_STATUS_PATTERN =
  /^(?:Command exited with code \d+|Command timed out after .+ seconds|Command aborted)$/;

export function parseBashErrorText(text: string): {
  output: string;
  status?: string;
} {
  const normalized = normalizeOutput(text).replace(
    /^\(no output\)\n\n(?=Command (?:exited|timed out|aborted))/,
    "",
  );
  const lines = normalized.split("\n");
  const lastLine = lines.at(-1) ?? "";

  if (!BASH_STATUS_PATTERN.test(lastLine)) return { output: normalized };

  const output = lines.slice(0, -1).join("\n").trimEnd();
  return {
    output: output === "(no output)" ? "" : output,
    status: lastLine,
  };
}

export function stripBashTruncationNotice(
  text: string,
  details: BashDetailsWithTiming | undefined,
): string {
  if (!details?.truncation?.truncated && !details?.fullOutputPath) return text;

  const normalized = normalizeOutput(text);
  const footerStart = normalized.lastIndexOf("\n\n[");
  if (footerStart === -1 || !normalized.endsWith("]")) return text;

  const footer = normalized.slice(footerStart);
  if (details.fullOutputPath && !footer.includes(details.fullOutputPath)) {
    return text;
  }
  if (!details.fullOutputPath && !footer.includes("Showing lines")) return text;

  return normalized.slice(0, footerStart).trimEnd();
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
