import type { Theme } from "@earendil-works/pi-coding-agent";
import { getMaxCallWidth } from "../rendering/state";
import { normalizeOutput } from "../rendering/text";
import { formatOmissionRow, formatTreeLine } from "../rendering/tree";
import type { BashOutputWindow } from "./model";

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

export function formatCollapsedBashOutput(
  output: BashOutputWindow,
  theme: Theme,
  color: "toolOutput" | "error" = "toolOutput",
): { text: string; truncated: boolean } {
  let truncated = false;
  const rendered: string[] = [];

  const appendSection = (section: string) => {
    if (!section) return;
    const formatted = formatOutputLines(
      section,
      theme,
      color,
      getBashOutputWidth(),
    );
    truncated ||= formatted.truncated;
    rendered.push(formatted.text);
  };

  appendSection(output.previewHeadText);
  if (output.hiddenLines > 0 && output.previewVisibleLines > 0) {
    rendered.push(
      formatOmissionRow(
        output.hiddenLines,
        { singular: "line", plural: "lines" },
        theme,
      ),
    );
  }
  appendSection(output.previewTailText);

  return { text: rendered.filter(Boolean).join("\n"), truncated };
}
