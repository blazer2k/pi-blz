import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Personality } from "./loader";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import {
  Container,
  type SelectItem,
  SelectList,
  Text,
  Spacer,
} from "@earendil-works/pi-tui";

export async function showSelector(
  ctx: ExtensionContext,
  personalities: Map<string, Personality>,
  active: string | undefined,
): Promise<string | undefined> {
  if (!personalities || personalities.size === 0) {
    ctx.ui.notify("No personalities loaded", "warning");
    return;
  }

  const items: SelectItem[] = [...personalities.values()].map((p) => ({
    value: p.name.toLowerCase(),
    label: active === p.name.toLowerCase() ? `${p.name} (current)` : p.name,
    description: p.description,
  }));

  return new Promise<string | undefined>((resolve) => {
    ctx.ui.custom((_tui, theme, _kb, done) => {
      const container = new Container();
      container.addChild(new DynamicBorder());
      container.addChild(new Spacer(1));
      container.addChild(
        new Text(theme.fg("accent", theme.bold("Select Personality")), 0, 0),
      );
      container.addChild(
        new Text(theme.fg("dim", "Choose a communication style for pi"), 0, 0),
      );
      container.addChild(new Spacer(1));

      const selectList = new SelectList(items, Math.min(items.length, 10), {
        selectedPrefix: (t) => theme.fg("accent", t),
        selectedText: (t) => theme.fg("accent", t),
        description: (t) => theme.fg("muted", t),
        scrollInfo: (t) => theme.fg("dim", t),
        noMatch: (t) => theme.fg("warning", t),
      });

      const activeIdx = items.findIndex((i) => i.value === active);
      if (activeIdx > 0) selectList.setSelectedIndex(activeIdx);

      selectList.onSelect = (item) => {
        resolve(item.value);
        done(undefined);
      };
      selectList.onCancel = () => {
        resolve(undefined);
        done(undefined);
      };

      container.addChild(selectList);
      container.addChild(new Spacer(1));
      container.addChild(new DynamicBorder());

      return {
        render: (w) => container.render(w),
        handleInput: (data) => {
          selectList.handleInput(data);
        },
        invalidate: () => container.invalidate(),
      };
    });
  });
}
