import type {
  Theme,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { getBashCollapsedDisplay } from "../rendering/state";
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
    collapsedDisplay: getBashCollapsedDisplay(),
    errorEllipsis: theme.fg("error", "..."),
  });

  switch (view.kind) {
    case "success":
      return renderBashSuccess(view, theme, state);
    case "command-error":
      return renderCommandError(view, theme, state);
    case "unknown-error":
      return renderUnknownError(view, theme, state);
  }
}
