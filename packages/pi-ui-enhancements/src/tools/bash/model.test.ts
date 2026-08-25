import { describe, expect, it } from "bun:test";
import { PI_0_84_3_OUTPUT } from "../test-fixtures/pi-0.84.3";
import {
  buildBashResultView,
  selectBashOutputWindow,
  type BashResultPolicy,
} from "./model";

const policy: BashResultPolicy = {
  collapsedDisplay: "preview",
  errorEllipsis: "...",
};

describe("selectBashOutputWindow", () => {
  it("shows every line when preview output has five lines or fewer", () => {
    const output = selectBashOutputWindow("one\ntwo\nthree", "preview");

    expect(output.previewHeadLines).toEqual(["one", "two", "three"]);
    expect(output.previewTailLines).toEqual([]);
    expect(output.hiddenLines).toBe(0);
  });

  it("uses two head and two tail lines beyond the preview limit", () => {
    const output = selectBashOutputWindow(
      "one\ntwo\nthree\nfour\nfive\nsix\nseven",
      "preview",
    );

    expect(output.previewHeadLines).toEqual(["one", "two"]);
    expect(output.previewTailLines).toEqual(["six", "seven"]);
    expect(output.hiddenLines).toBe(3);
  });

  it("preserves blank lines selected at preview boundaries", () => {
    const output = selectBashOutputWindow(
      "one\n\nthree\nfour\nfive\nsix\nseven",
      "preview",
    );

    expect(output.previewHeadLines).toEqual(["one", ""]);
    expect(output.previewTailLines).toEqual(["six", "seven"]);
    expect(output.hiddenLines).toBe(3);
  });

  it("hides all nonempty output in summary mode", () => {
    const output = selectBashOutputWindow("one\ntwo\nthree", "summary");

    expect(output.previewHeadLines).toEqual([]);
    expect(output.previewTailLines).toEqual([]);
    expect(output.hiddenLines).toBe(3);
  });
});

describe("buildBashResultView", () => {
  it("builds a successful output view", () => {
    const view = buildBashResultView(
      { content: [{ type: "text", text: "one\ntwo\nthree" }] },
      {},
      { expanded: false, isPartial: false },
      policy,
    );

    expect(view.kind).toBe("success");
    if (view.kind !== "success") throw new Error("expected success view");
    expect(view.output.fullText).toBe("one\ntwo\nthree");
  });

  it("separates recognized command failures from unknown errors", () => {
    const commandError = buildBashResultView(
      {
        content: [
          {
            type: "text",
            text: `output\n${PI_0_84_3_OUTPUT.bash.exited}`,
          },
        ],
      },
      { isError: true },
      { expanded: false, isPartial: false },
      policy,
    );
    const unknownError = buildBashResultView(
      { content: [{ type: "text", text: "unexpected failure" }] },
      { isError: true },
      { expanded: false, isPartial: false },
      policy,
    );

    expect(commandError.kind).toBe("command-error");
    expect(unknownError.kind).toBe("unknown-error");
  });
});
