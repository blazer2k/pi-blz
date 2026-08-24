import type {
  Theme,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { buildResultStatusParts } from "../tool-rendering";
import { formatDuration } from "./output";
import type { BashDetailsWithTiming, BashRenderState } from "./types";

type MetadataOptions = {
  durationSummary?: string;
  remainingLines?: number;
  visibleLines?: number;
  callExpandable?: boolean;
  lineTruncated?: boolean;
  toolTruncated?: boolean;
  expanded?: boolean;
};

export function buildBashMetadataParts(
  options: MetadataOptions,
  theme: Theme,
): { parts: string[]; needsHint: boolean } {
  const parts: string[] = [];
  let needsHint = false;

  if (options.durationSummary) {
    parts.push(theme.fg("muted", options.durationSummary));
  }
  parts.push(
    ...buildResultStatusParts({ truncated: options.toolTruncated }, theme),
  );
  if ((options.remainingLines ?? 0) > 0) {
    if (options.visibleLines === 0) {
      const remainingLines = options.remainingLines ?? 0;
      const suffix = remainingLines === 1 ? "line" : "lines";
      parts.push(theme.fg("muted", `${remainingLines} ${suffix}`));
    }
    needsHint = true;
  }
  if (options.callExpandable && !options.expanded) needsHint = true;
  if (options.lineTruncated) needsHint = true;

  return { parts, needsHint };
}

export function joinMetadata(parts: string[], theme: Theme): string {
  return parts.join(theme.fg("muted", " • "));
}

export function getDurationSummary(
  details: BashDetailsWithTiming | undefined,
  state: BashRenderState,
  options: ToolRenderResultOptions,
): string | undefined {
  const elapsedMs =
    details?.durationMs ??
    state.durationMs ??
    (state.startedAt === undefined
      ? undefined
      : (state.endedAt ?? Date.now()) - state.startedAt);

  return elapsedMs === undefined
    ? undefined
    : `${options.isPartial ? "elapsed" : "took"} ${formatDuration(elapsedMs)}`;
}
