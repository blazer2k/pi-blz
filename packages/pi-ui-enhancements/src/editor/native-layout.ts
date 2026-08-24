export type ScrollIndicators = {
  hiddenAbove: boolean;
  hiddenBelow: boolean;
  contentLineCount: number;
};

export type NativeEditorLayout = {
  compatible: boolean;
  lines: string[];
  scroll: ScrollIndicators | null;
};

type NativeBorder = {
  scrollDirection: "up" | "down" | null;
};

const SGR_SEQUENCE = /\x1b\[[0-9;]*m/g;

function parseNativeBorder(line: string | undefined): NativeBorder | undefined {
  if (line === undefined) return undefined;
  const plain = line.replace(SGR_SEQUENCE, "");

  if (/^─+$/.test(plain)) return { scrollDirection: null };
  if (/^─── ↑/.test(plain)) return { scrollDirection: "up" };
  if (/^─── ↓/.test(plain)) return { scrollDirection: "down" };
  return undefined;
}

/**
 * Adapts Pi's native editor output into content plus scroll metadata.
 * Autocomplete rows may follow the bottom border, so the border is located
 * from the end instead of assuming it is the final rendered row.
 */
export function adaptNativeEditorLayout(
  nativeLines: readonly string[],
): NativeEditorLayout {
  const lines = [...nativeLines];
  const topBorder = parseNativeBorder(lines[0]);
  if (!topBorder) return { compatible: false, lines, scroll: null };

  for (let index = lines.length - 1; index > 0; index--) {
    const bottomBorder = parseNativeBorder(lines[index]);
    if (!bottomBorder) continue;

    lines.splice(index, 1);
    const scroll = {
      hiddenAbove: topBorder.scrollDirection === "up",
      hiddenBelow: bottomBorder.scrollDirection === "down",
      contentLineCount: index - 1,
    };
    return {
      compatible: true,
      lines,
      scroll: scroll.hiddenAbove || scroll.hiddenBelow ? scroll : null,
    };
  }

  return { compatible: false, lines: [...nativeLines], scroll: null };
}
