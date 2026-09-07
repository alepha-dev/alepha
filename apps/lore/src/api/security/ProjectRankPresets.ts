import { $inject } from "alepha";

// The two catalogues, imported for their VALUES: a seeded rank's name is
// resolved once, at creation, in the creator's language. Precedent for
// reaching across from the api tree: `ProjectController` imports
// `displayName` from `web/app/services`.
import en from "../../web/locales/en.ts";
import fr from "../../web/locales/fr.ts";
import type { CapabilityKey } from "../schemas/capabilityKeySchema.ts";
import { CapabilityRegistry } from "../services/CapabilityRegistry.ts";
import { LorePermissions } from "./LorePermissions.ts";

/**
 * The three ranks a new project starts with, computed from the capabilities it
 * actually has.
 *
 * ## Why they are templates rather than built-ins
 *
 * A built-in lives in code and cannot be edited (that is what makes it a
 * built-in), so a project whose owner wants "Contributor, but also allowed to
 * publish releases" would have to start from nothing. A preset is a starting
 * POINT: seeded once as an ordinary custom rank, and the owner's from then on.
 *
 * ## Why they are a function of the enabled capability set
 *
 * A Contributor of a Knowledge-only project should not carry `quest:create`.
 * A permission whose group belongs to a capability the project does not have
 * is a checkbox in the matrix that grants nothing and explains nothing, and
 * once seeded it stays there after the capability is turned on, so the
 * omission is not even self-healing.
 *
 * That is also why `createProject` seeds AFTER writing the capability rows and
 * not after the membership row: seeded any earlier, every preset would be
 * computed against a project that has no capabilities yet and come out empty.
 */
export class ProjectRankPresets {
  protected readonly capabilities = $inject(CapabilityRegistry);

  /**
   * i18n keys for the three names, so a project is seeded in the creator's
   * language rather than in English.
   */
  public static readonly LABEL_KEYS: Record<PresetKey, string> = {
    admin: "rank.preset.admin",
    contributor: "rank.preset.contributor",
    viewer: "rank.preset.viewer",
  };

  /**
   * Admin is everything except the two acts that belong to the owner
   * structurally. It carries `member:manage` and `rank:manage`: the owner's
   * decision was that an Admin is everything short of ending the project or
   * changing what the project can do at all.
   */
  protected static readonly ADMIN_EXCLUDES = LorePermissions.OWNER_ONLY;

  /**
   * Contributor writes the work and touches no configuration: no members, no
   * ranks, no settings, no triage.
   */
  protected static readonly CONTRIBUTOR: string[] = [
    "project:read",
    "member:read",
    "stats:read",
    "quest:read",
    "quest:create",
    "quest:update",
    "quest:delete",
    "epic:read",
    "epic:write",
    "release:read",
    "area:read",
    "folio:read",
    "folio:write",
    "app:read",
    "artifact:read",
    "blight:read",
    "quality:read",
    "estate:read",
    "feedback:read",
  ];

  /**
   * Viewer reads. Every `:read` in the vocabulary and nothing else, which is
   * what makes it the rank the epic's own e2e drives: a Viewer who can see a
   * single write control is a bug the whole client half exists to prevent.
   */
  protected static readonly VIEWER: string[] = [
    "project:read",
    "member:read",
    "stats:read",
    "quest:read",
    "epic:read",
    "release:read",
    "area:read",
    "folio:read",
    "app:read",
    "artifact:read",
    "blight:read",
    "quality:read",
    "estate:read",
    "feedback:read",
  ];

  /**
   * The three presets for a project with this capability set.
   *
   * One place, called by both the matrix page's "create from a preset" and by
   * project creation, so the two can never drift into offering different
   * Contributors.
   */
  public presetsFor(enabled: CapabilityKey[]): ProjectRankPreset[] {
    return [
      {
        key: "admin",
        labelKey: ProjectRankPresets.LABEL_KEYS.admin,
        permissions: this.narrow(
          [
            ...LorePermissions.MEMBER_DEFAULT,
            ...LorePermissions.OWNER_TODAY,
          ].filter((it) => !ProjectRankPresets.ADMIN_EXCLUDES.includes(it)),
          enabled,
        ),
      },
      {
        key: "contributor",
        labelKey: ProjectRankPresets.LABEL_KEYS.contributor,
        permissions: this.narrow(ProjectRankPresets.CONTRIBUTOR, enabled),
      },
      {
        key: "viewer",
        labelKey: ProjectRankPresets.LABEL_KEYS.viewer,
        permissions: this.narrow(ProjectRankPresets.VIEWER, enabled),
      },
    ];
  }

  /**
   * The name a seeded rank is stored under, in the creator's language.
   *
   * ⚠️ Resolved ONCE, at creation, and then it is the owner's text: a rank is
   * a thing people rename, so a name that kept following the reader's locale
   * would quietly overwrite that rename. `en.ts` and `fr.ts` are plain objects
   * and the API imports them the way it already imports `displayName` from the
   * web tree.
   *
   * Falls back to English for any other `Accept-Language`, which is what the
   * rest of the app does.
   */
  public nameFor(preset: ProjectRankPreset, language?: string): string {
    const catalogue: Record<string, string> = language?.startsWith("fr")
      ? fr
      : en;
    return catalogue[preset.labelKey] ?? preset.key;
  }

  /**
   * Drop what this project's capabilities do not cover, and keep the floor
   * whatever happens.
   *
   * A permission whose group no capability claims is Core and always kept:
   * `project`, `member`, `rank`, `capability`, `invitation`, `stats` survive a
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

export type PresetKey = "admin" | "contributor" | "viewer";

export interface ProjectRankPreset {
  /**
   * ⚠️ Also the rank's stored KEY when it is seeded, and therefore a stable
   * id: renaming a seeded rank must not move anybody's assignment. The name a
   * person reads comes from {@link labelKey}.
   */
  key: PresetKey;
  labelKey: string;
  permissions: string[];
}
