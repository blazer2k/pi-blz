import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { getCapabilities, hyperlink } from "@earendil-works/pi-tui";
import { getMaxCallWidth } from "../rendering/state";
import { safeTruncateToWidth, sanitizeDisplayText } from "../rendering/text";

const MIN_LINK_PREFIX_LENGTH = 24;

export function sanitizeRenderedText(value: string): string {
  let output = "";
  let index = 0;

  while (index < value.length) {
    const char = value[index];

    if (char === "\u001B") {
      if (value[index + 1] === "[") {
        let end = index + 2;
        while (end < value.length && !/[\x40-\x7E]/.test(value[end]!)) end++;
        if (end < value.length) {
          const sequence = value.slice(index, end + 1);
          const body = sequence.slice(2, -1);
          if (sequence.endsWith("m") && /^[\d;:]*$/.test(body)) {
            output += sequence;
          }
          index = end + 1;
          continue;
        }
      }

      if (value[index + 1] === "]" || value[index + 1] === "_") {
        const belEnd = value.indexOf("\u0007", index + 2);
        const stEnd = value.indexOf("\u001B\\", index + 2);
        const usesBel = belEnd !== -1 && (stEnd === -1 || belEnd < stEnd);
        const end = usesBel ? belEnd : stEnd;
        index = end === -1 ? value.length : end + (usesBel ? 1 : 2);
        continue;
      }

      index++;
      continue;
    }

    const code = char?.codePointAt(0);
    if (
      code !== undefined &&
      (code === 0x09 || code === 0x0a || code === 0x0d || code > 0x1f) &&
      (code < 0xfff9 || code > 0xfffb)
    ) {
      output += char;
    }
    index++;
  }

  return output.replace(/\r/g, "").replace(/[\n\t]+/g, " ");
}

function getEscapeSequenceEnd(text: string, start: number): number {
  const next = text[start + 1];

  if (next === "[") {
    for (let index = start + 2; index < text.length; index++) {
      if (/[\x40-\x7E]/.test(text[index]!)) return index;
    }
    return start;
  }

  if (next === "]" || next === "_") {
    const belEnd = text.indexOf("\u0007", start + 2);
    const stEnd = text.indexOf("\u001B\\", start + 2);
    if (belEnd === -1 && stEnd === -1) return start;
    if (belEnd !== -1 && (stEnd === -1 || belEnd < stEnd)) return belEnd;
    return stEnd + 1;
  }

  return start;
}

export function capitalizeFirstVisibleChar(text: string): string {
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;

    if (char === "\u001B") {
      index = getEscapeSequenceEnd(text, index);
      continue;
    }

    if (/\s/.test(char)) continue;

    const upper = char.toUpperCase();
    if (upper !== char) {
      return text.slice(0, index) + upper + text.slice(index + char.length);
    }
    break;
  }
  return text;
}

export function buildGenericCallHeader(
  args: Record<string, unknown>,
  label: string,
  theme: Theme,
): string {
  const parts: string[] = [];

  for (const [key, value] of Object.entries(args ?? {})) {
    if (value == null) continue;
    if (typeof value === "string" && value.length > 80) continue;
    if (typeof value === "object") continue;
    parts.push(
      `${sanitizeDisplayText(key)}=${sanitizeDisplayText(JSON.stringify(value))}`,
    );
  }

  const preview = parts.slice(0, 3).join(" ");
  const raw =
    theme.fg("toolTitle", theme.bold(label)) +
    (preview ? ` ${theme.fg("accent", preview)}` : "");

  return safeTruncateToWidth(raw, getMaxCallWidth(), theme.fg("accent", "..."));
}

type LinkTarget = {
  display: string;
  url: string;
};

function collectStringValues(
  value: unknown,
  output: Set<string>,
  depth = 0,
): void {
  if (depth > 5 || value == null) return;

  if (typeof value === "string") {
    output.add(value);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectStringValues(item, output, depth + 1);
    return;
  }

  if (typeof value === "object") {
    for (const item of Object.values(value)) {
      collectStringValues(item, output, depth + 1);
    }
  }
}

function getUrlTarget(value: string): string | undefined {
  try {
    const url = new URL(value);
    return ["http:", "https:", "file:"].includes(url.protocol)
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

function getPathTarget(value: string, cwd: string): string | undefined {
  if (/\s/.test(value)) return undefined;

  const expanded = value.startsWith("~/")
    ? resolve(homedir(), value.slice(2))
    : value;

  if (isAbsolute(expanded)) return pathToFileURL(expanded).href;
  if (value.startsWith("./") || value.startsWith("../")) {
    return pathToFileURL(resolve(cwd, value)).href;
  }

  return undefined;
}

function getLinkTargets(args: unknown, cwd: string): LinkTarget[] {
  const values = new Set<string>();
  collectStringValues(args, values);

  return [...values]
    .map((display) => {
      const url = getUrlTarget(display) ?? getPathTarget(display, cwd);
      return url ? { display, url } : undefined;
    })
    .filter((target): target is LinkTarget => target !== undefined)
    .sort((a, b) => b.display.length - a.display.length);
}

function getLongestVisibleTargetPrefix(
  text: string,
  target: LinkTarget,
): string | undefined {
  const maxLength = Math.min(target.display.length, text.length);

  for (let length = maxLength; length >= MIN_LINK_PREFIX_LENGTH; length--) {
    const prefix = target.display.slice(0, length);
    if (text.includes(prefix)) return prefix;
  }

  return undefined;
}

type LinkReplacement = LinkTarget & {
  start: number;
  end: number;
};

function overlapsExistingReplacement(
  replacements: LinkReplacement[],
  start: number,
  end: number,
): boolean {
  return replacements.some(
    (replacement) => start < replacement.end && end > replacement.start,
  );
}

export function applyArgumentHyperlinks(
  text: string,
  args: unknown,
  cwd: string,
): string {
  if (!getCapabilities().hyperlinks || text.includes("\u001B]8;")) return text;

  const replacements: LinkReplacement[] = [];

  for (const target of getLinkTargets(args, cwd)) {
    const display = text.includes(target.display)
      ? target.display
      : getLongestVisibleTargetPrefix(text, target);

    if (!display) continue;

    const start = text.indexOf(display);
    const end = start + display.length;
    if (start === -1 || overlapsExistingReplacement(replacements, start, end)) {
      continue;
    }

    replacements.push({ start, end, display, url: target.url });
  }

  if (replacements.length === 0) return text;
  replacements.sort((a, b) => a.start - b.start);

  let linked = "";
  let cursor = 0;
  for (const replacement of replacements) {
    linked += text.slice(cursor, replacement.start);
    linked += hyperlink(replacement.display, replacement.url);
    cursor = replacement.end;
  }
  return linked + text.slice(cursor);
}
