import { $inject } from "alepha";

import { AutomationChannels } from "./AutomationChannels.ts";
import { AutomationReferences } from "./AutomationReferences.ts";
import { ProjectSecurityService } from "./ProjectSecurityService.ts";

export class CoreAutomationReferences {
  protected readonly references = $inject(AutomationReferences);
  protected readonly security = $inject(ProjectSecurityService);
  protected readonly channels = $inject(AutomationChannels);
  constructor() {
    this.references.register("member", async (projectId, value) => {
      if (typeof value !== "string") return "Member must be a stable user ID";
      return (await this.security.isMemberById(projectId, value))
        ? undefined
        : "Member is no longer in this project";
    });
    this.references.register("channel", async (projectId, value) =>
      (await this.channels.all(projectId)).some(
        (channel) => channel.key === value && channel.available,
      )
        ? undefined
        : "Channel transport or destination is not configured",
    );
  }
}
