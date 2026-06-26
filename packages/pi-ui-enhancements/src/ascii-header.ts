import {
  VERSION,
  type ExtensionAPI,
  type ExtensionContext,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import figlet from "figlet";
import { getConfig } from "./config";
import type { Handle } from "./types";

export interface AsciiHeaderConfig {
  enabled: boolean;
  text: string;
  font: string;
  color: "text" | "accent" | "dim";
  align: "left" | "center" | "right";
  showVersion: boolean;
}

export function loadAsciiHeaderConfig(): AsciiHeaderConfig {
  const cfg = getConfig();
  return {
    enabled: cfg.asciiHeaderEnabled,
    text: "pi",
    font: cfg.asciiHeaderFont,
    color: cfg.asciiHeaderColor,
    align: cfg.asciiHeaderAlign,
    showVersion: cfg.asciiHeaderShowVersion,
  };
}

export interface AsciiHeaderData {
  rawLines: string[];
  rawLineWidths: number[];
  versionWidth: number;
}

const PI_FONTS: Record<string, string[]> = {
  "Greek": [
    "▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄",
    "  ███║    ███║  ",
    "  ███║    ███║  ",
    "  ███║    ███║  ",
    "  ███║    ███║  ",
    "▀▀▀▀▀▀▀ ▀▀▀▀▀▀▀",
  ],
  "Greek Large": [
    "   ███████████████████████████╗  ",
    "   ╚══██████╔════════██████╔══╝  ",
    "      ██████║        ██████║     ",
    "      ██████║        ██████║     ",
    "      ██████║        ██████║     ",
    "      ██████║        ██████║     ",
    "      ██████║        ██████║     ",
    "      ██████║        ██████║     ",
    "   ████████████╗  ████████████╗  ",
    "   ╚═══════════╝  ╚═══════════╝  ",
  ],
};

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
  let rawLines: string[];
  let rawLineWidths: number[];

  const piFont = PI_FONTS[config.font];
  if (piFont) {
    rawLines = piFont;
    const maxWidth = Math.max(...rawLines.map((l) => visibleWidth(l)));
    rawLineWidths = rawLines.map(() => maxWidth);
  } else {
    try {
      rawLines = stripEmptyEdgeLines(
        figlet.textSync(config.text, { font: config.font }).split("\n"),
      );
    } catch {
      rawLines = [config.text];
    }
    rawLineWidths = rawLines.map((line) => visibleWidth(line));
  }

  return {
    rawLines,
    rawLineWidths,
    versionWidth: visibleWidth(`v${VERSION}`),
  };
}

function padLine(
  styled: string,
  rawWidth: number,
  width: number,
  align: string,
) {
  const safeWidth = Math.max(0, width);
  const line = (() => {
    if (align === "left") return " " + styled;
    const pad =
      align === "center"
        ? Math.max(0, Math.floor((safeWidth - rawWidth) / 2))
        : Math.max(1, safeWidth - rawWidth - 1);
    return " ".repeat(pad) + styled;
  })();

  return truncateToWidth(line, safeWidth, "");
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
        theme.fg(config.color, line),
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
  onReregister: (fn: () => void) => void,
): Handle {
  function applyHeader() {
    const config = loadAsciiHeaderConfig();

    if (!config.enabled) {
      ctx.ui.setHeader(undefined);
      return;
    }

    const data = buildAsciiHeaderData(config);

    ctx.ui.setHeader((_tui, theme) => ({
      render(width: number): string[] {
        return buildAsciiHeader(theme, width, config, data);
      },
      invalidate() {},
    }));
  }
  applyHeader();
  onReregister(applyHeader);

  return {
    dispose() {
      ctx.ui.setHeader(undefined);
    },
  };
}
