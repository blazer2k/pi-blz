import { type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { loadConfig } from "./helpers/config";
import { registerSearchTool } from "./tools/searchTool";
import { registerExtractTool } from "./tools/extractTool";
import { registerConfigCommand } from "./tools/configCommand";
import { errorMessage } from "./helpers/error";

export default function (pi: ExtensionAPI) {
  loadConfig();

  pi.on("session_start", (_event, ctx) => {
    loadConfig((err) => {
      ctx.ui.notify(`Config load failed: ${errorMessage(err)}`, "error");
    });
  });

  registerSearchTool(pi);
  registerExtractTool(pi);

  registerConfigCommand(pi);
}
