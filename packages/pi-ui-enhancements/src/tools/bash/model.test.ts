import { describe, expect, it } from "bun:test";
import { PI_0_84_3_OUTPUT } from "../test-fixtures/pi-0.84.3";
import {
  buildBashResultView,
  selectBashOutputWindow,
  type BashResultPolicy,
} from "./model";

const policy: BashResultPolicy = {
  collapsedLineLimit: 2,
  errorEllipsis: "...",
};

describe("selectBashOutputWindow", () => {
  it("selects the collapsed tail and records hidden lines", () => {
    const output = selectBashOutputWindow("one\ntwo\nthree", false, 2);

    expect(output).toEqual({
      collapsedText: "two\nthree",
      visibleText: "two\nthree",
      totalLines: 3,
      collapsedRemainingLines: 1,
      visibleLines: 2,
      remainingLines: 1,
      hiddenLines: 1,
    });
  });

  it("selects all output when expanded while retaining collapsed metadata", () => {
    const output = selectBashOutputWindow("one\ntwo\nthree", true, 2);

    expect(output.visibleText).toBe("one\ntwo\nthree");
    expect(output.visibleLines).toBe(3);
    expect(output.remainingLines).toBe(0);
    expect(output.hiddenLines).toBe(0);
    expect(output.collapsedRemainingLines).toBe(1);
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
    expect(view.output.visibleText).toBe("two\nthree");
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
