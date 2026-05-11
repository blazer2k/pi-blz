import { extractText, getDocumentProxy } from "unpdf";
import {
  MAX_PDF_BYTES,
  MAX_MARKDOWN_CHARS,
  type ExtractResponse,
  formatBytes,
  truncateContent,
} from "./shared";

export async function extractPdf(
  sourceUrl: string,
  contentType: string,
  res: Response,
): Promise<ExtractResponse> {
  const contentLength = Number(res.headers.get("content-length") ?? "0");

  if (contentLength > MAX_PDF_BYTES) {
    throw new Error(`PDF too large: ${formatBytes(contentLength)}`);
  }

  const buffer = await res.arrayBuffer();

  if (buffer.byteLength > MAX_PDF_BYTES) {
    throw new Error(
      `PDF too large after download: ${formatBytes(buffer.byteLength)}`,
    );
  }

  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { totalPages, text } = await extractText(pdf, { mergePages: true });

  const body = Array.isArray(text) ? text.join("\n\n") : text;

  const content = [
    `Source URL: ${sourceUrl}`,
    `Content-Type: ${contentType}`,
    `Pages: ${totalPages}`,
    "",
    "---",
    "",
    body.trim(),
  ].join("\n");

  return {
    sourceUrl,
    contentType,
    byteLength: buffer.byteLength,
    content: [
      {
        type: "text",
        text: truncateContent(content, MAX_MARKDOWN_CHARS, "verbose"),
      },
    ],
  };
}
