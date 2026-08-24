// Native notices emitted by @earendil-works/pi-coding-agent 0.84.3.
// Renderer parsing tests should use these values so an upstream wording change
// fails in one clearly named compatibility boundary.
export const PI_0_84_3_OUTPUT = {
  editor: {
    scrolledTop: "─── ↑ 2 more ─────",
    scrolledBottom: "─── ↓ 3 more ─────",
  },
  read: {
    moreLines: "[5 more lines in file. Use offset=7 to continue.]",
    showingLines: "[Showing lines 1-2 of 10. Use offset=3 to continue.]",
  },
  bash: {
    exited: "Command exited with code 3",
    timedOut: "Command timed out after 1 seconds",
    aborted: "Command aborted",
    showingLines:
      "[Showing lines 6-10 of 10. Full output: /tmp/pi-bash-output.log]",
    fullOutputPath: "/tmp/pi-bash-output.log",
  },
} as const;
