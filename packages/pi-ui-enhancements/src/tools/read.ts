import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { getPackageDir } from "@earendil-works/pi-coding-agent";
import type {
  ExtensionAPI,
  ToolRenderResultOptions,
  Theme,
  ReadToolInput,
} from "@earendil-works/pi-coding-agent";
import { createReadToolDefinition } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Handle } from "../types";
import {
  createCwdDeferredTool,
  registerPatchedTool,
} from "./tool-registration";
import {
  type BaseRenderState,
  buildRenderResult,
  buildResultStatusParts,
  buildToolExpansionHint,
  countLines,
  extractTextContent,
  formatSimpleErrorResult,
  formatTreeLine,
  getCallRenderParts,
  getMaxCallWidth,
  renderPath,
  sanitizeDisplayText,
  setExpandableCallText,
} from "./tool-rendering";

const COMPACT_RESOURCE_FILE_NAMES = new Set([
  "AGENTS.md",
  "AGENTS.MD",
  "CLAUDE.md",
  "CLAUDE.MD",
]);

type CompactReadClassification =
  | { kind: "docs"; label: string }
  | { kind: "skill"; label: string }
  | { kind: "resource"; label: string };

function toPosixPath(filePath: string): string {
  return filePath.split(sep).join("/");
}

function resolveToCwd(filePath: string, cwd: string): string {
  return isAbsolute(filePath) ? filePath : resolve(cwd, filePath);
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel !== "" && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function getPiDocsClassification(
  absolutePath: string,
): CompactReadClassification | undefined {
  const packageRoot = getPackageDir();

  if (!isInside(packageRoot, absolutePath)) return undefined;

  const label = toPosixPath(relative(packageRoot, absolutePath));

  if (
    label === "README.md" ||
    label.startsWith("docs/") ||
    label.startsWith("examples/")
  ) {
    return { kind: "docs", label };
  }

  return undefined;
}

function getCompactReadClassification(
  args: ReadToolInput | undefined,
  cwd: string,
): CompactReadClassification | undefined {
  const rawPath = args?.path;
  if (!rawPath) return undefined;

  const absolutePath = resolveToCwd(rawPath, cwd);
  const fileName = basename(absolutePath);

  if (fileName === "SKILL.md") {
    return {
      kind: "skill",
      label: basename(dirname(absolutePath)) || fileName,
    };
  }

  const docsClassification = getPiDocsClassification(absolutePath);
  if (docsClassification) return docsClassification;

  if (COMPACT_RESOURCE_FILE_NAMES.has(fileName)) {
    return {
      kind: "resource",
      label: toPosixPath(relative(cwd, absolutePath)),
    };
  }

  return undefined;
}

function formatCompactReadCall(
  classification: CompactReadClassification,
  args: ReadToolInput,
  theme: Theme,
  maxWidth: number,
): string {
  const lineRange = formatReadLineRange(args, theme);

  if (classification.kind === "skill") {
    const title = theme.fg("customMessageLabel", theme.bold("[skill] "));
    const label = truncateToWidth(
      classification.label,
      Math.max(1, maxWidth - visibleWidth(title + lineRange)),
      "...",
    );

    return title + theme.fg("customMessageText", label) + lineRange;
  }

  const title = theme.fg(
    "toolTitle",
    theme.bold(`Read ${classification.kind} `),
  );
  const label = truncateToWidth(
    classification.label,
    Math.max(1, maxWidth - visibleWidth(title + lineRange)),
    "...",
  );

  return title + theme.fg("accent", label) + lineRange;
}

function formatReadLineRange(
  args: ReadToolInput | undefined,
  theme: Theme,
): string {
  if (args?.offset === undefined && args?.limit === undefined) return "";
  const startLine = args.offset ?? 1;
  const endLine = args.limit !== undefined ? startLine + args.limit - 1 : "";
  return theme.fg("dim", `:${startLine}${endLine ? `-${endLine}` : ""}`);
}

function stripReadContinuationNotice(text: string): string {
  const normalized = text.endsWith("\n") ? text.slice(0, -1) : text;
  const footerStart = normalized.lastIndexOf("\n\n[");
  if (footerStart === -1) return normalized;

  const footer = normalized.slice(footerStart + 2);
  const isContinuation =
    /^\[\d+ more lines? in file\. Use offset=\d+ to continue\.\]$/.test(
      footer,
    ) ||
    /^\[Showing lines \d+-\d+ of \d+(?: \([^)]+ limit\))?\. Use offset=\d+ to continue\.\]$/.test(
      footer,
    );
  return isContinuation
    ? normalized.slice(0, footerStart).trimEnd()
    : normalized;
}

