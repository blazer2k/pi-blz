import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import {
  type ExtractResponse,
  MAX_HTML_BYTES,
  MAX_HTML_CHARS,
  MAX_MARKDOWN_CHARS,
  formatBytes,
  truncateContent,
} from "./shared";
import { absolutizeUrls } from "../helpers/url";

const turndown = new TurndownService({
  headingStyle: "atx",
  hr: "---",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
});

export function denoiseBody(body: Element) {
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

export function buildMetaString(document: Document): string {
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

export function getMarkdownFromHTML(html: Element["innerHTML"]): string {
  return turndown.turndown(html).trimStart();
}

export async function extractHtml(
  sourceUrl: string,
  contentType: string,
  res: Response,
): Promise<ExtractResponse> {
  const contentLength = Number(res.headers.get("content-length") ?? "0");
  if (contentLength > MAX_HTML_BYTES) {
    throw new Error(`Content too large: ${formatBytes(contentLength)}`);
  }

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
  absolutizeUrls(body, sourceUrl);

  const metaString = buildMetaString(document);
  const markdown = getMarkdownFromHTML(body.innerHTML ?? "");

  const content = [
    `Source URL: ${sourceUrl}`,
    `Content-Type: ${contentType}`,
    "",
    "---",
    "",
    metaString,
    "",
    "---",
    "",
    markdown,
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
