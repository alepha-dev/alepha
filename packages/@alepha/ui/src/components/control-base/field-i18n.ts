/**
 * Dictionary-driven labels and help text for schema-generated fields.
 *
 * A generated form can only prettify a property name: `reducedFactor` becomes
 * "Reduced Factor", which tells an operator nothing. Given a prefix, every
 * field can instead read a human label from `<prefix>.<field>` and help text
 * from `<prefix>.<field>.desc`, translated like the rest of the app.
 *
 * The prefix is propagated INTO nested objects and array items
 * (`<prefix>.payg.dailyCapCents`), so a deeply structured parameter documents
 * itself all the way down instead of only at the top level.
 *
 * Explicit props always win; a schema `title`/`description` (via `.meta()`)
 * is the fallback when the dictionary has no entry.
 */
export interface FieldI18nProps {
  label?: string;
  description?: string;
}

/**
 * Fill `label`/`description` from the dictionary when the caller left them
 * unset. A missing key makes `tr` echo the key back, so compare against it:
 * an absent entry must leave the field to its schema/pretty-name fallback.
 */
export const resolveFieldI18n = (
  tr: (key: string, options?: { default?: string }) => string,
  prefix: string | undefined,
  name: string,
  current: FieldI18nProps,
): FieldI18nProps => {
  if (!prefix) {
    return current;
  }
  const next: FieldI18nProps = { ...current };

  if (next.label === undefined) {
    const key = `${prefix}.${name}`;
    const label = tr(key, { default: "" });
    if (label && label !== key) {
      next.label = label;
    }
  }

  if (next.description === undefined) {
    const key = `${prefix}.${name}.desc`;
    const description = tr(key, { default: "" });
    if (description && description !== key) {
      next.description = description;
    }
  }

  return next;
};

/** Prefix for a child of `name`: `parameters.x.payg` + `dailyCapCents`. */
export const childI18nPrefix = (
  prefix: string | undefined,
  name: string,
): string | undefined => (prefix ? `${prefix}.${name}` : undefined);
