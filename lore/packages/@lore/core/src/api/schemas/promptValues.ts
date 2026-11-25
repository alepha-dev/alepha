/*
 * Browser-loadable: the Prompts section, the CLI and the server read these,
 * and a web file may not load the entity's service (#E174).
 */

/**
 * The item types a prompt's arg takes (#Q4274). A `member` arg also means
 * "email the run's final reply to this member" (#Q4278). Requirements'
 * use case, persona and requirement, and Remember's folio, came with
 * Requirements' built-ins (#Q4343).
 */
export const PROMPT_ARG_TYPES = [
  "epic",
  "quest",
  "feedback",
  "pullRequest",
  "member",
  "useCase",
  "persona",
  "requirement",
  "folio",
] as const;

export type PromptArgType = (typeof PROMPT_ARG_TYPES)[number];

/**
 * The statuses each item type answers, which an arg's accepted list is
 * checked against when it is saved. A pull request, a member, a persona, a
 * requirement and a folio have none, so their args take no list.
 */
export const PROMPT_ARG_STATUSES: Record<PromptArgType, readonly string[]> = {
  epic: ["draft", "ready", "in_progress", "completed"],
  quest: ["todo", "in_progress", "on_hold", "completed", "shelved"],
  feedback: ["pending", "accepted", "rejected"],
  pullRequest: [],
  member: [],
  useCase: ["draft", "ready", "validated", "deprecated"],
  persona: [],
  // Computed on read from the runs, never stored: an arg takes any.
  requirement: [],
  folio: [],
};

/**
 * The fields an arg's placeholders read, `{{<arg>.<field>}}`, per type.
 */
export const PROMPT_ARG_FIELDS: Record<PromptArgType, readonly string[]> = {
  epic: ["reference", "title", "url", "number", "id"],
  quest: ["reference", "title", "url", "number", "id"],
  feedback: ["reference", "title", "url", "number", "id"],
  pullRequest: ["reference", "title", "url", "number", "id"],
  member: ["name", "id"],
  useCase: [
    "reference",
    "title",
    "url",
    "number",
    "id",
    "steps",
    "criteria",
    "persona",
    "demoAccount",
    "environment",
  ],
  persona: [
    "reference",
    "title",
    "url",
    "number",
    "id",
    "role",
    "useCases",
    "criteria",
    "demoAccount",
    "environment",
  ],
  requirement: [
    "reference",
    "title",
    "url",
    "number",
    "id",
    "description",
    "verifiedBy",
  ],
  folio: ["reference", "title", "url", "number", "id"],
};

/**
 * The placeholders every prompt reads, whatever its args: the project's
 * TITLE (what MCP's `project_name` matches), its URL slug, and its address.
 */
export const PROMPT_PROJECT_PLACEHOLDERS = [
  "project",
  "slug",
  "projectUrl",
] as const;

/**
 * Where a run's code comes from (#E173): no repository, read-only at its
 * ref, or a worktree to write in.
 */
export const PROMPT_SOURCES = ["none", "read", "write"] as const;

export type PromptSource = (typeof PROMPT_SOURCES)[number];

/**
 * A prompt's name: a slug, unique in its project. The built-ins' names are
 * reserved in every project.
 */
export const PROMPT_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

/**
 * The most args a custom prompt declares.
 */
export const PROMPT_MAX_ARGS = 4;

/**
 * A custom prompt's run time (#E174) when the project set none (#Q4344).
 */
export const PROMPT_CUSTOM_TIMEOUT_SECONDS = 30 * 60;

/**
 * The least and the most run time an agent job gets, whatever it asks:
 * the bounds of a prompt's own time (#Q4344) and of every job's clamp.
 */
export const AGENT_JOB_MIN_TIMEOUT_SECONDS = 60;
export const AGENT_JOB_MAX_TIMEOUT_SECONDS = 2 * 3600;

/**
 * A prompt's schedule (#Q4277), from a fixed list, on the hour of the hourly
 * job, in UTC: every hour, every six hours (00, 06, 12, 18), once a day at
 * an hour, or once a week on a weekday at an hour.
 */
export const PROMPT_SCHEDULES = ["hourly", "6h", "daily", "weekly"] as const;

export type PromptSchedule = (typeof PROMPT_SCHEDULES)[number];

/**
 * The weekdays a weekly schedule names, `getUTCDay` order: `sun` is 0.
 */
export const PROMPT_WEEKDAYS = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
] as const;

/**
 * What a triggered run checks first (#Q4277): it starts only when one of
 * the listed sources holds something to do, so an idle project spends no
 * tokens. A run by hand ignores it.
 */
export const PROMPT_CHECKS = ["feedback", "errors", "quests", "epics"] as const;

export type PromptCheck = (typeof PROMPT_CHECKS)[number];

/**
 * The tag that keeps a quest from an agent working it alone (#E172): an
 * event never fills a `quest` arg with a quest carrying it.
 */
export const PROMPT_NEEDS_HUMAN_TAG = "needs-human";
