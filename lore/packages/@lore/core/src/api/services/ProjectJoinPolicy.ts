import { $env, $inject, z } from "alepha";
import { RankService } from "alepha/api/organizations";
import { $repository } from "alepha/orm";
import { BadRequestError } from "alepha/server";

import { projects } from "../entities/projects.ts";
import { LoreViewerAllowlist } from "../security/LoreViewerAllowlist.ts";
import { ProjectSecurityService } from "./ProjectSecurityService.ts";

/**
 * The rules an open project lives under (epic #E151, folio "Open projects:
 * safety contract").
 *
 * In an open project anyone signed in can join, on the rank keyed `viewer`,
 * so that rank must stay inside the Viewer allowlist for as long as the
 * project is open. It is checked:
 *
 * - when the project is opened ({@link assertCanOpen}),
 * - when Viewer is edited or deleted ({@link assertViewerWrite}, from the
 *   framework's `organization:rank:saving` / `:deleting` hooks, so the rule
 *   holds whichever route writes the rank),
 * - and at every join (#Q3646 calls {@link assertViewerFits}).
 *
 * The check reads the rank's STORED permissions, never the set left after
 * capability narrowing: switching a capability back on must not widen it.
 * Viewer is found by its key, never by its name.
 *
 * ## The launch gate
 *
 * `LORE_OPEN_PROJECTS`, off by default, refuses `open` for every project
 * until #Q3650 turns it on, after the rest of the epic has landed.
 */
export class ProjectJoinPolicy {
  protected readonly ranks = $inject(RankService);
  protected readonly security = $inject(ProjectSecurityService);
  protected readonly projects = $repository(projects);

  protected readonly env = $env(
    z.object({
      /**
       * The launch gate: whether any project may be set to `open`.
       */
      LORE_OPEN_PROJECTS: z.boolean().meta({ secret: false }).optional(),
    }),
  );

  /**
   * The rank key an open project's joiners land on.
   */
  public static readonly VIEWER_KEY = "viewer";

  /**
   * Whether the launch gate is on.
   */
  public launched(): boolean {
    return this.env.LORE_OPEN_PROJECTS === true;
  }

  /**
   * Refuse opening this project unless the gate is on, and the project
   * holds a `viewer` rank that fits the allowlist. The error names the rank
   * and what it holds beyond it.
   */
  public async assertCanOpen(organizationId: string): Promise<void> {
    if (!this.launched()) {
      throw new BadRequestError(
        "Open projects are not available yet on this Lore.",
      );
    }
    const viewer = (await this.ranks.ranksOf(organizationId)).find(
      (rank) => rank.key === ProjectJoinPolicy.VIEWER_KEY,
    );
    if (!viewer) {
      throw new BadRequestError(
        'This project has no Viewer rank (key "viewer"), which is the rank people who join an open project get. Create it before opening the project.',
      );
    }
    this.assertFits(viewer.name, viewer.permissions);
  }

  /**
   * Refuse a stored Viewer that holds more than the allowlist: at a join.
   */
  public async assertViewerFits(organizationId: string): Promise<void> {
    const viewer = (await this.ranks.ranksOf(organizationId)).find(
      (rank) => rank.key === ProjectJoinPolicy.VIEWER_KEY,
    );
    if (!viewer) {
      throw new BadRequestError("This project has no Viewer rank to join on.");
    }
    this.assertFits(viewer.name, viewer.permissions);
  }

  /**
   * The rank hooks' half: while the project is open, a write that widens
   * Viewer past the allowlist, or deletes it, is refused.
   *
   * `permissions` is the set about to be stored, or `undefined` for a
   * delete. A rank other than `viewer`, or a project that is not open, is
   * not this rule's business.
   */
  public async assertViewerWrite(
    organizationId: string,
    key: string,
    permissions: string[] | undefined,
  ): Promise<void> {
    if (key !== ProjectJoinPolicy.VIEWER_KEY) return;
    const project = await this.projects.findOne({
      where: { organizationId: { eq: organizationId } },
    });
    if (!project || this.security.joinPolicyOf(project) !== "open") return;
    if (permissions === undefined) {
      throw new BadRequestError(
        "This project is open: people who join it land on Viewer, so Viewer cannot be deleted while it is open.",
      );
    }
    const extras = LoreViewerAllowlist.extrasOf(permissions);
    if (extras.length) {
      throw new BadRequestError(
        `This project is open, so Viewer holds reads of quests, epics, folios, releases and areas only. It cannot be given ${extras.join(", ")}. Move someone to another rank to give them more.`,
      );
    }
  }

  protected assertFits(name: string, permissions: string[]): void {
    const extras = LoreViewerAllowlist.extrasOf(permissions);
    if (extras.length) {
      throw new BadRequestError(
        `The Viewer rank ("${name}") holds more than an open project allows: ${extras.join(", ")}. Remove them from the rank before opening the project.`,
      );
    }
  }
}
