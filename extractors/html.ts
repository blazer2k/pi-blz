import TurndownService from "turndown";

const MAX_HTML_CHARS = 1_000_000;

const turndown = new TurndownService({
  headingStyle: "atx",
  hr: "---",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
});

export function assertHtmlResponse(res: Response): void {
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
