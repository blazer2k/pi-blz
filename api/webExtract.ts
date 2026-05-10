import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { createTimeoutSignal } from "../helpers/abort";

const MAX_HTML_CHARS = 1_000_000;
const MAX_MARKDOWN_CHARS = 100_000;

const turndown = new TurndownService({
  headingStyle: "atx",
  hr: "---",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
});

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

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();

  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    host.startsWith("169.254.")
  );
}

function getValidUrl(value: string, allowPrivateUrls: boolean): string | null {
  try {
    const url = new URL(value.trim());

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    if (!allowPrivateUrls && isPrivateHostname(url.hostname)) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

function assertHtmlResponse(res: Response): void {
  const contentType = res.headers.get("content-type") ?? "";

  if (
    !contentType.includes("text/html") &&
    !contentType.includes("application/xhtml+xml")
  ) {
    throw new Error(`Unsupported content type: ${contentType || "unknown"}`);
  }

  const contentLength = Number(res.headers.get("content-length") ?? "0");
  if (contentLength > MAX_HTML_CHARS) {
    throw new Error(`Response too large: ${contentLength} bytes`);
  }
}

function denoiseBody(body: Element) {
  body
    .querySelectorAll(
      `
    nav, header, footer,
    [role="navigation"], [role="banner"], [role="contentinfo"],
    .breadcrumb, .breadcrumbs,
    .webring, .related-posts, .post-navigation,
    .sidebar, .aside,
    .cookie-banner, .cookie-notice,
    .share-buttons, .social-share,
    .comments, #comments,
    .newsletter, .subscribe,
    script, style, noscript, svg, iframe, link, meta
  `,
    )
    .forEach((el) => el.remove());
}

function absolutizeUrls(body: Element, baseUrl: string) {
  body.querySelectorAll("a[href], img[src]").forEach((el) => {
    for (const attr of ["href", "src"] as const) {
      const value = el.getAttribute(attr);
      if (value && !value.startsWith("http") && !value.startsWith("data:")) {
        el.setAttribute(attr, new URL(value, baseUrl).toString());
      } else {
        el.removeAttribute(attr);
      }
    }
  });
}

function buildMetaString(document: Document): string {
  const meta = (name: string): string =>
    document
      .querySelector(`meta[name="${name}"], meta[property="${name}"]`)
      ?.getAttribute("content") ?? "";

  const title = document.title || meta("og:title") || "Untitled";
  const author = meta("author") || meta("article:author") || "";
  const date =
    meta("article:published_time") ||
    meta("og:published_time") ||
    meta("date") ||
    "";
  const description = meta("description") || meta("og:description") || "";

  const metaString = [
    `Title: ${title}`,
    author ? `Author: ${author}` : null,
    date ? `Published: ${date}` : null,
    description ? `Description: ${description}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return metaString;
}

function getMarkdownFromHTML(html: Element["innerHTML"]): string {
  return turndown.turndown(html).trimStart();
}

function truncateContent(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;

  return `${content.slice(0, maxChars)}\n\n[Content truncated at ${maxChars} characters]`;
}

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

    const metaString = buildMetaString(document);

    denoiseBody(body);
    absolutizeUrls(body, validatedUrl);

    const markdown = getMarkdownFromHTML(body.innerHTML ?? "");

    const content = `${metaString}\n\n---\n\n${markdown}`;

    return {
      sourceUrl: validatedUrl,
      content: truncateContent(content, MAX_MARKDOWN_CHARS),
    };
  } finally {
    timeout.cleanup();
  }
}
