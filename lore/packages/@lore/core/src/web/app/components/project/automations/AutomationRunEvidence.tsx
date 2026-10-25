import { useI18n } from "alepha/react/i18n";

import type { AutomationRunResource } from "../../../../../api/schemas/automationRunResourceSchema.ts";
import type { I18n } from "../../../services/I18n.ts";

export interface AutomationRunEvidenceProps {
  run: AutomationRunResource;
}
const AutomationRunEvidence = (props: AutomationRunEvidenceProps) => {
  const { tr, l } = useI18n<I18n, "en">();
  const effectLabels = {
    pending: tr("automation.effect.pending"),
    running: tr("automation.effect.running"),
    succeeded: tr("automation.effect.succeeded"),
    skipped: tr("automation.effect.skipped"),
    refused: tr("automation.effect.refused"),
    failed: tr("automation.effect.failed"),
    unknown: tr("automation.effect.unknown"),
    queued: tr("automation.effect.queued"),
  };
  const deliveryLabels = {
    queued: tr("automation.delivery.queued"),
    unknown: tr("automation.delivery.unknown"),
    sent: tr("automation.delivery.sent"),
    delivered: tr("automation.delivery.delivered"),
    deferred: tr("automation.delivery.deferred"),
    bounced: tr("automation.delivery.bounced"),
    complained: tr("automation.delivery.complained"),
    failed: tr("automation.delivery.failed"),
    rejected: tr("automation.delivery.rejected"),
    skipped: tr("automation.delivery.skipped"),
  };
  const snapshot = props.run.snapshot;
  if (!snapshot) return null;
  return (
    <section className="flex flex-col gap-4">
      {snapshot.noData && <p>{tr("automation.run.noData")}</p>}
      {snapshot.counts.truncated && <p>{tr("automation.run.capped")}</p>}
      <p>
        {tr("automation.test.counts", {
          args: [l(snapshot.counts.selected), l(snapshot.counts.matched)],
        })}
      </p>
      <p>
        {tr(
          snapshot.counts.totalIsExact
            ? "automation.test.total"
            : "automation.test.lowerBound",
          { args: [l(snapshot.counts.total)] },
        )}
      </p>
      {snapshot.omitted && <p>{snapshot.omitted}</p>}
      <details>
        <summary>{tr("automation.history.snapshot")}</summary>
        <pre className="mt-3 overflow-auto text-xs break-words whitespace-pre-wrap">
          {JSON.stringify(
            {
              rule: snapshot.rule,
              source: snapshot.source,
              variables: snapshot.variables,
              inputs: snapshot.inputs,
              selected: snapshot.selected,
            },
            null,
            2,
          )}
        </pre>
      </details>
      <h2 className="font-medium">{tr("automation.history.effects")}</h2>
      {snapshot.actions.map((action, index) => (
        <section key={index} className="border-border rounded-md border p-4">
          <p>
            {tr("automation.editor.action", {
              args: [String(action.index + 1)],
            })}
            {action.row !== undefined && ` (${action.row + 1})`}:{" "}
            {effectLabels[action.status]}
          </p>
          <pre className="my-2 text-xs break-words whitespace-pre-wrap">
            {JSON.stringify(action.result, null, 2)}
          </pre>
          {props.run.notifications
            .filter(
              (notification) =>
                notification.index === action.index &&
                notification.row === action.row,
            )
            .map((notification) => (
              <a
                className="text-sm underline"
                href={`#delivery-${notification.outboxId}`}
                key={notification.outboxId}
              >
                {tr("automation.history.delivery")}:{" "}
                {deliveryLabels[notification.status]}
              </a>
            ))}
        </section>
      ))}
      <h2 className="font-medium">{tr("automation.history.deliveries")}</h2>
      <p className="text-muted-foreground text-sm">
        {tr("automation.history.deliveryMeaning")}
      </p>
      {props.run.notifications.map((notification) => (
        <section
          id={`delivery-${notification.outboxId}`}
          key={notification.outboxId}
          className="border-border rounded-md border p-4 text-sm"
        >
          <p>
            {tr("automation.editor.action", {
              args: [String(notification.index + 1)],
            })}
            : {deliveryLabels[notification.status]}
          </p>
          {notification.lastAttempt && (
            <p>
              {tr("automation.history.lastAttempt")}:{" "}
              {deliveryLabels[notification.lastAttempt]}
            </p>
          )}
          {notification.reason && <p>{notification.reason}</p>}
          {notification.receiptId && (
            <p className="break-all">
              {tr("automation.history.receipt")}: {notification.receiptId}
            </p>
          )}
          {notification.messageId && (
            <p className="break-all">
              {tr("automation.history.message")}: {notification.messageId}
            </p>
          )}
        </section>
      ))}
    </section>
  );
};
export default AutomationRunEvidence;
