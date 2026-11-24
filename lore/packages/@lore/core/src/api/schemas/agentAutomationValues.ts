/*
 * Browser-loadable: the automations page and the CLI list these, and a web
 * file may not load the entity's service (#Q4226).
 */

/**
 * What an agent automation runs (#Q4226): the project's Triage prompt
 * (`feedbackLoop`), its Build prompt (`questWork`), a free text under
 * Lore's preamble, or a chat agent's rounds in a room (#Q4236), which runs
 * in Lore rather than on an Agent host.
 */
export const AUTOMATION_PROMPT_KINDS = [
  "triage",
  "build",
  "text",
  "chat",
] as const;

export type AutomationPromptKind = (typeof AUTOMATION_PROMPT_KINDS)[number];

/**
 * When an agent automation runs (#Q4226): only by hand, on a project event
 * (#Q4227), or on a schedule (#Q4228).
 */
export const AUTOMATION_TRIGGERS = ["manual", "event", "schedule"] as const;

export type AutomationTrigger = (typeof AUTOMATION_TRIGGERS)[number];

/**
 * An automation's name: what `lore automation run <name>` takes, unique in
 * its project. Lowercase, so a text run's workspace can carry it.
 */
export const AUTOMATION_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,47}$/;

/**
 * A schedule's interval (#Q4228), from a fixed list: no cron text. Each runs
 * on the hour of the hourly job: every hour, every six hours (00, 06, 12
 * and 18 UTC), or once a day at an hour in UTC.
 */
export const AUTOMATION_SCHEDULES = ["hourly", "6h", "daily"] as const;

export type AutomationSchedule = (typeof AUTOMATION_SCHEDULES)[number];
