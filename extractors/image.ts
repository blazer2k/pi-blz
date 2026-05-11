import { MAX_IMAGE_BYTES, type ExtractResponse } from "./shared";
import { formatBytes } from "./shared";

const SUPPORTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export async function extractImage(
  sourceUrl: string,
  contentType: string,
  res: Response,
): Promise<ExtractResponse> {
  if (!SUPPORTED_IMAGE_TYPES.has(contentType)) {
    throw new Error(`Unsupported image type: ${contentType}`);
  }

  const contentLength = Number(res.headers.get("content-length") ?? "0");

  if (contentLength > MAX_IMAGE_BYTES) {
    throw new Error(`Image too large: ${formatBytes(contentLength)}`);
  }

  const buffer = await res.arrayBuffer();

  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(
      `Image too large after download: ${formatBytes(buffer.byteLength)}`,
    );
  }

  const base64 = Buffer.from(buffer).toString("base64");

  return {
    sourceUrl,
    contentType,
    byteLength: buffer.byteLength,
    content: [
      {
        type: "text" as const,
        text: [
          `Image extracted from ${sourceUrl}`,
          `Content-Type: ${contentType}`,
          `Size: ${formatBytes(buffer.byteLength, 2)}`,
        ].join("\n"),
      },
      {
        type: "image" as const,
        data: base64,
        mimeType: contentType,
      },
    ],
  };
}
