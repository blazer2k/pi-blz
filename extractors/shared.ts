export const MAX_TEXT_BYTES = 1_000_000;
export const MAX_TEXT_CHARS = 500_000;
export const MAX_HTML_BYTES = 2_000_000;
export const MAX_HTML_CHARS = 1_000_000;
export const MAX_MARKDOWN_CHARS = 100_000;
export const MAX_PDF_BYTES = 50 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 50 * 1024 * 1024;

export type ExtractContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export interface ExtractResponse {
  sourceUrl: string;
  contentType: string;
  byteLength?: number;
  content: ExtractContent[];
}

export function truncateContent(
  content: string,
  maxChars: number,
  displayString: "..." | "verbose" = "...",
): string {
  if (content.length <= maxChars) return content;

  const display =
    displayString === "verbose"
      ? `\n\n[Content truncated at ${maxChars} characters]`
      : "...";

  return `${content.slice(0, maxChars)}${display}`;
}

export function getExtractTextLength(
  content: Array<{ type: string; text?: string }>,
): number {
  return content.reduce((sum, item) => {
    if (item.type !== "text") return sum;
    return sum + (item.text?.length ?? 0);
  }, 0);
}

export function formatBytes(bytes: number, decimals = 1): string {
  if (!Number.isFinite(bytes)) {
    throw new Error("Bytes must be a finite number");
  }

  const sign = bytes < 0 ? "-" : "";
  const value = Math.abs(bytes);

  if (value < 1000) {
    return `${sign}${value} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let size = value / 1000;
  let unitIndex = 0;

  while (size >= 1000 && unitIndex < units.length - 1) {
    size /= 1000;
    unitIndex++;
  }

  return `${sign}${size.toFixed(decimals).replace(/\.?0+$/, "")} ${units[unitIndex]}`;
}
