export type ExtractKind = "html" | "text" | "pdf" | "image";

export function createTimeoutSignal(
  timeoutMs: number,
  parentSignal?: AbortSignal,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(
    () =>
      controller.abort(
        new DOMException(`Timed out after ${timeoutMs}ms`, "TimeoutError"),
      ),
    timeoutMs,
  );

  const signal = parentSignal
    ? AbortSignal.any([parentSignal, controller.signal])
    : controller.signal;

  return {
    signal,
    cleanup: () => clearTimeout(timer),
  };
}

export function getContentType(res: Response): string {
  const header = res.headers.get("content-type") ?? "";
  return header.split(";")[0]?.trim().toLowerCase() ?? "";
}

export function getExtractKind(contentType: string): ExtractKind | null {
  if (contentType === "text/html" || contentType === "application/xhtml+xml") {
    return "html";
  }

  if (contentType.startsWith("text/")) {
    return "text";
  }

  if (contentType.startsWith("image/")) {
    return "image";
  }

  if (contentType === "application/pdf") {
    return "pdf";
  }

  return null;
}
