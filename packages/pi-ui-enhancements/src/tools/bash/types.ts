import {
  type BashToolDetails,
  type BashToolInput as NativeBashToolInput,
} from "@earendil-works/pi-coding-agent";
import type { BaseRenderState } from "../rendering/types";

export type BashToolInput = NativeBashToolInput;

export type BashRenderState = BaseRenderState & {
  startedAt?: number;
  endedAt?: number;
  durationTimer?: ReturnType<typeof setInterval>;
  durationMs?: number;
};

export type BashDetailsWithTiming = BashToolDetails & {
  durationMs?: number;
};

export type BashResult = {
  content: Array<{ type: string; text?: string }>;
  details?: unknown;
};
