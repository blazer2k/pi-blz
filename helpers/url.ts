export function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();

  return (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host.startsWith("10.") ||
    host.startsWith("127.") ||
    host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    host.startsWith("169.254.")
  );
}

export function getValidUrl(
  value: string,
  allowPrivateUrls: boolean,
): string | null {
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

export function absolutizeUrls(body: Element, baseUrl: string) {
  body.querySelectorAll("a[href], img[src]").forEach((el) => {
    for (const attr of ["href", "src"] as const) {
      const value = el.getAttribute(attr);

      if (!value || value.startsWith("data:")) {
        continue;
      }

      try {
        el.setAttribute(attr, new URL(value, baseUrl).toString());
      } catch {
        el.removeAttribute(attr);
      }
    }
  });
}
