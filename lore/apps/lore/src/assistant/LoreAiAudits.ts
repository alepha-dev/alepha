import { LoreAudits } from "@lore/core/api";
import { $hook, $inject } from "alepha";
import { $audit } from "alepha/api/audits";

/**
 * Who let the assistant do what (#Q3210): every answer to a confirmation
 * card, approve or deny, recorded through Lore's audit service under the
 * user and the call's project, on that project's Activity page.
 *
 * `ai:call:decided` fires on the resume, before an approved call runs, with
 * the call as the server stored it. The approved write itself is audited by
 * its own action as usual; this row is the decision. Best effort, as every
 * Lore audit (`LoreAuditService.record`): a failure is logged, never thrown.
 */
export class LoreAiAudits {
  protected readonly audits = $inject(LoreAudits);

  public readonly assistant = $audit({
    type: "assistant",
    description: "A member's answer to an assistant's confirmation card",
    actions: ["approve", "deny"],
  });

  protected readonly onDecided = $hook({
    on: "ai:call:decided",
    handler: async (event) => {
      const projectId = this.projectOf(event.input);
      await this.assistant.logSuccess(event.decision, {
        userId: event.userId,
        ...(projectId === undefined ? {} : this.audits.scope(projectId)),
        resourceType: "tool",
        resourceId: event.name,
        description: event.name,
        metadata: {
          conversationId: event.conversationId,
          callId: event.callId,
          fields: Object.keys(event.input),
        },
      });
    },
  });

  /**
   * The project a call names: every Lore tool takes `project` (its id).
   */
  protected projectOf(input: Record<string, unknown>): number | undefined {
    const id = input.project;
    return typeof id === "number" && Number.isInteger(id) ? id : undefined;
  }
}
