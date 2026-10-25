import { $inject } from "alepha";
import { $repository, type SQLLike } from "alepha/orm";
import { BadRequestError, ForbiddenError } from "alepha/server";

import type { Automation } from "../entities/automations.ts";
import { users } from "../entities/users.ts";
import { AutomationNotificationTemplates } from "../notifications/AutomationNotificationTemplates.ts";
import { automationNotificationVariablesSchema } from "../schemas/automationNotificationVariablesSchema.ts";
import type { AutomationRule } from "../schemas/automationRuleSchema.ts";
import type { AutomationRunSnapshot } from "../schemas/automationRunSnapshotSchema.ts";
import { AutomationAuthority } from "./AutomationAuthority.ts";
import { AutomationCatalog } from "./AutomationCatalog.ts";
import { AutomationChannels } from "./AutomationChannels.ts";
import { AutomationClaims } from "./AutomationClaims.ts";
import type { AutomationRenderContext } from "./AutomationContextBuilder.ts";
import { AutomationDatabase } from "./AutomationDatabase.ts";
import { AutomationNotificationOutbox } from "./AutomationNotificationOutbox.ts";
import { AutomationPersistence } from "./AutomationPersistence.ts";
import { AutomationProjectSecurity } from "./AutomationProjectSecurity.ts";
import { AutomationTemplateRenderer } from "./AutomationTemplateRenderer.ts";
import { CoreAutomationReferences } from "./CoreAutomationReferences.ts";

/**
 * One enqueue is one durable recipient-channel effect. Delivery is reported
 * separately by the ordinary notification outbox and its transport receipts.
 */
export class AutomationNotifications {
  protected readonly renderer = $inject(AutomationTemplateRenderer);
  protected readonly channels = $inject(AutomationChannels);
  protected readonly catalog = $inject(AutomationCatalog);
  protected readonly references = $inject(CoreAutomationReferences);
  protected readonly users = $repository(users);
  protected readonly templates = $inject(AutomationNotificationTemplates);
  protected readonly security = $inject(AutomationProjectSecurity);
  protected readonly persistence = $inject(AutomationPersistence);
  protected readonly authority = $inject(AutomationAuthority);
  protected readonly claims = $inject(AutomationClaims);
  protected readonly outbox = $inject(AutomationNotificationOutbox);
  protected readonly database = $inject(AutomationDatabase);
  protected readonly htmlPrefix = '<div style="white-space: pre-wrap">';
  protected readonly htmlSuffix = "</div>";

  /**
   * Shared with dry run. No contact or payload is persisted here.
   */
  public async prepare(input: {
    rule: Automation;
    index: number;
    action: AutomationRule["actions"][number];
    context: AutomationRenderContext;
    variables: AutomationRunSnapshot["variables"];
    excludeUserId?: string;
  }) {
    const preliminary = this.renderer.render(
      input.action,
      input.context,
      input.variables,
    );
    if (preliminary.suppressed)
      return {
        skipped: true as const,
        reason: preliminary.reason,
        rendered: preliminary,
      };
    if (preliminary.raw.kind !== "notify")
      throw new BadRequestError("Notification adapter requires NOTIFY");
    const adapter = await this.channels.adapter(
      input.rule.projectId,
      preliminary.raw.channel,
    );
    const overhead =
      adapter.target === "html"
        ? new TextEncoder().encode(
            JSON.stringify(this.htmlPrefix + this.htmlSuffix),
          ).byteLength - 2
        : 0;
    const rendered = this.renderer.render(
      input.action,
      input.context,
      input.variables,
      adapter.target,
      16_384 - overhead,
    );
    if (
      rendered.suppressed ||
      rendered.raw.kind !== "notify" ||
      rendered.action.kind !== "notify"
    )
      throw new BadRequestError("Invalid rendered notification");
    const action = rendered.raw;
    if (action.kind !== "notify" || !action.recipient || action.audience)
      throw new BadRequestError(
        "A concrete notification requires one member recipient",
      );
    const sourceKey =
      input.rule.rule.trigger.kind === "event"
        ? input.rule.rule.trigger.event
        : input.rule.rule.select!.key;
    const source = this.catalog
      .entries()
      .find((entry) => entry.key === sourceKey);
    if (!source)
      throw new BadRequestError("Notification source is unavailable");
    const reason = await this.references.recipientReason(
      input.rule.projectId,
      action.recipient,
      source,
    );
    if (reason) throw new ForbiddenError(reason);
    if (input.excludeUserId === action.recipient)
      return { skipped: true as const, reason: "excluded_publisher", rendered };
    const account = await this.users.getById(action.recipient);
    const contact = adapter.addressable
      ? action.channel === "inbox" && !account.email
        ? `lore-user:${account.id}`
        : account.email?.trim().toLowerCase()
      : undefined;
    if (adapter.addressable && !contact)
      return {
        skipped: true as const,
        reason: "recipient_has_no_email",
        rendered,
      };
    const project = await this.security.projects.getById(input.rule.projectId);
    const variables = automationNotificationVariablesSchema.parse({
      title: action.title,
      text: action.text,
      html:
        adapter.target === "html"
          ? `${this.htmlPrefix}${rendered.action.text}${this.htmlSuffix}`
          : rendered.action.text,
      href:
        typeof input.context.values.url === "string"
          ? input.context.values.url
          : `/${project.slug}`,
      projectTitle: project.title,
      scope: `project:${project.id}`,
      automationId: input.rule.id,
      ruleRevision: input.rule.revision,
      actionIndex: input.index,
      recipientUserId: action.recipient,
      category: action.category,
    });
    return {
      skipped: false as const,
      rendered,
      action,
      payload: {
        type: action.channel,
        template: adapter.templates[action.category],
        ...(contact ? { contact } : {}),
        variables,
        category: action.category === "reminders" ? "tasks" : action.category,
        critical: false,
        sensitive: true,
        lang: this.templates.lang,
      },
    };
  }

