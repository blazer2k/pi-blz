import {
  createWriteToolDefinition,
  Theme,
  highlightCode,
  getLanguageFromPath,
  type ExtensionAPI,
  type ToolRenderResultOptions,
  type WriteToolInput,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { formatSimpleErrorResult } from "./rendering/results";
import {
  buildResultStatusParts,
  buildToolExpansionHint,
  getMaxCallWidth,
  invalidateIfChanged,
  updateResultState,
} from "./rendering/state";
import { countLines, extractTextContent, renderPath } from "./rendering/text";
import {
  formatTreeLine,
  getCallRenderParts,
  getResultText,
  setExpandableCallText,
} from "./rendering/tree";
import type { BaseRenderState } from "./rendering/types";
import type { Handle } from "../shared/handle";
import {
  createCwdDeferredTool,
  registerPatchedTool,
} from "./tool-registration";

type WriteHighlightCache = {
  rawPath: string | null;
  lang: string;
  rawContent: string;
  sourceLines: string[];
  highlightedLines: string[];
};

type WriteRenderState = BaseRenderState & {
  highlightCache?: WriteHighlightCache;
};

const WRITE_CONTEXT_HIGHLIGHT_LINES = 50;

function highlightSingleLine(line: string, lang: string): string {
  return highlightCode(line, lang)[0] ?? "";
}

function refreshHighlightContext(cache: WriteHighlightCache): void {
  const count = Math.min(
    WRITE_CONTEXT_HIGHLIGHT_LINES,
    cache.sourceLines.length,
  );
  if (count === 0) return;

  const highlighted = highlightCode(
    cache.sourceLines.slice(0, count).join("\n"),
    cache.lang,
  );
  for (let index = 0; index < count; index++) {
    cache.highlightedLines[index] =
      highlighted[index] ??
      highlightSingleLine(cache.sourceLines[index] ?? "", cache.lang);
  }
}

function rebuildHighlightCache(
  rawPath: string | null,
  content: string,
): WriteHighlightCache | undefined {
  const lang = rawPath ? getLanguageFromPath(rawPath) : undefined;
  if (!lang) return undefined;

  const sourceLines = content.split("\n");
  const highlighted = highlightCode(content, lang);
  return {
    rawPath,
    lang,
    rawContent: content,
    sourceLines,
    highlightedLines: sourceLines.map(
      (line, index) => highlighted[index] ?? highlightSingleLine(line, lang),
    ),
  };
}

function updateHighlightCache(
  cache: WriteHighlightCache | undefined,
  rawPath: string | null,
  content: string,
): WriteHighlightCache | undefined {
  const lang = rawPath ? getLanguageFromPath(rawPath) : undefined;
  if (!lang) return undefined;
  if (
    !cache ||
    cache.rawPath !== rawPath ||
    cache.lang !== lang ||
    !content.startsWith(cache.rawContent)
  ) {
    return rebuildHighlightCache(rawPath, content);
  }
  if (content.length === cache.rawContent.length) return cache;

  const delta = content.slice(cache.rawContent.length);
  const segments = delta.split("\n");
  const lastIndex = cache.sourceLines.length - 1;
  cache.sourceLines[lastIndex] =
    (cache.sourceLines[lastIndex] ?? "") + (segments[0] ?? "");
  cache.highlightedLines[lastIndex] = highlightSingleLine(
    cache.sourceLines[lastIndex] ?? "",
    cache.lang,
  );
  for (let index = 1; index < segments.length; index++) {
    const line = segments[index] ?? "";
    cache.sourceLines.push(line);
    cache.highlightedLines.push(highlightSingleLine(line, cache.lang));
  }
  cache.rawContent = content;
  refreshHighlightContext(cache);
  return cache;
}

function getHighlightedWriteLines(
  state: WriteRenderState,
  path: string | undefined,
  content: string,
  theme: Theme,
): string[] {
  state.highlightCache = updateHighlightCache(
    state.highlightCache,
    path ?? null,
    content,
  );

  const sourceLines = content.split("\n");
  const displayLineCount =
    content.endsWith("\n") && content.length > 0
      ? sourceLines.length - 1
      : sourceLines.length;
  if (state.highlightCache) {
    return state.highlightCache.highlightedLines.slice(0, displayLineCount);
  }

  return sourceLines
    .slice(0, displayLineCount)
    .map((line) => theme.fg("mdCodeBlock", line));
}

function formatWriteResult(
  result: { content: Array<{ type: string; text?: string }> },
  state: WriteRenderState,
  options: ToolRenderResultOptions,
  theme: Theme,
  args: WriteToolInput,
): string {
  const textContent = extractTextContent(result);

  if (state.isError) {
    return formatSimpleErrorResult(textContent, state, options, theme);
  }

  const lines = countLines(args.content);
  const hint = buildToolExpansionHint(theme, state, options, lines > 0);
  const summary = `${lines} ${lines === 1 ? "line" : "lines"}`;
  const metadataParts = buildResultStatusParts(state, theme);
  metadataParts.push(theme.fg("muted", summary));
  const metadata = metadataParts.join(theme.fg("muted", " • "));

  if (lines === 0) {
    return theme.fg("dim", "╰─ ") + metadata + hint;
  }

  if (options.expanded) {
    const renderedLines = getHighlightedWriteLines(
      state,
      args.path,
      args.content,
      theme,
    ).map(
      (line) =>
        formatTreeLine(line, {
          theme,
          prefix: "│  ",
          width: getMaxCallWidth() - 1,
          mode: "preserve",
        }).text,
    );
    renderedLines.push(theme.fg("dim", "╰─ ") + metadata + hint);
    return renderedLines.join("\n");
  }

  return theme.fg("dim", "╰─ ") + metadata + hint;
}

export function patchWriteTool(pi: ExtensionAPI): Handle {
  const tool = createCwdDeferredTool(createWriteToolDefinition);

  return registerPatchedTool({
    pi,
    tool,
    renderCall(args, theme, toolCtx) {
      const state = toolCtx.state as WriteRenderState;
      const renderArgs = args as WriteToolInput;
      const { text, prefix } = getCallRenderParts(state, theme, toolCtx, {
        staticActive: toolCtx.expanded,
      });

      const title = theme.fg("toolTitle", theme.bold("Write "));
      const fullPath = renderPath(renderArgs.path, theme, toolCtx.cwd);
      const pathWidth = Math.max(
        1,
        getMaxCallWidth() - visibleWidth(prefix + title),
      );
      let collapsedText =
        prefix +
        title +
        renderPath(renderArgs.path, theme, toolCtx.cwd, pathWidth);
      let fullText = prefix + title + fullPath;

      setExpandableCallText(text, state, {
        expanded: toolCtx.expanded,
        collapsedText,
        fullText,
        compactIsLossy: visibleWidth(fullPath) > pathWidth,
        ellipsis: theme.fg("accent", "..."),
      });
      if (toolCtx.isPartial && typeof renderArgs.content === "string") {
        const partialResult = formatWriteResult(
          { content: [] },
          state,
          { expanded: toolCtx.expanded, isPartial: toolCtx.isPartial },
          theme,
          renderArgs,
        );
        collapsedText += `\n${partialResult}`;
        fullText += `\n${partialResult}`;
        text.setText(toolCtx.expanded ? fullText : collapsedText);
      }
      return text;
    },
    renderResult(result, options, theme, toolCtx) {
      const state = toolCtx.state as WriteRenderState;
      const text = getResultText(state, options, toolCtx.lastComponent);

      const details = result.details as
        | { truncation?: { truncated?: boolean } }
        | undefined;
      const changed = updateResultState(state, {
        truncated: details?.truncation?.truncated === true,
        isError: toolCtx.isError,
      });

      invalidateIfChanged(changed, toolCtx.invalidate);

      const writeArgs = toolCtx.args as WriteToolInput;
      text.setText(formatWriteResult(result, state, options, theme, writeArgs));

      return text;
    },
  });
}
