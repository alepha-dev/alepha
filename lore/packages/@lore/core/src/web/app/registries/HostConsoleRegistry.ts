import { AlephaError } from "alepha";
import {
  Bot,
  ChartLine,
  Gauge,
  type LucideIcon,
  Settings,
  Terminal,
} from "lucide-react";
import type { ComponentType } from "react";

import type { HostInventoryResource } from "../../../api/schemas/hostInventoryResourceSchema.ts";
import type { ProjectResource } from "../../../api/schemas/projectResourceSchema.ts";

/**
 * What a host's console shows beyond what every host has (#E166, folio
 * #F1537). Core owns the console and its Overview, Commands, Agent and
 * Settings tabs; a module adds tabs (Ship's Processes, the apps on the machine) and
 * sections of the Overview (Ship's stacks), each shown only while its
 * `visible` says so, which is how a project with Ship off sees core's tabs
 * alone.
 *
 * Frozen at first read: every module registers from its constructor, at
 * boot.
 */
export class HostConsoleRegistry {
  protected readonly tabEntries: HostConsoleTab[] = [
    {
      route: "bayOverview",
      labelKey: "bay.nav.overview",
      icon: Gauge,
      order: 10,
    },
    {
      route: "bayCommands",
      labelKey: "bay.nav.commands",
      icon: Terminal,
      order: 30,
    },
    // CPU, memory and disk over a range (#Q4528), out of the Overview.
    {
      route: "bayStats",
      labelKey: "bay.nav.stats",
      icon: ChartLine,
      order: 32,
    },
    // The jobs user's tools and the Agent host switch (#Q4414), out of
    // Settings.
    {
      route: "bayAgent",
      labelKey: "bay.nav.agent",
      icon: Bot,
      order: 35,
    },
    {
      route: "baySettings",
      labelKey: "bay.nav.settings",
      icon: Settings,
      order: 40,
    },
  ];
  protected readonly sectionEntries: HostOverviewSection[] = [];
  protected readonly agentPanelEntries: HostAgentPanel[] = [];
  protected frozen = false;

  public registerTab(tab: HostConsoleTab): void {
    this.assertOpen(tab.route);
    this.tabEntries.push(tab);
  }

  public registerSection(section: HostOverviewSection): void {
    this.assertOpen(section.key);
    this.sectionEntries.push(section);
  }

  /**
   * A panel of the host's Agent tab (#E175, #Q4414): `@lore/prompts`'s
   * Agent host switch, drawn under core's tools of the jobs user.
   */
  public registerAgentPanel(panel: HostAgentPanel): void {
    this.assertOpen(panel.key);
    this.agentPanelEntries.push(panel);
  }

  /**
   * The panels of the host's Agent tab, in order.
   */
  public agentPanels(): readonly HostAgentPanel[] {
    this.frozen = true;
    return [...this.agentPanelEntries].sort((a, b) => a.order - b.order);
  }

  /**
   * The tabs a project's console shows, in order.
   */
  public tabs(project: HostConsoleProject): readonly HostConsoleTab[] {
    this.frozen = true;
    return this.tabEntries
      .filter((tab) => !tab.visible || tab.visible(project))
      .sort((a, b) => a.order - b.order);
  }

  /**
   * Which tab is lit on a route: the tab of that name, or the one whose
   * `activeOn` claims it (an instance page keeps Processes lit).
   */
  public activeTab(project: HostConsoleProject, routeName: string): string {
    const tab = this.tabs(project).find(
      (it) => it.route === routeName || it.activeOn?.(routeName),
    );
    return tab?.route ?? routeName;
  }

  /**
   * The Overview sections a project's console shows, in order.
   */
  public sections(project: HostConsoleProject): readonly HostOverviewSection[] {
    this.frozen = true;
    return this.sectionEntries
      .filter((section) => !section.visible || section.visible(project))
      .sort((a, b) => a.order - b.order);
  }

  protected assertOpen(key: string): void {
    if (this.frozen) {
      throw new AlephaError(
        `Host console entry '${key}' registered after the console was first read`,
      );
    }
  }
}

export interface HostConsoleTab {
  /**
   * The page name, a child of `HostRouter.bay`.
   */
  route: string;
  labelKey: string;
  icon: LucideIcon;
  order: number;
  /**
   * Other routes that keep this tab lit.
   */
  activeOn?: (routeName: string) => boolean;
  visible?: (project: HostConsoleProject) => boolean;
}

export interface HostOverviewSection {
  key: string;
  order: number;
  Component: ComponentType<{
    inventory: HostInventoryResource["inventory"] | undefined;
  }>;
  visible?: (project: HostConsoleProject) => boolean;
}

export interface HostAgentPanel {
  key: string;
  order: number;
  /**
   * Drawn under the job tools; `canUpdate` says whether the viewer may
   * change the host.
   */
  Component: ComponentType<{ canUpdate: boolean }>;
}

/**
 * What a `visible` reads: the console's project, its capabilities above all.
 */
export type HostConsoleProject =
  | Pick<ProjectResource, "capabilities">
  | undefined;
