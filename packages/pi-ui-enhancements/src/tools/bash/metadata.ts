import type {
  Theme,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { buildResultStatusParts } from "../rendering/state";
import { formatDuration } from "../rendering/output";
import type { BashRenderState } from "./types";

type MetadataOptions = {
  durationSummary?: string;
  totalLines?: number;
  includeLineCount?: boolean;
  toolTruncated?: boolean;
};

export function buildBashMetadataParts(
  options: MetadataOptions,
  theme: Theme,
): string[] {
  const parts: string[] = [];

  if (options.durationSummary) {
    parts.push(theme.fg("muted", options.durationSummary));
  }
  parts.push(
    ...buildResultStatusParts({ truncated: options.toolTruncated }, theme),
  );
  if (options.includeLineCount && (options.totalLines ?? 0) > 0) {
    const totalLines = options.totalLines ?? 0;
    parts.push(
      theme.fg("muted", `${totalLines} ${totalLines === 1 ? "line" : "lines"}`),
    );
  }

  return parts;
}

export function joinMetadata(parts: string[], theme: Theme): string {
  return parts.join(theme.fg("muted", " • "));
}

export function getDurationSummary(
  state: BashRenderState,
  options: ToolRenderResultOptions,
): string | undefined {
  const elapsedMs = options.isPartial
    ? state.startedAt === undefined
      ? undefined
      : Math.max(0, Date.now() - state.startedAt)
    : state.durationMs;

  return elapsedMs === undefined
    ? undefined
    : `${options.isPartial ? "elapsed" : "took"} ${formatDuration(elapsedMs)}`;
}
