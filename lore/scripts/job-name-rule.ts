/**
 * Every `$job` names itself `[system.]<domain>.<action>`, and `system.` means
 * shipped from a framework package.
 *
 * The name is a job's identity in `job_executions`, so every later fix is a
 * rename that loses history: the shape is checked at boot, and where a job
 * comes from is checked here. A framework job must never collide with an
 * application's, so a job shipped from `packages/` is `system.*` and one
 * shipped from an application is not.
 *
 * ⚠️ **`packages/@lore/` is application code**, not framework. The `@lore/*`
 * packages are Lore split into modules (#E75): their jobs are Lore's, named
 * `<domain>.<action>` since they were written (`quest.reminders`,
 * `blight.purge`...), and requiring `system.` there would force a rename of
 * every one of them, which is exactly the lost history this rule exists to
 * prevent.
 *
 * Read by `scripts/check-conventions.ts`; specified by
 * `scripts/job-name-rule.spec.ts`.
 */
export class JobNameRule {
  public static readonly JOB_NAME =
    /^(system\.)?[a-z0-9]+(-[a-z0-9]+)*\.[a-z0-9]+(-[a-z0-9]+)*$/;

  /**
   * Whether a repository path ships framework code, whose jobs are
   * `system.*`: under `packages/`, except the `@lore` application modules.
   */
  public isFramework(file: string): boolean {
    return file.startsWith("packages/") && !file.startsWith("packages/@lore/");
  }

  /**
   * The naming and timeout violations of every `$job` declared in one file.
   */
  public check(
    file: string,
    source: string,
  ): { names: string[]; timeouts: string[] } {
    const names: string[] = [];
    const timeouts: string[] = [];
    const framework = this.isFramework(file);

    // A declaration is an assignment: `work = $job({`. Prose, JSDoc examples
    // and strings that merely mention `$job({ cron })` never assign it.
    for (const call of source.matchAll(/=\s*\$job\(\{/g)) {
      const open = (call.index ?? 0) + call[0].length;
      let depth = 1;
      let end = open;
      while (depth > 0 && end < source.length) {
        const char = source[end];
        if (char === "{") depth++;
        else if (char === "}") depth--;
        end++;
      }
      // Only the call's own properties: blank every nested object first.
      let top = source.slice(open, end - 1);
      let previous = "";
      while (previous !== top) {
        previous = top;
        top = top.replace(/\{[^{}]*\}/g, "");
      }
      const line = source.slice(0, call.index).split("\n").length;
      const literal = /(?:^|[\n,])\s*name\s*:\s*(["'])([^"'\n]*)\1/.exec(top);
      if (!literal) {
        names.push(
          `  ${file}:${line}\n    → names its job with no string literal; write \`name: "<domain>.<action>"\``,
        );
        continue;
      }
      const name = literal[2];
      if (!JobNameRule.JOB_NAME.test(name)) {
        names.push(
          `  ${file}:${line}\n    → '${name}' is not <domain>.<action> in lowercase kebab-case`,
        );
      } else if (framework && !name.startsWith("system.")) {
        names.push(
          `  ${file}:${line}\n    → '${name}' ships from packages/ and must be system.<domain>.<action>`,
        );
      } else if (!framework && name.startsWith("system.")) {
        names.push(
          `  ${file}:${line}\n    → '${name}' is an application job; system. is reserved for framework packages`,
        );
      }
      // A top-level key only: `top` has every nested object blanked, so a
      // `timeout` passed to a call inside the handler is not the job's.
      if (
        framework &&
        name.startsWith("system.") &&
        !/(?:^|[\n,])\s*timeout\s*:/.test(top)
      ) {
        timeouts.push(`  ${file}:${line}\n    → '${name}' declares no timeout`);
      }
    }

    return { names, timeouts };
  }
}
