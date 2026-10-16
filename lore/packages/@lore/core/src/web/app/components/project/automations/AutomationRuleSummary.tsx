import { useI18n } from "alepha/react/i18n";

import type { AutomationResource } from "../../../../../api/schemas/automationResourceSchema.ts";
import type { I18n } from "../../../services/I18n.ts";

export interface AutomationRuleSummaryProps {
  rule: AutomationResource;
  labels?: Record<string, string>;
}

const AutomationRuleSummary = (props: AutomationRuleSummaryProps) => {
  const { tr } = useI18n<I18n, "en">();
  const rule = props.rule.rule;
  const states = {
    disabled: tr("automation.state.disabled"),
    active: tr("automation.state.active"),
    paused: tr("automation.state.paused"),
    broken: tr("automation.state.broken"),
  };
  const events = {
    "feedback.created": tr("automation.event.feedbackCreated"),
    "release.published": tr("automation.event.releasePublished"),
    "epic.completed": tr("automation.event.epicCompleted"),
    "quest.completed": tr("automation.event.questCompleted"),
    "deploy.failed": tr("automation.event.deployFailed"),
    "deploy.succeeded": tr("automation.event.deploySucceeded"),
  };
  return (
    <div className="border-border flex max-w-3xl flex-col gap-3 rounded-md border p-4">
      <h2 className="font-semibold">{props.rule.title}</h2>
      {props.rule.presetKey && (
        <p className="text-muted-foreground text-xs">
          {tr("automation.setup.origin", { args: [props.rule.presetKey] })}
        </p>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-sm">
        <dt>{tr("automation.column.author")}</dt>
        <dd className="break-all">
          {props.rule.authorName || props.rule.authorUserId}
        </dd>
        <dt>{tr("automation.column.state")}</dt>
        <dd>{states[props.rule.displayState]}</dd>
        <dt>{tr("automation.column.trigger")}</dt>
        <dd>
          {rule
            ? rule.trigger.kind === "event"
              ? events[rule.trigger.event]
              : `${rule.trigger.cron} UTC`
            : tr("automation.redacted")}
        </dd>
        {rule?.trigger.kind === "event" && rule.trigger.app && (
          <>
            <dt>{tr("automation.setup.app")}</dt>
            <dd>{props.labels?.app || rule.trigger.app}</dd>
          </>
        )}
        {rule?.actions.map((action, index) => (
          <div className="col-span-2 flex flex-col gap-1" key={index}>
            {action.kind === "notify" ? (
              <>
                <dt>{tr("automation.setup.recipient")}</dt>
                <dd className="break-all">
                  {props.labels?.recipient || action.recipient}
                </dd>
                <dt>{tr("automation.setup.channel")}</dt>
                <dd>
                  {tr(`automation.channel.${action.channel}` as never, {
                    default: props.labels?.channel || action.channel,
                  })}
                </dd>
              </>
            ) : (
              <>
                <dt>{tr("automation.setup.appendFolio")}</dt>
                <dd className="break-all">
                  {action.kind === "appendFolio"
                    ? props.labels?.folio || action.folio
                    : action.kind}
                </dd>
              </>
            )}
          </div>
        ))}
      </dl>
      {props.rule.reason && (
        <p className="text-muted-foreground text-sm">{props.rule.reason}</p>
      )}
    </div>
  );
};

export default AutomationRuleSummary;
