import { AlephaError, type Atom } from "alepha";
import type { ComponentType } from "react";

import {
  CAPABILITY_KEYS,
  type CapabilityKey,
} from "../../../api/schemas/capabilityKeySchema.ts";
import type { ProjectResource } from "../../../api/schemas/projectResourceSchema.ts";
import type { ProjectNavEntry } from "../atoms/projectNavAtom.ts";
import {
  type CapabilityNavEntry,
  CORE_NAV,
  type ProjectShellContext,
} from "../components/project/capabilityNav.ts";
import {
  CORE_SETTINGS_SECTIONS,
  type SettingsSectionDef,
  type SettingsTab,
} from "../components/project/settings/projectSettingsSections.ts";
import { capabilityRegistry } from "../services/capabilityRegistry.ts";
import {
  capabilityOption,
  hasCapability,
} from "../services/projectCapabilities.ts";
import {
  canInProject,
  type ProjectRankSource,
} from "../services/projectRank.ts";

/**
 * The project shell's chrome, as each module declares it (#E75, #Q2624): the
 * sidebar's entries and badges, the Settings sections, the header's create
 * menu, the breadcrumb leaves and the aside pane beside the page.
 *
 * `ProjectView` is core and names no module: it asks this registry. Work,
 * Knowledge and Deploy register from their shell service's constructor
 * (`WorkShell`, `KnowledgeShell`, `DeployShell`), listed in the web module's
 * services because nothing injects them.
 *
 * ⚠️ A badge, an `available` predicate or a breadcrumb reads module state
 * through `ProjectShellContext.get`, never through a hook: the registered
 * entries are called in a loop, and a hook in a loop breaks the rules of
 * hooks. Each declares the atoms it reads in `reads`, and the shell
 * subscribes to all of them once (`useAtomsVersion`).
 */
export class ProjectShellRegistry {
  protected readonly nav = new Map<CapabilityKey, CapabilityNavEntry[]>();
  protected readonly sections: SettingsSectionDef[] = [
    ...CORE_SETTINGS_SECTIONS,
  ];
  protected readonly creates: ProjectCreateItem[] = [];
  protected readonly crumbs: ProjectCrumbContribution[] = [];
  protected readonly asides: ProjectAsideContribution[] = [];
  protected readonly palette: ProjectPaletteContribution[] = [];

  public registerNav(
    capability: CapabilityKey,
    entries: CapabilityNavEntry[],
  ): void {
    if (this.nav.has(capability)) {
      throw new AlephaError(
        `Sidebar entries for '${capability}' are registered twice`,
      );
    }
    this.nav.set(capability, entries);
  }

  public registerSettings(section: SettingsSectionDef): void {
    if (this.sections.some((it) => it.key === section.key)) {
      throw new AlephaError(
        `Settings section '${section.key}' is registered twice`,
      );
    }
    this.sections.push(section);
    this.sections.sort((a, b) => a.order - b.order);
  }

  public registerCreate(item: ProjectCreateItem): void {
    if (this.creates.some((it) => it.key === item.key)) {
      throw new AlephaError(`Create item '${item.key}' is registered twice`);
    }
    this.creates.push(item);
    this.creates.sort((a, b) => a.order - b.order);
  }

  public registerCrumb(crumb: ProjectCrumbContribution): void {
    this.crumbs.push(crumb);
    this.crumbs.sort((a, b) => a.order - b.order);
  }

  public registerAside(aside: ProjectAsideContribution): void {
    this.asides.push(aside);
  }

  /**
   * Palette rows that are not sidebar entries: Deploy's instances, one row
   * per deployed copy.
   */
  public registerPalette(contribution: ProjectPaletteContribution): void {
    this.palette.push(contribution);
  }

  public paletteContributions(): ProjectPaletteContribution[] {
    return this.palette;
  }

  /**
   * Every sidebar entry a capability declares, on or off.
   */
  public navOf(capability: CapabilityKey): CapabilityNavEntry[] {
    return this.nav.get(capability) ?? [];
  }

  /**
   * What the sidebar offers this project and this reader: Core's entries,
   * then each capability's in declaration order, narrowed by the option it
   * hangs off, its own `available` and the reader's rank.
   *
   * Declaration order, not the order the rows came back in: a project's
   * sidebar must not depend on which capability was turned on first.
   *
   * ⚠️ The rank is the last filter, applied to the SAME computation the
   * palette reads through `projectNavAtom`. A second map would be a second
   * answer. An entry leading to a 403 is worse than no entry; never
   * enforcement, though: the page's own loader refuses too.
   */
  public offeredNav(
    project: ShellProject,
    context: ProjectShellContext,
  ): CapabilityNavEntry[] {
    return [
      ...CORE_NAV,
      ...CAPABILITY_KEYS.flatMap((key) =>
        hasCapability(project, key)
          ? this.navOf(key).filter(
              (entry) =>
                (!entry.option ||
                  capabilityOption(project, key, entry.option)) &&
                (!entry.available || entry.available(context)),
            )
          : [],
      ),
    ].filter(
      (entry) => !entry.permission || canInProject(project, entry.permission),
    );
  }

