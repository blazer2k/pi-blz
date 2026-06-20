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
  ExtensionContext,
  ToolRenderResultOptions,
  ReadToolDetails,
  Theme,
  ReadToolInput,
} from "@earendil-works/pi-coding-agent";
import { createReadTool } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Handle } from "../types";
import { TOOL_PROMPTS } from "./tool-prompts";
import { registerPatchedTool } from "./tool-registration";
import {
  type BaseRenderState,
  MAX_CALL_WIDTH,
  buildRenderResult,
  countLines,
  extractTextContent,
  formatSimpleErrorResult,
  getCallRenderParts,
  getResultSymbolColor,
  renderPath,
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
  return theme.fg("warning", `:${startLine}${endLine ? `-${endLine}` : ""}`);
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
  const details = result.details as ReadToolDetails | undefined;
  const hasImage = result.content.some((c) => c.type === "image");
  const textContent = extractTextContent(result);

  if (state.isError) {
    return formatSimpleErrorResult(textContent, state, options, theme);
  }

  const parts: string[] = [];
  if (textContent && !hasImage) {
    const lines = countLines(textContent);
    parts.push(`${lines} ${lines === 1 ? "line" : "lines"}`);
  }
  if (hasImage) {
    const match = textContent.match(/original\s+(\d+)x(\d+)/);
    if (match) {
      parts.push(`Image (${match[1]}x${match[2]})`);
    } else {
      parts.push("Image");
    }
  }
  const summary = parts.length > 0 ? parts.join(", ") : "no content";
  const truncation = details?.truncation?.truncated
    ? theme.fg("warning", "truncated")
    : undefined;
  const output = truncation
    ? theme.fg("toolOutput", summary) +
      theme.fg("toolOutput", ", ") +
      truncation
    : theme.fg("toolOutput", summary);

  return theme.fg(getResultSymbolColor(state), "└─ ") + output;
}

export function patchReadTool(pi: ExtensionAPI, ctx: ExtensionContext): Handle {
  const tool = createReadTool(ctx.cwd);

  return registerPatchedTool({
    pi,
    tool,
    name: "read",
    label: "read",
    promptSnippet: TOOL_PROMPTS.read.promptSnippet,
    promptGuidelines: [...TOOL_PROMPTS.read.promptGuidelines],
    renderCall(args, theme, toolCtx) {
      const state = toolCtx.state as BaseRenderState;
      const { text, prefix } = getCallRenderParts(state, theme, toolCtx);

      let content = prefix;

      const renderArgs = args as ReadToolInput;

      const classification = getCompactReadClassification(
        renderArgs,
        toolCtx.cwd,
      );

      if (classification) {
        content += formatCompactReadCall(
          classification,
          renderArgs,
          theme,
          Math.max(1, MAX_CALL_WIDTH - visibleWidth(content)),
        );
      } else {
        const title = theme.fg("toolTitle", theme.bold("Read "));
        const lineRange = formatReadLineRange(renderArgs, theme);
        const pathWidth = Math.max(
          1,
          MAX_CALL_WIDTH - visibleWidth(content + title + lineRange),
        );
        const pathDisplay = renderPath(
          renderArgs.path,
          theme,
          toolCtx.cwd,
          pathWidth,
        );

        content += title;
        content += pathDisplay;
        content += lineRange;
      }

      text.setText(
        truncateToWidth(content, MAX_CALL_WIDTH, theme.fg("accent", "...")),
      );
      return text;
    },
    renderResult: buildRenderResult(formatReadResult),
  });
}
