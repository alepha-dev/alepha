/*
 * Browser-loadable: the Prompts section, the CLI and the server read these,
 * and a web file may not load the entity's service (#E174).
 */

/**
 * The item types a prompt's arg takes (#Q4274). A `member` arg also means
 * "email the run's final reply to this member" (#Q4278).
 */
export const PROMPT_ARG_TYPES = [
  "epic",
  "quest",
  "feedback",
  "pullRequest",
  "member",
] as const;

export type PromptArgType = (typeof PROMPT_ARG_TYPES)[number];

/**
 * The statuses each item type answers, which an arg's accepted list is
 * checked against when it is saved. A pull request and a member have none,
 * so their args take no list.
 */
export const PROMPT_ARG_STATUSES: Record<PromptArgType, readonly string[]> = {
  epic: ["draft", "ready", "in_progress", "completed"],
  quest: ["todo", "in_progress", "on_hold", "completed", "shelved"],
  feedback: ["pending", "accepted", "rejected"],
  pullRequest: [],
  member: [],
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
 * A custom prompt's run time (#E174): no column and no setting.
 */
export const PROMPT_CUSTOM_TIMEOUT_SECONDS = 30 * 60;
