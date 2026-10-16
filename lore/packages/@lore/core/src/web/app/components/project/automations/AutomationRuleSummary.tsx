import { useI18n } from "alepha/react/i18n";

import type { AutomationResource } from "../../../../../api/schemas/automationResourceSchema.ts";
import { AutomationTemplateTokens } from "../../../../../api/schemas/AutomationTemplateTokens.ts";
import type { I18n } from "../../../services/I18n.ts";
import { useAutomationLabels } from "./useAutomationLabels.ts";
import { useAutomationOptionLabels } from "./useAutomationOptions.ts";

export interface AutomationRuleSummaryProps {
  rule: AutomationResource;
}

/**
 * A rule read aloud: when it runs, the condition it checks and what it does,
 * with members and folios named rather than printed as ids.
 */
const AutomationRuleSummary = (props: AutomationRuleSummaryProps) => {
  const { tr, l } = useI18n<I18n, "en">();
  const labels = useAutomationLabels();
  const rule = props.rule.rule;
  const tokens = new AutomationTemplateTokens();
  const literal = (value: unknown) =>
    typeof value === "string" && tokens.whole(value) === undefined
      ? value
      : undefined;
  const members = useAutomationOptionLabels(
    "member",
    (rule?.actions ?? []).flatMap((action) =>
      action.kind === "notify" && literal(action.recipient)
        ? [action.recipient!]
        : [],
    ),
  );
  const folios = useAutomationOptionLabels(
    "folio",
    (rule?.actions ?? []).flatMap((action) =>
      action.kind === "appendFolio" && literal(action.folio)
        ? [action.folio]
        : [],
    ),
  );
  /**
   * A bound value names its variable; a literal one its label when known.
   */
  const named = (value: unknown, names?: Map<string, string>) => {
    if (typeof value === "number" || typeof value === "boolean")
      return String(value);
    if (Array.isArray(value)) return value.join(", ");
    if (typeof value !== "string") return "";
    const key = tokens.whole(value);
    if (key !== undefined)
      return tr("automation.summary.variable", { args: [key] });
    return names?.get(value) ?? value;
  };
  const channel = (value: string) =>
    tokens.whole(value) !== undefined
      ? named(value)
      : tr(`automation.channel.${value}` as never, { default: value });
  const operators: Record<string, string> = {
    eq: "=",
    ne: "≠",
    lt: "<",
    lte: "≤",
    gt: ">",
    gte: "≥",
    delta: tr("automation.summary.dropsBy"),
    crossesAbove: tr("automation.summary.crossesAbove"),
  };
  if (!rule)
    return (
      <p className="text-muted-foreground text-sm">
        {props.rule.redactionReason || tr("automation.redacted")}
      </p>
    );
  return (
    <div className="bg-card rounded-lg border">
      <dl className="grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-6 gap-y-3 p-4 text-sm">
        <dt className="text-muted-foreground">
          {tr("automation.summary.when")}
        </dt>
        <dd>
          {labels.trigger(rule)}
          {rule.trigger.kind === "event" && rule.trigger.app && (
            <span className="text-muted-foreground">
              {" "}
              {tr("automation.summary.forApp", {
                args: [named(rule.trigger.app)],
              })}
            </span>
          )}
          {rule.select && Object.keys(rule.select.filters).length > 0 && (
            <span className="text-muted-foreground block text-xs">
              {Object.entries(rule.select.filters)
                .map(([key, value]) => `${key}: ${named(value)}`)
                .join(", ")}
            </span>
          )}
        </dd>
        {rule.guard && (
          <>
            <dt className="text-muted-foreground">
              {tr("automation.summary.onlyIf")}
            </dt>
            <dd className="font-mono text-xs leading-5">
              {rule.guard.field} {operators[rule.guard.operator]}{" "}
              {named(rule.guard.value)}
            </dd>
          </>
        )}
        <dt className="text-muted-foreground">
          {tr("automation.summary.then")}
        </dt>
        <dd>
          <ol className="flex flex-col gap-1.5">
            {rule.actions.map((action, index) => (
              <li key={index} className="break-words">
                {action.kind === "notify"
                  ? tr("automation.summary.notify", {
                      args: [
                        action.audience
                          ? tr("automation.adoption.roster")
                          : named(action.recipient, members),
                        channel(action.channel),
                      ],
                    })
                  : action.kind === "appendFolio"
                    ? tr("automation.summary.appendFolio", {
                        args: [named(action.folio, folios)],
                      })
                    : action.kind === "createQuest"
                      ? tr("automation.summary.createQuest", {
                          args: [action.title],
                        })
                      : action.kind === "assignRelease"
                        ? tr("automation.summary.assignRelease", {
                            args: [named(action.release)],
                          })
                        : tr("automation.summary.addTag", {
                            args: [action.tag],
                          })}
              </li>
            ))}
          </ol>
        </dd>
        <dt className="text-muted-foreground">
          {tr("automation.column.author")}
        </dt>
        <dd>{props.rule.authorName || props.rule.authorUserId}</dd>
        {props.rule.nextRunAt && props.rule.enabled && (
          <>
            <dt className="text-muted-foreground">
              {tr("automation.summary.nextRun")}
            </dt>
            <dd>{l(props.rule.nextRunAt, { date: "lll" })}</dd>
          </>
        )}
      </dl>
    </div>
  );
};

export default AutomationRuleSummary;