  public async enqueue(input: {
    occurrenceId: string;
    token: string;
    index: number;
    row?: number;
    context: AutomationRenderContext;
    delivery?: { recipient: string; channel: string; key: string };
    excludeUserId?: string;
    settlement?: {
      condition: SQLLike;
      statements: SQLLike[];
      changedTables: string[];
    };
  }) {
    return this.database.primary(async () => {
      const occurrence = await this.claims.lease(
        input.occurrenceId,
        input.token,
      );
      const rule = await this.persistence.rules.getById(
        occurrence.automationId!,
      );
      const stored = occurrence.snapshot!.rule!.actions[input.index];
      if (stored?.kind !== "notify")
        throw new BadRequestError("Claimed step is not NOTIFY");
      const action = input.delivery
        ? {
            kind: "notify" as const,
            recipient: input.delivery.recipient,
            channel: input.delivery.channel,
            title: stored.title,
            text: stored.text,
            category: stored.category,
          }
        : stored;
      const prepared = await this.prepare({
        rule,
        index: input.index,
        action,
        context: input.context,
        variables: occurrence.snapshot!.variables,
        excludeUserId: input.excludeUserId,
      });
      const resolved = prepared.rendered.raw;
      await this.authority.check({
        automationId: rule.id,
        revision: occurrence.ruleRevision,
        variables: occurrence.snapshot!.variables,
        effect: { index: input.index, action: resolved },
      });
      const operationId = await this.claims.actionIdentity(occurrence, {
        index: input.index,
        row: input.row,
        deliveryKey: input.delivery?.key,
      });
      const outbox = prepared.skipped
        ? undefined
        : this.outbox.prepare({
            projectId: rule.projectId,
            automationId: rule.id,
            runId: occurrence.runId ?? undefined,
            operationId,
            payload: prepared.payload,
            key: `automation:${operationId}`,
          });
      const receipt = await this.claims.atomicEffect(
        input.occurrenceId,
        input.token,
        {
          index: input.index,
          row: input.row,
          deliveryKey: input.delivery?.key,
          action: resolved,
          statements: [
            ...(outbox?.statements ?? []),
            ...(prepared.skipped ? [] : (input.settlement?.statements ?? [])),
          ],
          ...(input.settlement && !prepared.skipped
            ? { condition: input.settlement.condition }
            : {}),
          result: prepared.skipped
            ? { skipped: true, reason: prepared.reason }
            : { outbox_id: outbox!.id, enqueued: true, delivered: false },
          changedTables: [
            ...(outbox?.changedTables ?? []),
            ...(prepared.skipped
              ? []
              : (input.settlement?.changedTables ?? [])),
          ],
        },
      );
      const id = receipt.result?.outbox_id;
      if (typeof id === "string") await this.outbox.dispatch(id);
      return {
        receipt,
        rendered: prepared.rendered,
        status:
          receipt.result?.skipped === true
            ? ("skipped" as const)
            : ("queued" as const),
      };
    });
  }
}
