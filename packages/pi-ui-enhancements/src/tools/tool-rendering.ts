// Compatibility facade for existing tool renderers. Implementation lives in
// focused modules under rendering/ so state, text safety, tree layout, and
// result formatting can evolve independently.
export {
  BLINK_INDICATOR,
  MAX_CALL_WIDTH,
  MAX_COLLAPSED_LINES,
  MAX_EXPANDED_ENTRIES,
  buildExpansionHint,
  buildResultStatusParts,
  buildToolExpansionHint,
  clearBlinkTimers,
  getBlinkIndicator,
  getMaxCallWidth,
  getMaxCollapsedLines,
  getMaxExpandedEntries,
  getStatusColor,
  getStatusSymbol,
  invalidateIfChanged,
  isBlinkOn,
  registerToolTimer,
  unregisterToolTimer,
  updateBlinkTimer,
  updateResultState,
} from "./rendering/state";
export {
  closeOpenHyperlink,
  countLines,
  extractTextContent,
  normalizeOutput,
  renderPath,
  safeTruncateToWidth,
  sanitizeDisplayText,
  sanitizeMultilineDisplayText,
} from "./rendering/text";
export {
  formatTreeLine,
  getCallRenderParts,
  getResultText,
  setExpandableCallText,
} from "./rendering/tree";
export {
  buildRenderResult,
  formatErrorBody,
  formatListResult,
  formatSimpleErrorResult,
  getMaxErrorLineWidth,
} from "./rendering/results";
export type {
  BaseRenderState,
  BlinkIndicator,
  FormatResultFn,
  ListResultConfig,
  ResultStatusState,
} from "./rendering/types";
