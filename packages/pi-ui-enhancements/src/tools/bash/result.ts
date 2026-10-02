import type {
  Theme,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { getCollapsedOutputDisplay } from "../rendering/state";
import { renderCommandError, renderUnknownError } from "./error-result";
import { buildBashResultView } from "./model";
import { renderBashSuccess } from "./success-result";
import type { BashRenderState, BashResult } from "./types";

export function formatBashResult(
  result: BashResult,
  state: BashRenderState,
  options: ToolRenderResultOptions,
  theme: Theme,
  width: number,
): string {
  const view = buildBashResultView(result, state, options, {
    collapsedDisplay: getCollapsedOutputDisplay(),
    errorEllipsis: theme.fg("error", "..."),
    errorWidth: Math.max(1, width - 3),
  });

  switch (view.kind) {
    case "success":
      return renderBashSuccess(view, theme, state, width);
    case "command-error":
      return renderCommandError(view, theme, state, width);
    case "unknown-error":
      return renderUnknownError(view, theme, state, width);
  }
}
