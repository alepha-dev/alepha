import { $inject } from "alepha";

import { HostConsoleRegistry } from "../../../registries/HostConsoleRegistry.ts";
import { PinnedPromptsSlot } from "../../../registries/PinnedPromptsSlot.ts";
import { SpotlightSourceRegistry } from "../../../registries/SpotlightSourceRegistry.ts";
import BayAgentHost from "../../bay/BayAgentHost.tsx";
import PromptPinsMenu from "./pins/PromptPinsMenu.tsx";
import { usePromptPins } from "./pins/usePromptPins.tsx";
import { usePromptSpotlightGroup } from "./pins/usePromptSpotlightGroup.tsx";

/**
 * What Prompts puts in core's web slots (#E175): the pins button and hook,
 * the spotlight's prompt rows and the host's Agent switch. Core's pages and
 * Plan's and Ship's name none of them, only the slots.
 *
 * Registered at boot, before the container locks.
 */
export class PromptsWebSlots {
  protected readonly pins = $inject(PinnedPromptsSlot);
  protected readonly spotlight = $inject(SpotlightSourceRegistry);
  protected readonly hostConsole = $inject(HostConsoleRegistry);

  constructor() {
    this.pins.fill({ Button: PromptPinsMenu, usePins: usePromptPins });
    this.spotlight.register({
      key: "prompts",
      useGroup: usePromptSpotlightGroup,
    });
    this.hostConsole.registerSettingsPanel({
      key: "agent-host",
      order: 10,
      Component: BayAgentHost,
    });
  }
}