  /**
   * The options that add or remove a sidebar entry, per capability: every
   * `option` an entry hangs off, in declaration order, without repeats.
   *
   * Settings > General > Capabilities shows these under their master switch,
   * and each capability's own settings page shows every OTHER option
   * (#Q2565). Derived rather than listed, so a new entry that hangs off an
   * option moves that option's switch to General by itself.
   */
  public navOptions(capability: CapabilityKey): string[] {
    return [
      ...new Set(
        this.navOf(capability).flatMap((entry) =>
          entry.option ? [entry.option] : [],
        ),
      ),
    ];
  }

  /**
   * The options a capability's own settings page shows: every option it
   * declares except the ones that add a sidebar entry, which General shows.
   */
  public settingsOptions(capability: CapabilityKey): string[] {
    const onNav = this.navOptions(capability);
    return (
      capabilityRegistry
        .all()
        .find((it) => it.key === capability)
        ?.options.map((option) => option.key)
        .filter((option) => !onNav.includes(option)) ?? []
    );
  }

  public settingsSections(): SettingsSectionDef[] {
    return this.sections;
  }

  /**
   * The section a settings route belongs to, and the tab it lights.
   */
  public findSettingsTab(
    routeName: string,
  ): { section: SettingsSectionDef; tab: SettingsTab } | undefined {
    for (const section of this.sections) {
      for (const tab of section.tabs) {
        if (tab.route === routeName || tab.alsoOn?.includes(routeName)) {
          return { section, tab };
        }
      }
    }
    return undefined;
  }

  public createItems(): ProjectCreateItem[] {
    return this.creates;
  }

  public crumbContributions(): ProjectCrumbContribution[] {
    return this.crumbs;
  }

  /**
   * The pane a route draws beside its page, if any.
   */
  public asideFor(routeName: string): ProjectAsideContribution | undefined {
    return this.asides.find((it) => it.routes.includes(routeName));
  }

  /**
   * Every atom a registered badge, predicate or breadcrumb reads: what the
   * shell subscribes to, so a count landing re-renders the sidebar.
   */
  public reads(): Atom<any>[] {
    return [
      ...new Set([
        ...[...this.nav.values()].flat().flatMap((it) => it.reads ?? []),
        ...this.crumbs.flatMap((it) => it.reads ?? []),
        ...this.palette.flatMap((it) => it.reads ?? []),
      ]),
    ];
  }
}

/**
 * The project the shell draws, with the reader's rank on it.
 */
export type ShellProject = ProjectResource & ProjectRankSource;

/**
 * One row of the header's "+" menu.
 */
export interface ProjectCreateItem {
  key: string;
  order: number;
  /**
   * Above the separator. Only New quest: it is what the separator separates
   * the rest from.
   */
  primary?: boolean;
  labelKey: string;
  icon: ComponentType<{ className?: string }>;
  /**
   * ⚠️ Capability AND rank, on every row. A capability says the project does
   * this at all; a rank says whether THIS reader may. A pure function of the
   * project, which carries the reader's rank.
   */
  enabled: (project: ShellProject) => boolean;
  /**
   * Where the row navigates, with the project's slug as the one param.
   */
  route?: string;
  /**
   * What the row opens instead: a dialog or sheet the menu keeps mounted,
   * open while its row is the one picked.
   */
  dialog?: ComponentType<ProjectCreateDialogProps>;
}

export interface ProjectCreateDialogProps {
  project: ShellProject;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * What a breadcrumb or a palette contribution reads: the shell's context,
 * plus how to address a page of this project.
 */
export type ProjectLinkContext = ProjectShellContext & {
  projectSlug: string;
  path: (route: string, params: Record<string, string>) => string;
};

/**
 * One breadcrumb leaf after the section's, for a detail page.
 */
export interface ProjectCrumbContribution {
  order: number;
  reads?: Atom<any>[];
  crumb: (
    context: ProjectLinkContext,
  ) => { label: string; href?: string } | undefined;
}

/**
 * Rows a module adds to the palette beside the sidebar's pages.
 */
export interface ProjectPaletteContribution {
  reads?: Atom<any>[];
  entries: (context: ProjectLinkContext) => ProjectNavEntry[];
}

/**
 * A pane drawn beside the page on some routes: Work's quest log.
 */
export interface ProjectAsideContribution {
  key: string;
  routes: string[];
  /**
   * Rendered before the page, in a row with it. It owns its own width,
   * collapse state and breakpoint.
   */
  component: ComponentType;
}
