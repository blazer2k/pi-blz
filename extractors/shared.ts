export const MAX_HTML_CHARS = 1_000_000;
export const MAX_MARKDOWN_CHARS = 100_000;

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
