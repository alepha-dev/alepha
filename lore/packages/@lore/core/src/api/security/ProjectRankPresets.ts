import { $inject } from "alepha";

import type { CapabilityKey } from "../schemas/capabilityKeySchema.ts";
import { CapabilityRegistry } from "../schemas/CapabilityRegistry.ts";
import { LorePermissions } from "./LorePermissions.ts";
import { LoreViewerAllowlist } from "./LoreViewerAllowlist.ts";

/**
 * The two ranks a project is seeded with beside the `owner` and `member`
 * built-ins (#Q3661, epic #E151). Viewer is computed from the capabilities
 * the project actually has; Admin holds everything but `project:delete`
 * (#Q3736). All four are built in since #Q3736: renamable, never deleted.
 *
 * Every project starts with four ranks: owner, admin, member and viewer.
 * Admin and Viewer are seeded as ordinary custom ranks under STABLE keys
 * (`admin`, `viewer`), because an open project's joiners land on the rank
 * keyed `viewer`, found by its key and never by its name.
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
   * The two catalogues, read for their VALUES: a seeded rank's name is
   * resolved once, at creation, in the creator's language.
   *
   * ⚠️ **Loaded with `import()`, and that is not a style choice.** A STATIC
   * import here defeats the lazy dictionaries declared in `I18n.ts`: a
   * module that is both statically and dynamically imported is hoisted into
   * the static graph, and the dynamic import then resolves to the
   * already-loaded copy. The two catalogues are 264 kB of source, and they
   * were in the Worker's EAGER boot graph with no lazy chunk emitted at all -
   * evaluated on every cold isolate to answer two rank names. The browser
   * bundle never showed it, because `api/security` is not in the client
   * graph.
   *
   * Memoised per catalogue, so a sweep seeding two hundred projects loads
   * each one once.
   */
  protected catalogues: Partial<
    Record<"en" | "fr", Promise<Record<string, string>>>
  > = {};

  /**
   * i18n keys for the two names, so a project is seeded in the creator's
   * language rather than in English.
   */
  public static readonly LABEL_KEYS: Record<PresetKey, string> = {
    admin: "rank.preset.admin",
    viewer: "rank.preset.viewer",
  };

  /**
   * Admin is everything except deleting the project (#Q3736), which is the
   * owner's alone. It carries `member:manage`, `rank:manage` and
   * `capability:manage`.
   */
  protected static readonly ADMIN_EXCLUDES = LorePermissions.OWNER_ONLY;

  /**
   * Viewer reads the project's memory and nothing else: the allowlist an
   * open project's joiners are held to (folio "Open projects: safety
   * contract"). Automations, apps, errors, hosts, members' records, reports
   * and feedback are all outside it.
   */
  public static readonly ADMIN: string[] = [
    ...LorePermissions.MEMBER_DEFAULT,
    ...LorePermissions.OWNER_TODAY,
  ].filter((it) => !ProjectRankPresets.ADMIN_EXCLUDES.includes(it));

  protected static readonly VIEWER: string[] = [
    ...LoreViewerAllowlist.PERMISSIONS,
  ];

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
        labelKey: ProjectRankPresets.LABEL_KEYS.admin,
        // NOT narrowed by the enabled capabilities (#Q3736): Admin holds
        // everything, so a capability switched on later is already covered.
        // A permission of a disabled capability grants nothing anyway, since
        // effective access is permission AND capability.
        permissions: ProjectRankPresets.ADMIN,
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
   * would quietly overwrite that rename. `en.ts` and `fr.ts` are plain
   * objects, read here for their values.
   *
   * Falls back to English for any other `Accept-Language`, which is what the
   * rest of the app does.
   *
   * ⚠️ Async because the catalogue is loaded on demand - see `catalogues`.
   */
  public async nameFor(
    preset: ProjectRankPreset,
    language?: string,
  ): Promise<string> {
    const locale = language?.startsWith("fr") ? "fr" : "en";
    this.catalogues[locale] ??=
      locale === "fr"
        ? import("../../web/locales/fr.ts").then((m) => m.default)
        : import("../../web/locales/en.ts").then((m) => m.default);
    const catalogue = await this.catalogues[locale];
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

export type PresetKey = "admin" | "viewer";

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
