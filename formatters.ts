import { type SearchResponse } from "./search";
import type {
  AgentToolResult,
  ToolRenderResultOptions,
  Theme,
} from "@mariozechner/pi-coding-agent";
import { keyHint } from "@mariozechner/pi-coding-agent";

export function formatSearchResults(response: SearchResponse): string {
  const results = response.results;

  const resultsString =
    results.length === 0
      ? "No results found."
      : results
          .map(
            (r, i) =>
              `## **${i + 1}.** ${r.title}\n**URL:** ${r.url}\n${r.content}`,
          )
          .join("\n\n---\n\n");

  return resultsString;
}

export function formatRenderResult(
  result: AgentToolResult<{
    query: string;
    resultCount: number;
  }>,
  options: ToolRenderResultOptions,
  theme: Theme,
  verbose: boolean,
): string {
  let text = "";

  if (!verbose) {
    const resultsCount = result.details.resultCount || 0;

    text += `${theme.fg("dim", `${resultsCount} results`)}`;
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
