import type {
  Theme,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import {
  buildResultStatusParts,
  getMaxCallWidth,
  getMaxExpandedEntries,
} from "../rendering/state";
import { extractTextContent, normalizeOutput } from "../rendering/text";
import { formatSimpleErrorResult } from "../rendering/results";
import { formatTreeLine } from "../rendering/tree";
import type { BaseRenderState, ToolTextResult } from "../rendering/types";

export function buildGenericResult(
  result: ToolTextResult,
  state: BaseRenderState,
  options: ToolRenderResultOptions,
  theme: Theme,
): string {
  if (state.isError) {
    return formatSimpleErrorResult(
      extractTextContent(result),
      state,
      options,
      theme,
    );
  }

  const normalized = normalizeOutput(extractTextContent(result));
  if (!normalized) {
    const metadataParts = buildResultStatusParts(state, theme);
    metadataParts.push(theme.fg("muted", "(no output)"));
    return (
      theme.fg("dim", "╰─ ") + metadataParts.join(theme.fg("muted", " • "))
    );
  }

  const lines = normalized.split("\n");
  const total = lines.length;
  const metadataParts = buildResultStatusParts(state, theme);
  metadataParts.push(
    theme.fg("muted", `${total} ${total === 1 ? "line" : "lines"}`),
  );
  const metadata = metadataParts.join(theme.fg("muted", " • "));

  if (!options.expanded) return theme.fg("dim", "╰─ ") + metadata;

  const maxEntries = getMaxExpandedEntries();
  const visible = lines.slice(0, maxEntries);
  const remaining = Math.max(0, total - maxEntries);
  const rendered: string[] = [theme.fg("dim", "├─ ") + metadata];

  visible.forEach((line, index) => {
    const isLast = index === visible.length - 1 && remaining === 0;
    rendered.push(
      formatTreeLine(line, {
        theme,
        prefix: isLast ? "╰─ " : "│  ",
        width: getMaxCallWidth() - 1,
        mode: "preserve",
      }).text,
    );
  });

  if (remaining > 0) {
    rendered.push(
      theme.fg("dim", "╰─ ") + theme.fg("muted", `${remaining} more lines`),
    );
  }

  return rendered.join("\n");
}
