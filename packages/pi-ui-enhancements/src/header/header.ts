import {
  VERSION,
  parseArgs,
  type ExtensionAPI,
  type ExtensionContext,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  backgroundAnsi,
  foregroundAnsi,
  isAppleTerminalSession,
  rgbColor,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import type { Config } from "../config/definition";
import { getConfig } from "../config/store";
import type { Handle } from "../shared/handle";

export type HeaderConfig = Pick<Config, "headerMode" | "headerAlign">;

const CORAL = rgbColor(228, 138, 122);
const BLUE = rgbColor(79, 142, 179);
const YELLOW = rgbColor(234, 182, 93);
const RESET = "\x1b[0m";

function logoLines(
  theme: Theme,
  large: boolean,
  appleTerminal: boolean,
): string[] {
  const mode = theme.getColorMode();
  const fg = (color: typeof CORAL) => foregroundAnsi(color, mode);
  if (appleTerminal) {
    return [`${fg(CORAL)}P${RESET}${fg(YELLOW)}i${RESET}`];
  }
  if (large) {
    return [
      `${fg(CORAL)}██████${RESET}  `,
      `${fg(BLUE)}██${RESET}  ${fg(CORAL)}██${RESET}  `,
      `${fg(BLUE)}████${RESET}  ${fg(YELLOW)}██${RESET}`,
      `${fg(BLUE)}██${RESET}    ${fg(YELLOW)}██${RESET}`,
    ];
  }
  return [
    `${fg(CORAL)}${backgroundAnsi(BLUE, mode)}▀${RESET}${fg(CORAL)}▀█${RESET} `,
    `${fg(BLUE)}█▀${RESET} ${fg(YELLOW)}█${RESET}`,
  ];
}

function alignLine(
  line: string,
  lineWidth: number,
  width: number,
  align: HeaderConfig["headerAlign"],
): string {
  const padding =
    align === "left" ? 1 : Math.max(0, Math.floor((width - lineWidth) / 2));
  return truncateToWidth(" ".repeat(padding) + line, Math.max(0, width), "");
}

export function buildHeader(
  theme: Theme,
  width: number,
  config: HeaderConfig,
  appleTerminal: boolean,
): string[] {
  if (config.headerMode === "native" || config.headerMode === "off") return [];
  const logo = logoLines(theme, config.headerMode === "large", appleTerminal);
  const logoWidth = Math.max(...logo.map(visibleWidth));
  const version = `v${VERSION}`;
  return [
    "",
    ...logo.map((line) =>
      alignLine(line, logoWidth, width, config.headerAlign),
    ),
    "",
    alignLine(
      theme.fg("dim", version),
      visibleWidth(version),
      width,
      config.headerAlign,
    ),
    "",
  ];
}

export function registerHeader(
  pi: Pick<ExtensionAPI, "getSettings">,
  ctx: ExtensionContext,
): Handle {
  const config = getConfig();
  if (config.headerMode === "native") return { dispose() {} };
  const showHeader =
    pi.getSettings().quietStartup !== true ||
    parseArgs(process.argv.slice(2)).verbose === true;
  const appleTerminal = isAppleTerminalSession();
  let owned = false;
  ctx.ui.setHeader((_tui, theme) => {
    owned = true;
    return {
      render: (width) =>
        showHeader ? buildHeader(theme, width, config, appleTerminal) : [],
      invalidate() {},
      dispose() {
        owned = false;
      },
    };
  });
  return {
    dispose() {
      if (!owned) return;
      owned = false;
      ctx.ui.setHeader(undefined);
    },
  };
}
