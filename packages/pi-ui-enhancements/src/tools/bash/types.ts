import type { BashToolDetails } from "@earendil-works/pi-coding-agent";
import type { BaseRenderState } from "../rendering/types";

export type BashRenderState = BaseRenderState & {
  callHighlightCache?: {
    source: string;
    expandedCommand: string;
    collapsedCommand: string;
  };
  startedAt?: number;
  endedAt?: number;
  durationTimer?: ReturnType<typeof setInterval>;
  durationMs?: number;
  resultExpandable?: boolean;
};

export type BashDetailsWithTiming = BashToolDetails & {
  durationMs?: number;
};