function getImageReadMarker(text: string): { reason?: string } | undefined {
  const match = text.match(/^Read image file \[[^\]]+\](?:\n([\s\S]*))?$/);
  if (!match) return undefined;

  const reasonLine = match[1]
    ?.split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  const reason = reasonLine?.replace(/^\[|\]$/g, "");
  return { reason: reason ? sanitizeDisplayText(reason) : undefined };
}

function formatReadResult(
  result: {
    content: Array<{ type: string; text?: string }>;
    details?: unknown;
  },
  state: BaseRenderState,
  options: ToolRenderResultOptions,
  theme: Theme,
): string {
  const hasImage = result.content.some((c) => c.type === "image");
  const textContent = extractTextContent(result);

  if (state.isError) {
    return formatSimpleErrorResult(textContent, state, options, theme);
  }

  const metadataParts = buildResultStatusParts(state, theme);
  const callHint = buildToolExpansionHint(theme, state, options, false);
  const imageMarker = getImageReadMarker(textContent);

  if (hasImage) {
    const match = textContent.match(/original\s+(\d+)x(\d+)/i);
    metadataParts.push(
      theme.fg("muted", match ? `Image (${match[1]}x${match[2]})` : "Image"),
    );
  } else if (imageMarker) {
    metadataParts.push(theme.fg("warning", "Image unavailable"));
    const summary = metadataParts.join(theme.fg("muted", " • ")) + callHint;
    if (!imageMarker.reason) return theme.fg("dim", "╰─ ") + summary;

    const reason = formatTreeLine(imageMarker.reason, {
      theme,
      prefix: "╰─ ",
      width: getMaxCallWidth() - 1,
      mode: "preserve",
      color: "muted",
    }).text;
    return theme.fg("dim", "├─ ") + summary + "\n" + reason;
  } else {
    const fileContent = stripReadContinuationNotice(textContent);
    const lines = countLines(fileContent);
    metadataParts.push(
      theme.fg(
        "muted",
        lines > 0 ? `${lines} ${lines === 1 ? "line" : "lines"}` : "no content",
      ),
    );
  }

  return (
    theme.fg("dim", "╰─ ") +
    metadataParts.join(theme.fg("muted", " • ")) +
    callHint
  );
}

export function patchReadTool(pi: ExtensionAPI): Handle {
  const tool = createCwdDeferredTool(createReadToolDefinition);

  return registerPatchedTool({
    pi,
    tool,
    renderCall(args, theme, toolCtx) {
      const state = toolCtx.state as BaseRenderState;
      const { text, prefix } = getCallRenderParts(state, theme, toolCtx);

      const renderArgs = args as ReadToolInput;
      const classification = getCompactReadClassification(
        renderArgs,
        toolCtx.cwd,
      );
      const title = theme.fg("toolTitle", theme.bold("Read "));
      const lineRange = formatReadLineRange(renderArgs, theme);
      const fullPath = renderPath(renderArgs.path, theme, toolCtx.cwd);
      const fullText = prefix + title + fullPath + lineRange;

      let collapsedText: string;
      let compactIsLossy = classification !== undefined;
      if (classification) {
        collapsedText =
          prefix +
          formatCompactReadCall(
            classification,
            renderArgs,
            theme,
            Math.max(1, getMaxCallWidth() - visibleWidth(prefix)),
          );
      } else {
        const pathWidth = Math.max(
          1,
          getMaxCallWidth() - visibleWidth(prefix + title + lineRange),
        );
        collapsedText =
          prefix +
          title +
          renderPath(renderArgs.path, theme, toolCtx.cwd, pathWidth) +
          lineRange;
        compactIsLossy ||= visibleWidth(fullPath) > pathWidth;
      }

      setExpandableCallText(text, state, {
        expanded: toolCtx.expanded,
        collapsedText,
        fullText,
        compactIsLossy,
        ellipsis: theme.fg("accent", "..."),
      });
      return text;
    },
    renderResult: buildRenderResult(formatReadResult),
  });
}
