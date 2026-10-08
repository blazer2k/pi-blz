import { getConfig } from "../../config/store";

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

export function formatToolLabel(text: string): string {
  if (!text || !getConfig().tools.capitalizeNames) return text;

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
