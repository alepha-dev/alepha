/**
 * The permissions a pipeline's `$secure` middlewares require, as `$secure`
 * enforces them: a string as is, an object permission as `group:name` (or
 * `name` alone when it has no group). Shared by `$tool` and the `$action`
 * tools, so the step-up check before dispatch asks about the same names the
 * middleware will check.
 */
export const securePermissionNames = (
  metadata: ReadonlyArray<{ name: string; options?: unknown }>,
): string[] => {
  const names: string[] = [];
  for (const meta of metadata) {
    if (meta.name !== "$secure") continue;
    const permissions = (meta.options as { permissions?: unknown[] })
      ?.permissions;
    for (const it of permissions ?? []) {
      const name =
        typeof it === "string"
          ? it
          : [
              (it as { group?: unknown } | undefined)?.group,
              (it as { name?: unknown } | undefined)?.name,
            ]
              .filter((part) => typeof part === "string" && part)
              .join(":");
      if (name && !names.includes(name)) {
        names.push(name);
      }
    }
  }
  return names;
};
