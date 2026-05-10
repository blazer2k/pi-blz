import { parseHTML } from "linkedom";
import { createTimeoutSignal } from "../helpers/request";
import { getValidUrl, absolutizeUrls } from "../helpers/url";
import {
  assertHtmlResponse,
  denoiseBody,
  buildMetaString,
  getMarkdownFromHTML,
} from "../extractors/html";
import {
  MAX_HTML_CHARS,
  MAX_MARKDOWN_CHARS,
  truncateContent,
} from "../extractors/shared";

export interface ExtractOptions {
  timeoutMs: number;
  signal?: AbortSignal;
  allowPrivateUrls: boolean;
}

export interface ExtractResponse {
  sourceUrl: string;
  content: string;
}

const headers: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

export async function webExtract(
  url: string,
  options: ExtractOptions,
): Promise<ExtractResponse> {
  const validatedUrl = getValidUrl(url, options.allowPrivateUrls);

  if (!validatedUrl) {
    throw new Error(`Invalid URL: ${url}`);
  }

  const timeout = createTimeoutSignal(options.timeoutMs, options.signal);

  try {
    const res = await fetch(validatedUrl, { signal: timeout.signal, headers });

    if (!res.ok) {
      throw new Error(`Fetch returned ${res.status} ${res.statusText}`);
    }

    assertHtmlResponse(res);

    const raw = await res.text();

    if (raw.length > MAX_HTML_CHARS) {
      throw new Error(
        `Content too large after download: ${raw.length} characters`,
      );
    }

    const { document } = parseHTML(raw);
    const body = document.body;

    if (!body) throw new Error("Fetch returned empty body");

    denoiseBody(body);
    absolutizeUrls(body, validatedUrl);

    const metaString = buildMetaString(document);
    const markdown = getMarkdownFromHTML(body.innerHTML ?? "");

    const content = `${metaString}\n\n---\n\n${markdown}`;

    return {
      sourceUrl: validatedUrl,
      content: truncateContent(content, MAX_MARKDOWN_CHARS, "verbose"),
    };
  } finally {
    timeout.cleanup();
  }
}
