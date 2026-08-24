import type { Usage } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export type SessionUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalCost: number;
};

export function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  return `${(count / 1000000).toFixed(1)}M`;
}

export function getTotalUsage(ctx: ExtensionContext): SessionUsage {
  const total: SessionUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalCost: 0,
  };

  const add = (usage: Usage | undefined) => {
    if (!usage) return;
    total.inputTokens += usage.input;
    total.outputTokens += usage.output;
    total.cacheReadTokens += usage.cacheRead ?? 0;
    total.cacheWriteTokens += usage.cacheWrite ?? 0;
    total.totalCost += usage.cost?.total ?? 0;
  };

  // Match Pi's native accounting across the whole session, not only the
  // currently active branch.
  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type === "message") {
      if (entry.message.role === "assistant") add(entry.message.usage);
      else if (entry.message.role === "toolResult") add(entry.message.usage);
    } else if (
      (entry.type === "branch_summary" || entry.type === "compaction") &&
      entry.usage
    ) {
      add(entry.usage);
    }
  }

  return total;
}
