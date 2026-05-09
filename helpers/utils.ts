export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

export function getApproxTokens(charCount: number): string {
  const rawTokenCount = Math.ceil(charCount / 4);

  const tokenCount =
    rawTokenCount < 1000 ? rawTokenCount : Math.ceil(rawTokenCount / 100) * 100;

  return tokenCount < 1000 ? tokenCount.toString() : `${tokenCount / 1000}k`;
}
