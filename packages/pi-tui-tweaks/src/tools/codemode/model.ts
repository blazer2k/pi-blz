import type { CodemodeToolDetails } from "@earendil-works/pi-coding-agent";
import { sanitizeRenderedText } from "../custom-tools/display";
import { stripAnsi } from "../rendering/text";
import type { ToolTextResult } from "../rendering/types";

const SCRIPT_HEADER =
  /^Script (completed|failed)\nWall time (\d+(?:\.\d+)?) seconds\nOutput:\n$/;

export function buildCodemodeResultView(result: ToolTextResult) {
  const details = result.details as Partial<CodemodeToolDetails> | undefined;
  const first = result.content[0];
  const header =
    first?.type === "text" ? first.text?.match(SCRIPT_HEADER) : undefined;
  const blocks = (header ? result.content.slice(1) : result.content)
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text!);
  let truncated = Boolean(details?.fullOutputPath);
  let spillWarning: string | undefined;
  if (header) {
    for (let index = 0; index < blocks.length; index++) {
      const block = blocks[index]!;
      const preamble = block.match(
        /^Warning: truncated output \(original token count: \d+\)\nTotal output lines: \d+\n\n/,
      );
      if (!preamble) continue;
      const link = details?.fullOutputPath
        ? `\n\n[Full output: ${details.fullOutputPath} (read with offset/limit)]`
        : undefined;
      const failure = block.match(
        /\n\n\[Could not save the full output: ([\s\S]*)\]$/,
      );
      const suffix = link && block.endsWith(link) ? link : failure?.[0];
      if (!suffix) continue;
      truncated = true;
      if (failure)
        spillWarning = sanitizeRenderedText(
          `Could not save the full output: ${failure[1]}`,
        );
      blocks[index] = block.slice(preamble[0].length, -suffix.length);
    }
  }
  const output = blocks
    .join("\n")
    .split("\n")
    .map(sanitizeRenderedText)
    .join("\n");
  const errorStart = output.lastIndexOf("Script error:\n");
  const diagnostic =
    (errorStart < 0 ? output : output.slice(errorStart))
      .split("\n")
      .map(sanitizeRenderedText)
      .find(
        (line) =>
          stripAnsi(line).trim() && stripAnsi(line).trim() !== "Script error:",
      ) ?? "Script failed";
  return {
    calls: details?.calls ?? [],
    output,
    diagnostic,
    durationMs: header ? Number(header[2]) * 1000 : undefined,
    fullOutputPath: details?.fullOutputPath,
    images: result.content.filter((block) => block.type === "image").length,
    truncated,
    spillWarning,
  };
}
