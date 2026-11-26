import {
  HostConsoleRegistry,
  PinnedPromptsSlot,
  ProjectShellRegistry,
  ShellExtensionRegistry,
  SpotlightSourceRegistry,
} from "@lore/core/web";
import { $inject } from "alepha";
import { Bot, ListChecks } from "lucide-react";

import BayAgentHost from "../components/bay/BayAgentHost.tsx";
import JobSidePanel from "../components/jobs-header/JobSidePanel.tsx";
import PromptJobsButton from "../components/jobs-header/PromptJobsButton.tsx";
import PromptPinsMenu from "../components/pins/PromptPinsMenu.tsx";
import { usePromptPins } from "../components/pins/usePromptPins.tsx";
import { usePromptSpotlightGroup } from "../components/pins/usePromptSpotlightGroup.tsx";

/**
 * What Prompts puts in the project shell and in core's web slots (#E175):
 * Settings > Prompts, the pins button and hook Plan's and Ship's pages
 * draw, the spotlight's prompt rows, the host's Agent switch and its Jobs
 * tab, and the header's jobs button (#Q4514).
 *
 * Registered at boot, before the container locks.
 */
export class PromptsShell {
  protected readonly shell = $inject(ProjectShellRegistry);
  protected readonly pins = $inject(PinnedPromptsSlot);
  protected readonly spotlight = $inject(SpotlightSourceRegistry);
  protected readonly hostConsole = $inject(HostConsoleRegistry);
  protected readonly extensions = $inject(ShellExtensionRegistry);

  constructor() {
    // Every member opens it: reading and copying a prompt needs no settings
    // permission; `prompt:manage` gates the writes. Listed only while the
    // project has the capability on.
    this.shell.registerSettings({
      key: "prompts",
      capability: "prompts",
      order: 28,
      labelKey: "project.settings.nav.prompts",
      icon: Bot,
      tabs: [
        {
          route: "projectSettingsPrompts",
          labelKey: "project.settings.tab.prompts",
          fullWidth: true,
        },
        {
          // A job belongs to the project (#Q4281): this is where its
          // members list theirs. A host's console lists the machine's
          // (#Q4524). Listed with the read its API asks.
          route: "projectSettingsPromptJobs",
          labelKey: "project.settings.tab.jobs",
          requires: "host:read",
          fullWidth: true,
          alsoOn: ["projectJob"],
        },
      ],
    });
    this.pins.fill({ Button: PromptPinsMenu, usePins: usePromptPins });
    this.spotlight.register({
      key: "prompts",
      capability: "prompts",
      useGroup: usePromptSpotlightGroup,
    });
    // Whatever the home project's capabilities (#Q4524): a host may run
    // the jobs of a project it is lent to.
    this.hostConsole.registerTab({
      route: "bayJobs",
      labelKey: "bay.nav.jobs",
      icon: ListChecks,
      order: 36,
    });
    // The project's agent jobs in flight, beside the bell (#Q4514): before
    // the app's own controls, which take the default order.
    this.extensions.registerHeaderAction({
      key: "prompt-jobs",
      component: PromptJobsButton,
      order: -10,
    });
    // The job a row of that list opens, watched from any page (#Q4515).
    this.extensions.registerOverlay({
      key: "job-panel",
      component: JobSidePanel,
    });
    this.hostConsole.registerAgentPanel({
      key: "agent-host",
      order: 10,
      Component: BayAgentHost,
    });
  }
}
