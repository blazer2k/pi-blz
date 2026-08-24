import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { RoundedEditor } from "./editor/component";
import { formatStatusLine } from "./editor/frame";
import { getTotalUsage } from "./editor/usage";
import type { Handle } from "./types";

export {
  formatStatusLine,
  frameEditorLines,
  getRightBorderGlyph,
  type BorderFn,
  type EditorFrameData,
  type ScrollIndicators,
} from "./editor/frame";
export {
  adaptNativeEditorLayout,
  type NativeEditorLayout,
} from "./editor/native-layout";
export { buildEditorFrameData, type EditorStatusInput } from "./editor/status";
export { formatTokens, getTotalUsage } from "./editor/usage";

type RoundedEditorRuntime = {
  invalidateUsage: (() => void) | null;
};

const runtimes = new WeakMap<ExtensionAPI, RoundedEditorRuntime>();

function getRuntime(pi: ExtensionAPI): RoundedEditorRuntime {
  const existing = runtimes.get(pi);
  if (existing) return existing;

  const runtime: RoundedEditorRuntime = { invalidateUsage: null };
  const invalidateUsage = async () => runtime.invalidateUsage?.();
  pi.on("agent_end", invalidateUsage);
  pi.on("session_compact", invalidateUsage);
  pi.on("session_tree", invalidateUsage);
  runtimes.set(pi, runtime);
  return runtime;
}

export function registerRoundedEditor(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  onReregister: (register: () => void) => void,
): Handle {
  const runtime = getRuntime(pi);
  let getGitBranch: () => string | null = () => null;
  let requestRender: (() => void) | null = null;
  let footerOwned = false;
  let disposed = false;
  let cachedUsage = getTotalUsage(ctx);

  const invalidateUsage = () => {
    cachedUsage = getTotalUsage(ctx);
    requestRender?.();
  };
  runtime.invalidateUsage = invalidateUsage;

  // The editor already displays model, context, cost, cwd, and branch data;
  // keep only extension-owned statuses in the footer.
  ctx.ui.setFooter((tui, theme, footerData) => {
    footerOwned = true;
    requestRender = () => tui.requestRender();
    getGitBranch = () => footerData.getGitBranch();
    const statuses = footerData.getExtensionStatuses();
    const disposeBranchChange = footerData.onBranchChange?.(() =>
      tui.requestRender(),
    );

    return {
      render: (width: number) => formatStatusLine(statuses, width, theme),
      invalidate() {},
      dispose() {
        footerOwned = false;
        disposeBranchChange?.();
      },
    };
  });

  const previousEditorFactory = ctx.ui.getEditorComponent();
  const roundedEditorFactory: NonNullable<
    ReturnType<ExtensionContext["ui"]["getEditorComponent"]>
  > = (tui, theme, keybindings) => {
    requestRender = () => tui.requestRender();
    return new RoundedEditor(
      tui,
      theme,
      keybindings,
      ctx,
      pi,
      () => getGitBranch(),
      () => cachedUsage,
    );
  };

  const applyEditor = () => {
    if (!disposed) ctx.ui.setEditorComponent(roundedEditorFactory);
  };
  applyEditor();
  onReregister(applyEditor);

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      if (runtime.invalidateUsage === invalidateUsage) {
        runtime.invalidateUsage = null;
      }
      requestRender = null;
      if (ctx.ui.getEditorComponent() === roundedEditorFactory) {
        ctx.ui.setEditorComponent(previousEditorFactory);
      }
      if (footerOwned) {
        footerOwned = false;
        ctx.ui.setFooter(undefined);
      }
    },
  };
}
