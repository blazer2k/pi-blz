import type { BaseRenderState } from "../rendering/types";

export type BashRenderState = BaseRenderState & {
  callHighlightCache?: {
    source: string;
    expandedCommand: string;
    collapsedCommand: string;
  };
  startedAt?: number;
  durationTimer?: ReturnType<typeof setInterval>;
  durationMs?: number;
  resultExpandable?: boolean;
};
