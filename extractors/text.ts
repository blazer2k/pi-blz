import {
  type ExtractResponse,
  MAX_TEXT_BYTES,
  MAX_TEXT_CHARS,
  MAX_MARKDOWN_CHARS,
  formatBytes,
  truncateContent,
} from "./shared";

export async function extractPlainText(
  sourceUrl: string,
  contentType: string,
  res: Response,
): Promise<ExtractResponse> {
  const contentLength = Number(res.headers.get("content-length") ?? "0");

  if (contentLength > MAX_TEXT_BYTES) {
    throw new Error(`Text content too large: ${formatBytes(contentLength)}`);
  }

  const raw = await res.text();

  if (raw.length > MAX_TEXT_CHARS) {
    throw new Error(
      `Text content too large after download: ${raw.length} characters`,
    );
  }

  const content = [
    `Source URL: ${sourceUrl}`,
    `Content-Type: ${contentType}`,
    "",
    "---",
    "",
    raw.trim(),
  ].join("\n");

  return {
    sourceUrl,
    contentType,
    content: [
      {
        type: "text" as const,
        text: truncateContent(content, MAX_MARKDOWN_CHARS, "verbose"),
      },
    ],
  };
}
