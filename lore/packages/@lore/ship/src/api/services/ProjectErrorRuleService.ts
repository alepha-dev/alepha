import { $repository } from "alepha/orm";

import {
  type ProjectErrorIgnoreRule,
  projectErrorIgnoreRules,
} from "../entities/projectErrorIgnoreRules.ts";

/**
 * Owns the project-wide error ignore rules — the substrings that, when
 * matched against an incoming crash's `message`, drop the event at ingestion.
 *
 * Declaring `$repository(projectErrorIgnoreRules)` here registers the
 * `project_error_ignore_rules` table in the ORM/migration graph (the migration
 * generator scans instantiated repositories — same pattern as
 * {@link SigilIngestService}).
 *
 * Two consumers:
 * - {@link SigilIngestService} — calls {@link listForProject} once per batch
 *   then {@link matches} per error to drop muted messages before they are
 *   recorded.
 * - `ProjectErrorController` — owner CRUD over the rule list.
 */
export class ProjectErrorRuleService {
  protected rules = $repository(projectErrorIgnoreRules);

  /**
   * Every ignore rule for a project, newest first.
   */
  async listForProject(projectId: number): Promise<ProjectErrorIgnoreRule[]> {
    return this.rules.findMany({
      where: { projectId: { eq: projectId } },
      orderBy: [{ column: "createdAt", direction: "desc" }],
    });
  }

  /**
   * Whether `message` matches any rule — case-insensitive substring. A blank
   * message can never match (an empty pattern is rejected at the schema, so
   * the rule list never carries one). Pure: takes the already-loaded rules so
   * the caller controls how often the DB is hit.
   */
  matches(message: string, rules: ProjectErrorIgnoreRule[]): boolean {
    if (!message) {
      return false;
    }
    const haystack = message.toLowerCase();
    return rules.some((rule) => haystack.includes(rule.pattern.toLowerCase()));
  }

  /**
   * Add a rule for a project. The `pattern` is trimmed by the caller; the
   * column's `minLength` guards against an empty value.
   */
  async create(
    projectId: number,
    pattern: string,
    userId: string,
  ): Promise<ProjectErrorIgnoreRule> {
    return this.rules.create({
      projectId,
      pattern,
      createdBy: userId,
    });
  }

  /**
   * Delete a rule, asserting it belongs to the expected project. Returns
   * `false` when the rule does not exist (or belongs to another project) so
   * the controller can map that to a 404 without leaking cross-project rows.
   */
  async deleteForProject(projectId: number, ruleId: number): Promise<boolean> {
    const rule = await this.rules.findOne({
      where: { id: { eq: ruleId }, projectId: { eq: projectId } },
    });
    if (!rule) {
      return false;
    }
    await this.rules.deleteById(rule.id);
    return true;
  }
}
