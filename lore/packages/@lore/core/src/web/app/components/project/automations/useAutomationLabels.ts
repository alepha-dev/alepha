import { useI18n } from "alepha/react/i18n";

import type { AutomationGraphNode } from "../../../../../api/schemas/automationGraphNodeSchema.ts";
import type { AutomationGraphValue } from "../../../../../api/schemas/automationGraphSchema.ts";
import type { AutomationResource } from "../../../../../api/schemas/automationResourceSchema.ts";
import type { AutomationResourceSource } from "../../../../../api/schemas/automationResourceSourceSchema.ts";
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
    "monitor.down": tr("automation.event.monitorDown"),
    "monitor.up": tr("automation.event.monitorUp"),
    "host.credential_invalid": tr("automation.event.hostCredentialInvalid"),
    "host.expired": tr("automation.event.hostExpired"),
    "host.offline": tr("automation.event.hostOffline"),
    "host.online": tr("automation.event.hostOnline"),
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
    // Warning, not grey (#Q3573): a disabled rule does nothing, and a grey
    // chip let a careful reader take a draft for a working rule.
    disabled: "warning",
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
  /**
   * What starts a source (#Q3805): its event, or its schedule in words.
   */
  const source = (node: AutomationGraphNode) =>
    node.type === "schedule"
      ? schedule(String(node.config.cron ?? ""))
      : (events[node.type] ?? node.type);
  /**
   * What starts an automation: its sources, the first two named, then how
   * many more.
   */
  const trigger = (rule: AutomationGraphValue | undefined | null) => {
    if (!rule) return tr("automation.redacted");
    const sources = rule.nodes.filter((node) => node.kind === "source");
    const named = sources.slice(0, 2).map(source).join(", ");
    return sources.length > 2 ? `${named} +${sources.length - 2}` : named;
  };
  /**
   * What starts an automation, from its resource's sources (#Q3810): the
   * first two named, then how many more, and how many are switched off.
   * A list reads no graph.
   */
  const sources = (list: AutomationResourceSource[]) => {
    const name = (item: AutomationResourceSource) =>
      item.cron !== undefined
        ? schedule(item.cron)
        : (events[item.type] ?? item.type);
    const named = list.slice(0, 2).map(name).join(", ");
    const off = list.filter((item) => !item.enabled).length;
    return {
      names: list.length > 2 ? `${named} +${list.length - 2}` : named,
      off: off ? tr("automation.trigger.off", { args: [String(off)] }) : "",
    };
  };
  return { events, states, tones, schedule, source, trigger, sources };
};
