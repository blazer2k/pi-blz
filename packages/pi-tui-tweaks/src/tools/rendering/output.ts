import type { Theme } from "@earendil-works/pi-coding-agent";
import { countLines, normalizeOutput } from "./text";
import { formatOmissionRow, formatTreeLine } from "./tree";

export type OutputWindow = {
  fullText: string;
  previewHeadLines: string[];
  previewTailLines: string[];
  totalLines: number;
  hiddenLines: number;
};

export function selectOutputWindow(
  text: string,
  collapsedDisplay: "preview" | "summary",
): OutputWindow {
  const fullText = normalizeOutput(text).replace(/\n+$/g, "");
  const totalLines = countLines(fullText);
  const lines = totalLines === 0 ? [] : fullText.split("\n");

  if (collapsedDisplay === "summary" || totalLines === 0) {
    return {
      fullText,
      previewHeadLines: [],
      previewTailLines: [],
      totalLines,
      hiddenLines: totalLines,
    };
  }

  if (totalLines <= 3) {
    return {
      fullText,
      previewHeadLines: lines,
      previewTailLines: [],
      totalLines,
      hiddenLines: 0,
    };
  }

  return {
    fullText,
    previewHeadLines: lines.slice(0, 1),
    previewTailLines: lines.slice(-1),
    totalLines,
    hiddenLines: totalLines - 2,
  };
}

export function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) return `${milliseconds}ms`;

  const seconds = milliseconds / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;

  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;

  return `${Math.floor(minutes / 60)}h ${minutes % 60}m ${remainingSeconds}s`;
}

function formatOutputLine(
  line: string,
  theme: Theme,
  color: "toolOutput" | "error",
  maxLineWidth?: number,
  closeLine = false,
): { text: string; truncated: boolean } {
  return formatTreeLine(line, {
    theme,
    prefix: closeLine ? "╰─ " : "│  ",
    width: maxLineWidth === undefined ? undefined : maxLineWidth + 3,
    color,
  });
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
    const rendered = formatOutputLine(
      line,
      theme,
      color,
      maxLineWidth,
      options.closeLastLine && index === lines.length - 1,
    );
    truncated ||= rendered.truncated;
    return rendered.text;
  });

  return { text: renderedLines.join("\n"), truncated };
}

export function formatCollapsedOutput(
  output: OutputWindow,
  theme: Theme,
  color: "toolOutput" | "error",
  width: number,
): { text: string; truncated: boolean } {
  let truncated = false;
  const rendered: string[] = [];

  const appendLines = (lines: string[]) => {
    for (const line of lines) {
      const formatted = formatOutputLine(
        line,
        theme,
        color,
        Math.max(1, width - 3),
      );
      truncated ||= formatted.truncated;
      rendered.push(formatted.text);
    }
  };

  appendLines(output.previewHeadLines);
  if (
    output.hiddenLines > 0 &&
    output.previewHeadLines.length + output.previewTailLines.length > 0
  ) {
    rendered.push(
      formatOmissionRow(
        output.hiddenLines,
        { singular: "line", plural: "lines" },
        theme,
      ),
    );
  }
  appendLines(output.previewTailLines);

  return { text: rendered.filter(Boolean).join("\n"), truncated };
}
