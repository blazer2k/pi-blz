import {
  VERSION,
  type ExtensionAPI,
  type ExtensionContext,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import figlet from "figlet";
import { getConfig } from "./config";
import type { Handle } from "./types";

export interface AsciiHeaderConfig {
  enabled: boolean;
  text: string;
  font: string;
  align: "left" | "center" | "right";
  showVersion: boolean;
}

export function loadAsciiHeaderConfig(): AsciiHeaderConfig {
  const cfg = getConfig();
  return {
    enabled: cfg.asciiHeaderEnabled,
    text: cfg.asciiHeaderText,
    font: cfg.asciiHeaderFont,
    align: cfg.asciiHeaderAlign,
    showVersion: cfg.asciiHeaderShowVersion,
  };
}

export interface AsciiHeaderData {
  rawLines: string[];
  rawLineWidths: number[];
  versionWidth: number;
}

function stripEmptyEdgeLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;

  while (start < end && lines[start]!.trim().length === 0) {
    start++;
  }

  while (end > start && lines[end - 1]!.trim().length === 0) {
    end--;
  }

  return lines.slice(start, end);
}

export function buildAsciiHeaderData(
  config: AsciiHeaderConfig,
): AsciiHeaderData {
  const rawLines = stripEmptyEdgeLines(
    figlet.textSync(config.text, { font: config.font }).split("\n"),
  );
  return {
    rawLines,
    rawLineWidths: rawLines.map((line) => visibleWidth(line)),
    versionWidth: visibleWidth(`v${VERSION}`),
  };
}

function padLine(
  styled: string,
  rawWidth: number,
  width: number,
  align: string,
) {
  if (align === "left") return " " + styled;
  const pad =
    align === "center"
      ? Math.max(0, Math.floor((width - rawWidth) / 2))
      : Math.max(1, width - rawWidth - 1);
  return " ".repeat(pad) + styled;
}

export function buildAsciiHeader(
  theme: Theme,
  width: number,
  config: AsciiHeaderConfig,
  data: AsciiHeaderData,
): string[] {
  const lines: string[] = [
    "",
    ...data.rawLines.map((line, i) =>
      padLine(
        theme.fg("accent", line),
        data.rawLineWidths[i]!,
        width,
        config.align,
      ),
    ),
    "",
  ];

  if (config.showVersion) {
    lines.push(
      padLine(
        theme.fg("dim", `v${VERSION}`),
        data.versionWidth,
        width,
        config.align,
      ),
    );
  }

  lines.push("");
  return lines;
}

export function registerAsciiHeader(
  _pi: ExtensionAPI,
  ctx: ExtensionContext,
): Handle {
  const config = loadAsciiHeaderConfig();

  if (!config.enabled) {
    return { dispose() {} };
  }

  const data = buildAsciiHeaderData(config);

  ctx.ui.setHeader((_tui, theme) => ({
    render(width: number): string[] {
      return buildAsciiHeader(theme, width, config, data);
    },
    invalidate() {},
  }));

  return {
    dispose() {
      ctx.ui.setHeader(undefined);
    },
  };
}
