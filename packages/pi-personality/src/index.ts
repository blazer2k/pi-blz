import { type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  loadActive,
  loadPersonalities,
  saveActive,
  type Personality,
} from "./loader";
import { showSelector } from "./ui";

export default function (pi: ExtensionAPI) {
  let personalities: Map<string, Personality>;
  let active: string;

  pi.on("session_start", (_event, _ctx) => {
    personalities = loadPersonalities();
    active = loadActive();
    if (!personalities.has(active)) active = "pragmatic";
  });

  pi.registerCommand("personality", {
    description: "Choose a communication style for pi",
    handler: async (_args, ctx) => {
      const chosen = await showSelector(ctx, personalities, active);
      if (chosen) {
        active = chosen;
        saveActive(active);
        ctx.ui.notify(
          `Personality: ${personalities.get(chosen)?.name ?? chosen}`,
          "info",
        );
      }
    },
  });

  pi.on("before_agent_start", (event, _ctx) => {
    const prompt = personalities?.get(active)?.prompt ?? "";
    if (!prompt) return;
    return {
      systemPrompt: `${event.systemPrompt ?? ""}\n\n---\n\n## Communication Style\n\nThe following instructions govern only how you communicate with the user — tone, phrasing, and conversational manner. They do not affect task execution, code quality, technical decisions, or the substance of your work. Apply these style guidelines to all user-facing text while keeping your technical work unchanged.\n\n${prompt}`,
    };
  });
}
