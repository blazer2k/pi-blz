import type {
  Theme,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { getMaxCollapsedLines } from "../rendering/state";
import { renderCommandError, renderUnknownError } from "./error-result";
import { buildBashResultView } from "./model";
import { renderBashSuccess } from "./success-result";
import type { BashRenderState, BashResult } from "./types";

export function formatBashResult(
  result: BashResult,
  state: BashRenderState,
  options: ToolRenderResultOptions,
  theme: Theme,
): string {
  const view = buildBashResultView(result, state, options, {
    collapsedLineLimit: getMaxCollapsedLines(),
    errorEllipsis: theme.fg("error", "..."),
  });

  switch (view.kind) {
    case "success":
      return renderBashSuccess(view, theme);
    case "command-error":
      return renderCommandError(view, theme);
    case "unknown-error":
      return renderUnknownError(view, theme);
  }
}
