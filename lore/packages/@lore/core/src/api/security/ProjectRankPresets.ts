import { $inject } from "alepha";

import type { CapabilityKey } from "../schemas/capabilityKeySchema.ts";
import { CapabilityRegistry } from "../schemas/CapabilityRegistry.ts";
import { LorePermissions } from "./LorePermissions.ts";

/**
 * The two ranks a project is seeded with beside the `owner` and `member`
 * built-ins (#Q3661, epic #E151). Viewer is computed from the capabilities
 * the project actually has; Admin holds everything but `project:delete`
 * (#Q3736). All four are built in since #Q3736: renamable, never deleted.
 *
 * Every project starts with four ranks: owner, admin, member and viewer.
 * Admin and Viewer are seeded as ordinary custom ranks under STABLE keys
 * (`admin`, `viewer`), found by their key and never by their name.
 *
 * ## Why they are a function of the enabled capability set
 *
 * A permission whose group belongs to a capability the project does not have
 * is a checkbox in the matrix that grants nothing and explains nothing, and
 * once seeded it stays there after the capability is turned on, so the
 * omission is not even self-healing.
 *
 * That is also why `createProject` seeds AFTER writing the capability rows and
 * not after the membership row: seeded any earlier, every preset would be
 * computed against a project that has no capabilities yet and come out empty.
 *
 * There is no Contributor any more: Member, the built-in holding
 * `LorePermissions.MEMBER_DEFAULT`, covers it. A project that already holds a
 * rank keyed `contributor` keeps it as a custom rank.
 */
export class ProjectRankPresets {
  protected readonly capabilities = $inject(CapabilityRegistry);

  /**
   * The names the two ranks are seeded under: English, whatever the
   * creator's language (#Q3744). They were the creator's language from
   * #Q3593 until the owner decided against it; a rank stays renamable, so a
   * project that wants other names renames them.
   */
  public static readonly NAMES: Record<PresetKey, string> = {
    admin: "Admin",
    viewer: "Viewer",
  };

  /**
   * Admin is everything except deleting the project (#Q3736), which is the
   * owner's alone. It carries `member:manage`, `rank:manage` and
   * `capability:manage`.
   */
  protected static readonly ADMIN_EXCLUDES = LorePermissions.OWNER_ONLY;

  public static readonly ADMIN: string[] = [
    ...LorePermissions.MEMBER_DEFAULT,
    ...LorePermissions.OWNER_TODAY,
  ].filter((it) => !ProjectRankPresets.ADMIN_EXCLUDES.includes(it));

  /**
   * Viewer reads and writes nothing: every `:read` a project grants, the
   * member list, apps, errors, hosts, subscriptions and feedback included
   * (#Q3833). It is the rank an admin gives to someone they invited, so it
   * is trusted with what any member reads. Narrowed to the enabled
   * capabilities like every preset.
   */
  public static readonly VIEWER: string[] = [
    ...LorePermissions.MEMBER_DEFAULT,
    ...LorePermissions.OWNER_TODAY,
  ].filter(
    (it, index, all) => it.endsWith(":read") && all.indexOf(it) === index,
  );

  /**
   * The two presets for a project with this capability set.
   *
   * One place, called by project creation, by the backfill sweep and by the
   * matrix page's "Start from" when the project lacks the rank, so the three
   * can never drift into offering different Viewers.
   */
  public presetsFor(enabled: CapabilityKey[]): ProjectRankPreset[] {
    return [
      {
        key: "admin",
        // NOT narrowed by the enabled capabilities (#Q3736): Admin holds
        // everything, so a capability switched on later is already covered.
        // A permission of a disabled capability grants nothing anyway, since
        // effective access is permission AND capability.
        permissions: ProjectRankPresets.ADMIN,
      },
      {
        key: "viewer",
        permissions: this.narrow(ProjectRankPresets.VIEWER, enabled),
      },
    ];
  }

  /**
   * The name a seeded rank is stored under: English (#Q3744). Stored once,
   * and then it is the owner's text to rename.
   */
  public nameFor(preset: ProjectRankPreset): string {
    return ProjectRankPresets.NAMES[preset.key];
  }

  /**
   * Drop what this project's capabilities do not cover, and keep the floor
   * whatever happens.
   *
   * A permission whose group no capability claims is Core and always kept:
   * `project`, `member`, `rank`, `capability`, `invitation`, `stats` and
   * `host` survive a
   * project with every capability switched off, which is a legal state.
   */
  protected narrow(permissions: string[], enabled: CapabilityKey[]): string[] {
    const kept = permissions.filter((permission) => {
      const owner = this.capabilities.ownerOfPermissionGroup(
        permission.split(":")[0],
      );
      return !owner || enabled.includes(owner);
    });

    // The floor is not narrowable. A rank that cannot open the project is a
    // removal expressed badly, and the module's write path refuses one anyway.
    for (const floor of LorePermissions.FLOOR) {
      if (!kept.includes(floor)) {
        kept.push(floor);
      }
    }

    return kept;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export type PresetKey = "admin" | "viewer";

export interface ProjectRankPreset {
  /**
   * ⚠️ Also the rank's stored KEY when it is seeded, and therefore a stable
   * id: renaming a seeded rank must not move anybody's assignment. The name a
   * person reads comes from {@link ProjectRankPresets.nameFor}.
   */
  key: PresetKey;
  permissions: string[];
}
