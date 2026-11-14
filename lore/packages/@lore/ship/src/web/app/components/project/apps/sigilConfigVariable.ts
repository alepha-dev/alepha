import { type SigilConfig, sigilConfig } from "@alepha/lore/sigil";

/**
 * What the reporting module runs with when `SIGIL_CONFIG` is unset: the
 * schema's own defaults, never a copy of them, so a default changed in
 * `@alepha/lore` reaches the form with no edit here.
 */
export const sigilConfigDefaults = (): SigilConfig => sigilConfig.parse({});

/**
 * A stored `SIGIL_CONFIG` read back into switches (#Q3103).
 *
 * `unreadable` covers both ways Lore cannot know what the copy runs with: the
 * value is a secret, stored before the app's build declared the key a
 * variable, so only its prefix comes back; or it does not parse, which the
 * write path refuses now and did not always. Either way the form starts from
 * the defaults and says so, rather than presenting them as the copy's state.
 */
export const readSigilConfigVariable = (
  stored: { kind: "secret" | "variable"; value?: string } | undefined,
): { config: SigilConfig; state: "unset" | "set" | "unreadable" } => {
  if (!stored) {
    return { config: sigilConfigDefaults(), state: "unset" };
  }
  if (stored.kind !== "variable" || stored.value === undefined) {
    return { config: sigilConfigDefaults(), state: "unreadable" };
  }
  try {
    const parsed = sigilConfig.safeParse(JSON.parse(stored.value));
    if (parsed.success) {
      return { config: parsed.data, state: "set" };
    }
  } catch {
    // Not JSON: the same answer as a value the schema refuses.
  }
  return { config: sigilConfigDefaults(), state: "unreadable" };
};

/**
 * The switches as the value to store, or `undefined` when every one is at its
 * default.
 *
 * Only what differs is written, so the variable reads as the decisions an
 * operator made (`{"vitals":false}`) and a default changed later in
 * `@alepha/lore` still reaches a copy that never chose otherwise. All at the
 * default means the variable should not exist at all: the caller removes it.
 */
export const writeSigilConfigVariable = (
  config: SigilConfig,
): string | undefined => {
  const defaults = sigilConfigDefaults();
  const changed: Partial<Record<keyof SigilConfig, unknown>> = {};
  for (const key of Object.keys(defaults) as Array<keyof SigilConfig>) {
    if (JSON.stringify(config[key]) !== JSON.stringify(defaults[key])) {
      changed[key] = config[key];
    }
  }
  return Object.keys(changed).length > 0 ? JSON.stringify(changed) : undefined;
};
