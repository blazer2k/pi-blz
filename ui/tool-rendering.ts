import type {
  AgentToolResult,
  ToolRenderResultOptions,
  Theme,
} from "@mariozechner/pi-coding-agent";
import { keyHint } from "@mariozechner/pi-coding-agent";

export type ToolStatus = "success" | "aborted" | "error";

interface ToolStatusDetails {
  status: ToolStatus;
  error?: string;
}

export function getToolFailureStatus(
  details: ToolStatusDetails,
  theme: Theme,
): string | null {
  if (details.status === "error") {
    return theme.fg("error", `${details.error || "Unknown error"}`);
  }

  if (details.status === "aborted") {
    return theme.fg("muted", "Aborted");
  }

  return null;
}

export function getApproxTokens(charCount: number): string {
  const rawTokenCount = Math.ceil(charCount / 4);

  const tokenCount =
    rawTokenCount < 1000 ? rawTokenCount : Math.ceil(rawTokenCount / 100) * 100;

  return tokenCount < 1000 ? tokenCount.toString() : `${tokenCount / 1000}k`;
}

export function renderTextResult(
  result: AgentToolResult<unknown>,
  options: ToolRenderResultOptions,
  theme: Theme,
  maxCollapsedLines = 20,
): string {
  const output = result.content.find((c) => c.type === "text")?.text ?? "";
  let text = "";
  if (output) {
    const lines = output.split("\n");
    const maxLines = options.expanded ? lines.length : maxCollapsedLines;
    const displayLines = lines.slice(0, maxLines);
    const remainingLines = lines.length - maxLines;

    text += `\n${displayLines.map((line) => theme.fg("toolOutput", line)).join("\n")}`;

    if (remainingLines > 0) {
      text += `${theme.fg("muted", `\n... (${remainingLines} more lines,`)} ${keyHint("app.tools.expand", "to expand")})`;
    }
  }

  return text;
}
