import type {
  PermissionMatrixGroup,
  PermissionMatrixRow,
} from "@alepha/ui/components/permission-matrix/permission-matrix";

import type { CapabilityKey } from "@/api/schemas/capabilityKeySchema.ts";
import { LoreRankBounds } from "@/api/security/LoreRankBounds.ts";
import { capabilityRegistry } from "@/web/app/services/capabilityRegistry.ts";

/**
 * Turning the server's permission catalogue into the rows this project's
 * matrix should show.
 *
 * A module-level function for the same reason `projectCapabilities.ts` is one:
 * it holds no state, reads nothing, and is called from a component that would
 * otherwise have to inject a service to reach a pure mapping. The documented
 * precedents for a module-level const in this repository are `$ownsProject`
 * and `defaultAppInstance`.
 *
 * ## Three filters, and the order matters
 *
 * 1. **`admin:*` never appears.** Those are the framework's instance-wide
 *    permissions. A project's rank editor offering `admin:user:delete` would
 *    be offering something the module refuses on write anyway, and the reader
 *    would have no way to know why.
 * 2. **A group whose capability is off is dropped entirely, not greyed.** A
 *    project without Apps must not show an `app:*` row: a greyed row is a
 *    question the reader cannot answer from this page, and the answer is on a
 *    different page. Core groups - the ones no capability claims - always
 *    show.
 * 3. **Everything left is a row**, with the two locks that make the matrix
 *    honest about what the module will accept.
 */
export class ProjectRankMatrix {
  /**
   * The rows for a project, in catalogue order.
   *
   * `held` is the editor's OWN effective set. The never-widen invariant lives
   * on the module's write path; this surfaces it, so a permission the editor
   * could not grant is not a checkbox that ticks and then fails to save.
   * `["*"]` - an owner - locks nothing.
   */
  public static rowsFor(input: {
    catalogue: PermissionCatalogueGroup[];
    enabled: CapabilityKey[];
    held: readonly string[];
    label: (key: string, fallback: string) => string;
  }): PermissionMatrixGroup[] {
    const groups: PermissionMatrixGroup[] = [];

    for (const group of input.catalogue) {
      // ⚠️ The registry holds every permission the FRAMEWORK declares too -
      // `admin:user:read`, `api-key:create`, `file:read`, `payments:read` -
      // and those are instance-scope: no project rank narrows one, and none
      // of them has a label, so the matrix rendered a section headed
      // `ADMINAVATARCONTROLLER` with a row reading `api-key:create`.
      //
      // A declared group label is what tells Lore's own vocabulary from the
      // framework's, and it is the honest test rather than a name list:
      // labelling a group IS declaring it belongs on this page, and a group
      // with no label has no copy to render even if it were kept.
      if (!group.label) {
        continue;
      }

      const owner = capabilityRegistry.ownerOfPermissionGroup(group.name);
      if (!capabilityRegistry.isOwnerEnabled(owner, input.enabled)) {
        continue;
      }

      const permissions: PermissionMatrixRow[] = group.permissions
        // Application-scope permissions, which no project rank narrows. Not
        // locked but absent: a locked row invites the question "who CAN do
        // this here", and the answer is that it does not happen here at all.
        .filter((it) => !LoreRankBounds.OUT_OF_SCOPE.includes(it.name))
        // ⚠️ The CEILING, dropped for a different reason than the line above
        // and by the same mechanism deliberately (feedback #P2124). These are
        // ungrantable structurally, so their row is a permanently grey,
        // permanently unchecked box in every column: a choice that does not
        // exist, drawn once per rank.
        //
        // ⚠️ ONLY the ceiling. `lockOf` returns `"off"` for two other
        // reasons, and one of them must stay on screen: a permission the
        // EDITOR does not personally hold is locked too, and hiding that
        // would give the matrix a different shape for every reader - an
        // Admin comparing notes with the Owner would see fewer rows with
        // nothing saying why. That lock is informative; this one is not.
        //
        // The FLOOR stays as well. `project:read` is pinned `"on"` and is
        // just as unclickable, but it says something true and useful: every
        // rank can open the project.
        .filter((it) => !LoreRankBounds.OWNER_ONLY.includes(it.name))
        .map((permission) => ({
          name: permission.name,
          label: input.label(permission.label ?? "", permission.name),
          lock: ProjectRankMatrix.lockOf(permission.name, input.held),
        }));

      if (permissions.length > 0) {
        groups.push({
          key: group.name,
          label: input.label(group.label ?? "", group.name),
          permissions,
        });
      }
    }

    return groups;
  }

  /**
   * Which way a row is pinned, if it is.
   *
   * The floor is checked everywhere and the ceiling is checked nowhere; a
   * permission the editor does not hold is pinned the same way the ceiling is,
   * because "you cannot grant this" is the same answer whether the reason is
   * structural or personal. The tooltip that would tell the two apart is not
   * worth a second lock state.
   *
   * ⚠️ The ceiling branch is unreachable from {@link rows}, which now drops
   * those permissions before asking (feedback #P2124). Kept rather than
   * deleted: this function is the answer to "may this be checked", the filter
   * is the answer to "is this worth a row", and collapsing the two would mean
   * a caller that skips the filter renders a checkable `capability:manage`.
   */
  protected static lockOf(
    permission: string,
    held: readonly string[],
  ): "on" | "off" | undefined {
    if (LoreRankBounds.FLOOR.includes(permission)) {
      return "on";
    }
    if (LoreRankBounds.OWNER_ONLY.includes(permission)) {
      return "off";
    }
    return ProjectRankMatrix.holds(held, permission) ? undefined : "off";
  }

  /**
   * The same wildcard reading `RankService.grants` uses, so the editor and the
   * write path agree about what an owner holds.
   */
  protected static holds(held: readonly string[], permission: string): boolean {
    return held.some(
      (granted) =>
        granted === "*" ||
        granted === permission ||
        (granted.endsWith("*") && permission.startsWith(granted.slice(0, -1))),
    );
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * One group as `GET /api/ranks/catalogue` answers it. Declared here rather
 * than imported from the module: the response is a plain shape, and the
 * controller's own schema is not exported to a browser.
 */
export interface PermissionCatalogueGroup {
  name: string;
  label?: string;
  order?: number;
  permissions: Array<{ name: string; label?: string; description?: string }>;
}
