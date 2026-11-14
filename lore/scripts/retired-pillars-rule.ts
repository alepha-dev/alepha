/**
 * The names #E143 retired: Lore's pillars are Plan, Remember and Ship.
 *
 * - The packages `@lore/work`, `@lore/knowledge` and `@lore/deploy` are
 *   `@lore/plan`, `@lore/remember` and `@lore/ship`, and their modules
 *   `LoreWork*`, `LoreKnowledge*`, `LoreDeployApi|Web|Mcp` (named
 *   `lore.work.api` and so on) are `LorePlan*`, `LoreRemember*`, `LoreShip*`.
 * - The capability keys `work`, `knowledge` and `apps` are `plan`, `remember`
 *   and `ship`, and `support` is the option `plan.feedback`.
 *
 * The type refuses an old key in typed code already. This covers what the
 * compiler does not see: a string in a spec, a fixture, an e2e URL wait, an
 * i18n key, a CLI hint or a guide. It matches an old key only where a
 * capability is unmistakably meant (`capability: "apps"`,
 * `hasCapability(project, "work")`, `/capabilities/knowledge`,
 * `project.capability.support.`), since `apps` and `work` are also plain
 * words and route segments that stay (`/apps`, `lore apps`, the `apps`
 * dashboard slot).
 *
 * "Deploy" stays wherever it names the feature (`DeployLimits`,
 * `lore.deploy.limits`, `deploy:manage`, `deploy_start`, `lore deploy`): only
 * the package and its three modules moved.
 *
 * History may say the old names: the changelog, committed migrations, and
 * the specs that seed a database in its pre-#E143 shape to prove a migration.
 *
 * Read by `scripts/check-conventions.ts` over the whole repository; specified
 * by `scripts/retired-pillars-rule.spec.ts`.
 */
export class RetiredPillarsRule {
  public static readonly PATTERNS: RegExp[] = [
    /@lore\/(work|knowledge|deploy)(?![\w-])/,
    /\bLore(Work|Knowledge|Deploy)(Api|Web|Mcp)\b/,
    /\blore\.(work|knowledge|deploy)\.(api|web|mcp)\b/,
    /\bcapability(Key)?\??:\s*["'`](work|knowledge|apps|support)["'`]/,
    /\b(hasCapability|capabilityOption|assertCapability|setCapability|waitForProjectCapability|optionsOf|strictOptionsOf|preselectedOptionsOf|wizardOptionsOf)\([^()"'`]{0,80}["'`](work|knowledge|apps|support)["'`]/,
    /\bkey:\s*["'`](work|knowledge|support)["'`]/,
    /\bkey:\s*["'`]apps["'`](\s+as const)?,\s*options\b/,
    /\/capabilities\/(work|knowledge|apps|support)\b/,
    /\bproject\.capability\.(work|knowledge|apps|support)\./,
    /\bcapability (enable|disable) (work|knowledge|apps|support)\b/,
  ];

  /**
   * Files that may say the old names: history, the migration specs, and this
   * rule with its spec.
   */
  public static readonly FILES: RegExp[] = [
    /(^|\/)CHANGELOG\.md$/,
    /(^|\/)migrations\//,
    /^lore\/apps\/lore\/test\/(pillar-capability-keys|feedback-into-plan|automations-on-by-default)-migration\.spec\.ts$/,
    /^lore\/scripts\/retired-pillars-rule(\.spec)?\.ts$/,
  ];

  /**
   * The lines of one file that use a retired name, as `path:line: text`.
   */
  public check(file: string, source: string): string[] {
    if (RetiredPillarsRule.FILES.some((pattern) => pattern.test(file))) {
      return [];
    }
    const found: string[] = [];
    source.split("\n").forEach((line, index) => {
      if (!RetiredPillarsRule.PATTERNS.some((pattern) => pattern.test(line))) {
        return;
      }
      found.push(`${file}:${index + 1}: ${line.trim().slice(0, 160)}`);
    });
    return found;
  }
}
