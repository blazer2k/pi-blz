import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import type { BaseRenderState } from "../rendering/types";

export type CodemodeRenderState = BaseRenderState & {
  resultExpandable?: boolean;
  startedAt?: number;
  endedAt?: number;
  durationTimer?: ReturnType<typeof setInterval>;
  nativeCall?: Component;
  nativeResult?: Component;
  callHighlightCache?: {
    source: string;
    preview: string;
    colors?: Theme["colors"];
  };
};
