import { $inject, z } from "alepha";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";

import { capabilityKeySchema } from "../schemas/capabilityKeySchema.ts";
import { projectResourceSchema } from "../schemas/projectResourceSchema.ts";
import { $ownsProject } from "../security/$ownsProject.ts";
import { CapabilityRegistry } from "../services/CapabilityRegistry.ts";
import { LoreAudits } from "../services/LoreAudits.ts";
import { ProjectResourceMapper } from "../services/ProjectResourceMapper.ts";
import { ProjectSecurityService } from "../services/ProjectSecurityService.ts";

/**
 * The one write path for a project's capabilities.
 *
 * A controller of its own rather than another key on `updateProjectById`,
 * because it writes a different table under a different rule: `projects` is
 * patched field by field, and a capability is a row that exists or does not.
 *
 * ⚠️ **There is no floor.** Every capability may be turned off, the last one
 * included, and a project with no row at all is a legal state rather than an
 * accident: Activity, Members, Settings and the Reports Members tab still
 * answer, every capability-owned read returns nothing instead of throwing, and
 * turning one back on finds every row exactly where it was. That is the test
 * that the modularity is real, and it is the owner's decision (2026-09-06),
 * reversing the review's first reading. The creation wizard keeps its
 * at-least-one rule, because a wizard is asking a question and "none" is not
 * an answer to it; Settings is not asking anything.
 */
export class ProjectCapabilityController {
  protected readonly security = $inject(ProjectSecurityService);
  protected readonly registry = $inject(CapabilityRegistry);
  protected readonly projectMapper = $inject(ProjectResourceMapper);
  protected readonly audits = $inject(LoreAudits);

  /**
   * Declared above the actions on purpose: a `use: [...]` entry reading
   * another field is a field initializer, so a gate declared below its first
   * use is `undefined` at construction time.
   */
  protected ownsAsOwner = () =>
    $ownsProject({ param: "projectId", owner: true });

  /**
   * Turn one capability on or off, and set its options.
   *
   * ⚠️ **`options` are sent whole and replace what was stored**, the rule
   * `kanbanColumnConfig` and `tagColors` already follow. Removing a key is how
   * it is cleared, and a server-side merge has no way to express that. Absent
   * and `false` read alike, so a client that sends the whole map loses
   * nothing by it.
   *
   * ⚠️ **`enabled: false` deletes the row.** A row exists only for an enabled
   * capability; writing a `false` into one would put the same answer in two
   * places, and the two would eventually disagree. The options a disabled
   * capability had are lost, which is the honest reading of "off": the DATA is
   * kept - disabling hides and never deletes a quest or a folio - but the
   * switch positions inside a capability nobody has are not data.
   *
   * The key is the closed enum, so an unknown one is a 400 rather than a
   * silent no-op. So is an unknown OPTION: `createProject`'s body has been
   * `.partial()` since it existed, and its own comment records that a mistyped
   * feature key is accepted and dropped. This is the smallest change that
   * closes it.
   *
   * Answers the full project resource so one round-trip refreshes both
   * `currentProjectAtom` and `userProjectsAtom`, exactly as
   * `updateProjectById` does for the settings pages today.
   */
  setCapability = $action({
    use: [$secure({ permissions: ["project:update"] }), this.ownsAsOwner()],
    method: "PUT",
    path: "/projects/:projectId/capabilities/:key",
    description: "Turn one of a project's capabilities on or off.",
    schema: {
      params: z.object({
        projectId: z.integer(),
        key: capabilityKeySchema,
      }),
      body: z.object({
        enabled: z.boolean(),
        /**
         * The switches inside this capability, sent whole. Ignored when
         * `enabled` is false, since the row is about to go.
         */
        options: z.record(z.text(), z.boolean()).optional(),
      }),
      response: projectResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const project = this.security.projects;
      const existing = await this.security.capabilities.findOne({
        where: {
          projectId: { eq: params.projectId },
          key: { eq: params.key },
        },
      });

      if (!body.enabled) {
        if (existing) {
          await this.security.capabilities.deleteById(existing.id);
        }
      } else {
        // Strict: an unknown option key is refused rather than dropped. The
        // read path stays lax on purpose - see `CapabilityRegistry`.
        const options = this.registry.strictOptionsOf(params.key, body.options);

        if (existing) {
          existing.options = options;
          await this.security.capabilities.save(existing);
        } else {
          await this.security.capabilities.create({
            projectId: params.projectId,
            key: params.key,
            options,
          });
        }
      }

      const row = await project.getOne({
        where: { id: { eq: params.projectId } },
      });

      // `capability`, not `update`: the Activity feed's "what" filter is the
      // action column, and a member looking for when Support was turned off
      // must not have to read every rename to find it. `metadata` carries the
      // key and the new state, which is what the row's details column prints.
      await this.audits.project.logSuccess("capability", {
        ...this.audits.actor(user),
        ...this.audits.scope(params.projectId),
        resourceType: "project",
        resourceId: String(params.projectId),
        description: row.title,
        metadata: { capability: params.key, enabled: body.enabled },
      });

      // Read back rather than assembling from what was just written: the row
      // that exists is the answer, and the repository has already invalidated
      // its table so this is not the stale copy.
      const rows = await this.security.capabilities.findMany({
        where: { projectId: { eq: params.projectId } },
      });

      return this.projectMapper.toResource(row, rows);
    },
  });
}
