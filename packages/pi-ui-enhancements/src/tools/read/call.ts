import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import {
  getPackageDir,
  type ReadToolInput,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  truncateToWidth,
  visibleWidth,
  type Text,
} from "@earendil-works/pi-tui";
import {
  type BaseRenderState,
  getCallRenderParts,
  getMaxCallWidth,
  renderPath,
  setExpandableCallText,
} from "../tool-rendering";

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

type ReadCallContext = {
  state: unknown;
  cwd: string;
  expanded: boolean;
  executionStarted?: boolean;
  isPartial?: boolean;
  invalidate: () => void;
};

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
  args: ReadToolInput,
  cwd: string,
): CompactReadClassification | undefined {
  if (!args.path) return undefined;

  const absolutePath = resolveToCwd(args.path, cwd);
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

function formatReadLineRange(args: ReadToolInput, theme: Theme): string {
  if (args.offset === undefined && args.limit === undefined) return "";
  const startLine = args.offset ?? 1;
  const endLine = args.limit !== undefined ? startLine + args.limit - 1 : "";
  return theme.fg("dim", `:${startLine}${endLine ? `-${endLine}` : ""}`);
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

export function renderReadCall(
  args: ReadToolInput,
  theme: Theme,
  toolContext: ReadCallContext,
): Text {
  const state = toolContext.state as BaseRenderState;
  const { text, prefix } = getCallRenderParts(state, theme, toolContext);
  const classification = getCompactReadClassification(args, toolContext.cwd);
  const title = theme.fg("toolTitle", theme.bold("Read "));
  const lineRange = formatReadLineRange(args, theme);
  const fullPath = renderPath(args.path, theme, toolContext.cwd);
  const fullText = prefix + title + fullPath + lineRange;

  let collapsedText: string;
  let compactIsLossy = classification !== undefined;
  if (classification) {
    collapsedText =
      prefix +
      formatCompactReadCall(
        classification,
        args,
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
      renderPath(args.path, theme, toolContext.cwd, pathWidth) +
      lineRange;
    compactIsLossy ||= visibleWidth(fullPath) > pathWidth;
  }

  setExpandableCallText(text, state, {
    expanded: toolContext.expanded,
    collapsedText,
    fullText,
    compactIsLossy,
    ellipsis: theme.fg("accent", "..."),
  });
  return text;
}
