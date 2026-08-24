import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { getMaxCallWidth } from "./rendering/state";
import { renderPath, sanitizeDisplayText } from "./rendering/text";

const MIN_PATTERN_WIDTH = 4;
const MIN_PATH_WIDTH = 4;

type PatternPathCallOptions = {
  prefix: string;
  title: string;
  pattern: unknown;
  path?: string;
  pathPrefix?: string;
  suffix?: string;
  cwd: string;
  theme: Theme;
};

export type PatternPathCall = {
  collapsedText: string;
  fullText: string;
  compactIsLossy: boolean;
};

export function buildPatternPathCall({
  prefix,
  title,
  pattern,
  path,
  pathPrefix = " in ",
  suffix = "",
  cwd,
  theme,
}: PatternPathCallOptions): PatternPathCall {
  const visiblePathPrefix = path ? pathPrefix : "";
  const overhead = visibleWidth(prefix + title + visiblePathPrefix + suffix);
  const remaining = Math.max(0, getMaxCallWidth() - overhead);

  let patternBudget = remaining;
  let pathBudget = 0;
  if (path) {
    pathBudget = Math.max(
      MIN_PATH_WIDTH,
      Math.floor((remaining - MIN_PATTERN_WIDTH) / 2),
    );
    patternBudget = Math.max(MIN_PATTERN_WIDTH, remaining - pathBudget);
  }

  const rawPattern =
    typeof pattern === "string" ? sanitizeDisplayText(pattern) : "...";
  const patternTruncated = visibleWidth(rawPattern) > patternBudget;
  const collapsedPattern = patternTruncated
    ? truncateToWidth(rawPattern, patternBudget, "...")
    : rawPattern;
  const fullPath = path ? renderPath(path, theme, cwd) : "";
  const pathTruncated = Boolean(path && visibleWidth(fullPath) > pathBudget);
  const collapsedPath = path
    ? visiblePathPrefix + renderPath(path, theme, cwd, pathBudget)
    : "";

  return {
    collapsedText:
      prefix +
      title +
      theme.fg("accent", collapsedPattern) +
      collapsedPath +
      suffix,
    fullText:
      prefix +
      title +
      theme.fg("accent", rawPattern) +
      (path ? visiblePathPrefix + fullPath : "") +
      suffix,
    compactIsLossy: patternTruncated || pathTruncated,
  };
}

export function splitNativeListOutput(text: string): string[] {
  const footerStart = text.lastIndexOf("\n\n[");
  const body = footerStart === -1 ? text : text.slice(0, footerStart);
  return body.split("\n").filter((entry) => entry.length > 0);
}
