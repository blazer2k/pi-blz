import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import type {
  AgentToolResult,
  ToolRenderResultOptions,
  Theme,
} from "@mariozechner/pi-coding-agent";
import { keyHint } from "@mariozechner/pi-coding-agent";

const turndown = new TurndownService({
  headingStyle: "atx",
  hr: "---",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
});

export interface ExtractContentOptions {
  timeoutMs: number;
  signal?: AbortSignal;
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

function getValidUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    return url.toString();
  } catch {
    return null;
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

function absolutizeUrls(body: Element, url: string) {
  body.querySelectorAll("a[href], img[src]").forEach((el) => {
    for (const attr of ["href", "src"] as const) {
      const val = el.getAttribute(attr);
      if (
        val &&
        !val.startsWith("http") &&
        !val.startsWith("//") &&
        !val.startsWith("data:")
      ) {
        el.setAttribute(attr, new URL(val, url).toString());
      }
    }
  });
}

function getMarkdownFromHTML(html: Element["innerHTML"]) {
  let markdown = turndown
    .turndown(html ?? "")
    .replace(/^(?:\d+\s*)+/, "")
    .trimStart();

  return markdown;
}

export async function webExtract(
  url: string,
  options: ExtractContentOptions,
): Promise<string> {
  const validatedUrl = getValidUrl(url);

  if (!validatedUrl) {
    throw new Error(`Invalid URL: ${url}`);
  }

  const timeoutController = new AbortController();
  const timer = setTimeout(() => {
    timeoutController.abort();
  }, options.timeoutMs);

  const signal = options.signal
    ? AbortSignal.any([timeoutController.signal, options.signal])
    : timeoutController.signal;

  try {
    const res = await fetch(validatedUrl, { signal, headers });

    if (!res.ok) {
      throw new Error(`Fetch returned ${res.status} ${res.statusText}`);
    }

    const raw = await res.text();
    const { document } = parseHTML(raw);
    const body = document.body;

    if (!body) throw new Error("Fetch returned empty body");

    const meta = (name: string): string =>
      document
        .querySelector(`meta[name="${name}"], meta[property="${name}"]`)
        ?.getAttribute("content") ?? "";

    const title = document.title || meta("og:title") || "";
    const author = meta("author") || meta("article:author") || "";
    const date =
      meta("article:published_time") ||
      meta("og:published_time") ||
      meta("date") ||
      "";
    const description = meta("description") || meta("og:description") || "";

    const metadata = [
      `Title: ${title}`,
      `URL Source: ${validatedUrl}`,
      author ? `Author: ${author}` : null,
      date ? `Published: ${date}` : null,
      description ? `Description: ${description}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    denoiseBody(body);
    absolutizeUrls(body, validatedUrl);

    const markdown = getMarkdownFromHTML(body.innerHTML ?? "");

    return `${metadata}\n\n---\n\n${markdown}`;
  } finally {
    clearTimeout(timer);
  }
}

export function renderExtractResult(
  result: AgentToolResult<{
    url: string;
  }>,
  options: ToolRenderResultOptions,
  theme: Theme,
  verbose: boolean,
): string {
  let text = "";

  if (!verbose) {
    return text;
  }

  const output = result.content.find((c) => c.type === "text")?.text ?? "";
  if (output) {
    const lines = output.split("\n");
    const maxLines = options.expanded ? lines.length : 20;
    const displayLines = lines.slice(0, maxLines);
    const remainingLines = lines.length - maxLines;

    text += `\n${displayLines.map((line) => theme.fg("toolOutput", line)).join("\n")}`;

    if (remainingLines > 0) {
      text += `${theme.fg("muted", `\n... (${remainingLines} more lines,`)} ${keyHint("app.tools.expand", "to expand")})`;
    }
  }

  return text;
}
