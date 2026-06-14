import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { setupWorkingIndicator } from "./working-indicator";

export default function (pi: ExtensionAPI) {
  setupWorkingIndicator(pi);
}
