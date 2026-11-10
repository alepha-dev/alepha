import { $inject } from "alepha";

import type { Automation } from "../entities/automations.ts";
import { AutomationAttentionNotifications } from "../notifications/AutomationAttentionNotifications.ts";
import { LoreInboxNotifications } from "../notifications/LoreInboxNotifications.ts";
import { AutomationProjectSecurity } from "./AutomationProjectSecurity.ts";
import { BestEffort } from "./BestEffort.ts";

/**
 * Tells a rule's author that it stopped and needs them (#Q3267).
 *
 * Before this the only trace of a rule pausing for approval was its row in
 * the Automations list, which its author had to open to find out.
 *
 * ⚠️ Once per TRANSITION, which is this class's one rule. A health sweep
 * runs every few minutes and a rule's reason can be reworded between two of
 * them, so "the rule row changed" is not the test: the message goes out when
 * the rule ENTERS a state that needs its author, and not again while it
 * stays in it.
 */
export class AutomationAttentionNotifier {
  protected readonly templates = $inject(AutomationAttentionNotifications);
  protected readonly inbox = $inject(LoreInboxNotifications);
  protected readonly security = $inject(AutomationProjectSecurity);
  protected readonly bestEffort = $inject(BestEffort);

  /**
   * What a rule in this state asks of its author, if anything.
   */
  public kind(
    state: Pick<Automation, "health" | "requiresApproval">,
  ): "approval" | "broken" | undefined {
    if (state.health === "broken") return "broken";
    if (state.health === "paused" && state.requiresApproval) return "approval";
    return undefined;
  }

  /**
   * Called after a health transition was WRITTEN, with the rule as it was
   * and the state it moved to. Best effort: a message that cannot be filed
   * must not undo, or fail, the transition it reports.
   */
  public async moved(
    before: Automation,
    after: Pick<Automation, "health" | "requiresApproval"> & {
      reason?: string;
    },
  ): Promise<void> {
    const kind = this.kind(after);
    if (!kind || kind === this.kind(before)) return;
    await this.bestEffort.run("Tell an automation's author it stopped", () =>
      this.push(before, kind, after.reason),
    );
  }

  protected async push(
    rule: Automation,
    kind: "approval" | "broken",
    reason: string | undefined,
  ): Promise<void> {
    const project = await this.security.projects.findById(rule.projectId);
    if (!project) return;
    await this.templates.attention.push({
      contact: `lore-user:${rule.authorUserId}`,
      lang: this.inbox.lang,
      variables: {
        automationTitle: rule.title,
        kind,
        reason: reason ?? "",
        projectTitle: project.title,
        href: `/${project.slug}/automations/${rule.id}`,
        scope: `project:${project.id}`,
      },
    });
  }
}
