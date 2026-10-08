import { homedir } from "node:os";
import { sep } from "node:path";
import { describe, expect, it } from "bun:test";
import { shortenPath } from "./path";

describe("shortenPath", () => {
  it("shortens the home directory itself", () => {
    expect(shortenPath(homedir())).toBe("~");
  });

  it("shortens paths inside the home directory", () => {
    const home = homedir();
    expect(shortenPath(`${home}${sep}foo`)).toBe(`~${sep}foo`);
    expect(shortenPath(`${home}${sep}foo${sep}bar.txt`)).toBe(
      `~${sep}foo${sep}bar.txt`,
    );
  });

  it("does not shorten sibling paths that only share the home prefix", () => {
    const home = homedir();
    const sibling = `${home}2${sep}foo`;
    expect(shortenPath(sibling)).toBe(sibling);
  });

  it("does not shorten paths outside the home directory", () => {
    expect(shortenPath("/tmp/foo")).toBe("/tmp/foo");
  });
});
