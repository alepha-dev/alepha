import { useI18n } from "alepha/react/i18n";

import type { AutomationResource } from "../../../../../api/schemas/automationResourceSchema.ts";
import type { AutomationRule } from "../../../../../api/schemas/automationRuleSchema.ts";
import type { I18n } from "../../../services/I18n.ts";

/**
 * The words every Automations page uses for a rule's trigger and state, in
 * one place so the list, the detail page and the gallery cannot disagree.
 */
export const useAutomationLabels = () => {
  const { tr } = useI18n<I18n, "en">();
  const events: Record<string, string> = {
    "feedback.created": tr("automation.event.feedbackCreated"),
    "release.published": tr("automation.event.releasePublished"),
    "epic.completed": tr("automation.event.epicCompleted"),
    "deploy.failed": tr("automation.event.deployFailed"),
    "deploy.succeeded": tr("automation.event.deploySucceeded"),
    "quest.completed": tr("automation.event.questCompleted"),
  };
  const states: Record<AutomationResource["displayState"], string> = {
    disabled: tr("automation.state.disabled"),
    active: tr("automation.state.active"),
    paused: tr("automation.state.paused"),
    broken: tr("automation.state.broken"),
  };
  const tones: Record<
    AutomationResource["displayState"],
    "neutral" | "success" | "warning" | "danger"
  > = {
    disabled: "neutral",
    active: "success",
    paused: "warning",
    broken: "danger",
  };
  const pad = (value: string) => value.padStart(2, "0");
  /**
   * The schedules presets write, said in words; anything else keeps its
   * cron expression, which is still exact.
   */
  const schedule = (cron: string) => {
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5)
      return tr("automation.schedule.cron", { args: [cron] });
    const [minute, hour, day, month, weekday] = parts;
    const every = /^\*\/(\d+)$/.exec(minute);
    if (
      every &&
      hour === "*" &&
      day === "*" &&
      month === "*" &&
      weekday === "*"
    )
      return tr("automation.schedule.minutes", { args: [every[1]] });
    if (
      /^\d+$/.test(minute) &&
      /^\d+$/.test(hour) &&
      day === "*" &&
      month === "*" &&
      weekday === "*"
    )
      return tr("automation.schedule.daily", {
        args: [`${pad(hour)}:${pad(minute)}`],
      });
    return tr("automation.schedule.cron", { args: [cron] });
  };
  const trigger = (rule: AutomationRule | undefined | null) =>
    !rule
      ? tr("automation.redacted")
      : rule.trigger.kind === "event"
        ? (events[rule.trigger.event] ?? rule.trigger.event)
        : schedule(rule.trigger.cron);
  return { events, states, tones, schedule, trigger };
};
