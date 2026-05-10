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
