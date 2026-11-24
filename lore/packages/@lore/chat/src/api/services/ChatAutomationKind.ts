import {
  AgentAutomationKinds,
  type AgentAutomationRunContext,
  type AgentAutomationRunOutcome,
} from "@lore/core/api";
import type { AgentAutomation } from "@lore/core/schemas";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { chatRooms } from "../entities/chatRooms.ts";
import { ChatAgentRunner } from "./ChatAgentRunner.ts";
import { ChatRoomService } from "./ChatRoomService.ts";

/**
 * A chat agent's rounds (#Q4236): the `chat` kind of an agent automation,
 * which runs a project chat agent in a room on the automation's trigger, as
 * if its owner had mentioned it there. Not a host job: the run is the chat
 * engine's, paid by the project's AI budget for agents first (#Q4237), then
 * by the owner's.
 *
 * The room and the agent are read at each run, by name and handle, as the
 * automation names them. A private room the owner is not in does not exist
 * for the run, as it does not for the owner.
 */
export class ChatAutomationKind {
  protected readonly kinds = $inject(AgentAutomationKinds);
  protected readonly runner = $inject(ChatAgentRunner);
  protected readonly rooms = $inject(ChatRoomService);
  protected readonly roomRows = $repository(chatRooms);

  constructor() {
    this.kinds.register({
      key: "chat",
      // What mentioning an agent asks.
      permission: "chat:write",
      run: (automation, context) => this.run(automation, context),
    });
  }

  protected async run(
    automation: AgentAutomation,
    context: AgentAutomationRunContext,
  ): Promise<AgentAutomationRunOutcome> {
    const room = await this.roomRows.findOne({
      where: {
        projectId: { eq: automation.projectId },
        name: { eq: automation.room ?? "" },
      },
    });
    const visible =
      room &&
      !room.archivedAt &&
      (!room.private ||
        (await this.rooms.membershipOf(room.id, context.startedBy)));
    if (!room || !visible) {
      return { jobIds: [], skipped: `No room #${automation.room}` };
    }
    const skipped = await this.runner.startUnasked(
      room,
      { id: context.startedBy, roles: ["user"] },
      automation.agent ?? "",
      automation.promptText ?? "",
    );
    return skipped ? { jobIds: [], skipped } : { jobIds: [] };
  }
}
