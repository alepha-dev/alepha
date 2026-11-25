import { BellRing, Bot, type LucideIcon, Settings2, Users } from "lucide-react";

import type { CapabilityKey } from "../../../../../api/schemas/capabilityKeySchema.ts";
import type { ProjectResource } from "../../../../../api/schemas/projectResourceSchema.ts";
import {
  capabilityOption,
  hasCapability,
} from "../../../services/projectCapabilities.ts";
import {
  canInProject,
  type ProjectRankSource,
} from "../../../services/projectRank.ts";

type ProjectCapabilitySubject = Pick<ProjectResource, "capabilities"> &
  ProjectRankSource;

export interface SettingsTab {
  route: string;
  labelKey: string;
  /**
   * Other routes this tab is lit on: a detail page under a list tab.
   */
  alsoOn?: string[];
  /**
   * An option of the section's capability the tab needs. Absent means the
   * capability alone decides.
   */
  option?: string;
  /**
   * Options of which ANY is enough (#E153). Read instead of `option` when
   * present.
   */
  options?: string[];
  /**
   * A rank permission the tab needs. Not a route guard: the page stays
   * reachable by a link somebody already holds, and every write re-checks.
   */
  requires?: string;
  /**
   * A capability the tab needs besides its section's: a tab one package
   * adds to another's section, such as Ship's Errors tab under Plan
   * (#Q3703), listed only while that capability is on too.
   */
  capability?: CapabilityKey;
  /**
   * The page runs the settings body's full width and height instead of the
   * centred, readable `max-w-6xl` column every page of setting blocks gets.
   * For a page that is one table or matrix wanting the room (Hosts, Ranks).
   * Decided per tab, so the next full-page table cannot widen the others.
   */
  fullWidth?: boolean;
  /**
   * A last say on the project's own state, for a tab no option or permission
   * decides: Plan's Roadmap is listed while `roadmapVisibility` is not off
   * (#Q4060).
   */
  visible?: (project: ProjectResource | undefined) => boolean;
}

export interface SettingsSectionDef {
  key: string;
  /**
   * Position in the Settings group, ascending: General 10, Members 20,
   * Notifications 26, then each capability's section as its module
   * registers it.
   */
  order: number;
  /**
   * The section's name in the Settings group: General, Members,
   * Notifications, then a verb per capability (Plan, Remember).
   */
  labelKey:
    | "project.settings.nav.general"
    | "project.settings.nav.members"
    | "project.settings.nav.notifications"
    | "project.settings.nav.prompts"
    | "project.settings.nav.plan"
    | "project.settings.nav.remember";
  icon: LucideIcon;
  /**
   * The capability the section belongs to. Listed only while it is on: the
   * master switch lives in General, which is always listed.
   */
  capability?: CapabilityKey;
  tabs: SettingsTab[];
}

/**
 * Project settings, one section per child of the sidebar's Settings group
 * and one tab per route (#Q2565, folio #F1352).
 *
 * Replaces the second nav rail `ProjectSettings` drew beside the sidebar:
 * sections go in the sidebar, their pages go in tabs, so the group stays
 * short whatever a section grows.
 *
 * These are Core's three; each capability's section is its module's, through
 * `ProjectShellRegistry.registerSettings` (#E75, #Q2624).
 *
 * Feedback has no section: it is an option of Plan (Support, a capability of
 * its own, until #E143), switched in General under Plan's master.
 */
export const CORE_SETTINGS_SECTIONS: SettingsSectionDef[] = [
  {
    key: "general",
    order: 10,
    labelKey: "project.settings.nav.general",
    icon: Settings2,
    tabs: [
      {
        route: "projectSettingsBanner",
        labelKey: "project.settings.tab.details",
      },
      {
        route: "projectSettingsCapabilities",
        labelKey: "project.settings.tab.capabilities",
      },
      {
        // Core's since #E166: a host works with Ship off, and a project may
        // exist only to store hosts and lend them. It was a tab of Ship's
        // section, which had no other and went with it.
        route: "projectSettingsHosts",
        labelKey: "project.settings.nav.hosts",
        fullWidth: true,
      },
    ],
  },
  {
    key: "members",
    order: 20,
    labelKey: "project.settings.nav.members",
    icon: Users,
    tabs: [
      {
        route: "projectSettingsMembers",
        labelKey: "project.settings.nav.members",
        // The member list carries emails and full records: a custom rank
        // may leave it out.
        requires: "member:read",
      },
      {
        route: "projectSettingsRanks",
        labelKey: "project.settings.nav.ranks",
        requires: "rank:manage",
        fullWidth: true,
      },
    ],
  },
  {
    // Core (#Q3892): who is told about what, on which channel. Every member
    // opens it to manage their own notifications.
    key: "notifications",
    order: 26,
    labelKey: "project.settings.nav.notifications",
    icon: BellRing,
    tabs: [
      {
        route: "projectSettingsNotifications",
        labelKey: "project.settings.tab.notifications",
        fullWidth: true,
      },
      {
        route: "projectSettingsNotificationChannels",
        labelKey: "project.settings.tab.notificationChannels",
        requires: "subscription:read",
        fullWidth: true,
      },
    ],
  },
  {
    // Core (#E174, #Q4280): agent jobs run with Plan and Ship off. Every
    // member opens it: reading and copying a prompt needs no settings
    // permission; `prompt:manage` gates the writes.
    key: "prompts",
    order: 28,
    labelKey: "project.settings.nav.prompts",
    icon: Bot,
    tabs: [
      {
        route: "projectSettingsPrompts",
        labelKey: "project.settings.tab.prompts",
        fullWidth: true,
      },
      {
        // A job belongs to the project, not to a host (#Q4281): no host
        // page lists jobs. Listed with the read its API asks.
        route: "projectSettingsPromptJobs",
        labelKey: "project.settings.tab.jobs",
        requires: "host:read",
        fullWidth: true,
        alsoOn: ["projectJob"],
      },
    ],
  },
];

/**
 * The tabs of a section this project and this reader get. Empty means the
 * section is not listed at all: its capability is off.
 */
export const visibleSettingsTabs = (
  section: SettingsSectionDef,
  project: ProjectCapabilitySubject | undefined,
): SettingsTab[] => {
  if (section.capability && !hasCapability(project, section.capability)) {
    return [];
  }
  return section.tabs.filter(
    (tab) =>
      (!section.capability ||
        (tab.options
          ? tab.options.some((option) =>
              capabilityOption(project, section.capability!, option),
            )
          : !tab.option ||
            capabilityOption(project, section.capability, tab.option))) &&
      (!tab.requires || canInProject(project, tab.requires)) &&
      (!tab.capability || hasCapability(project, tab.capability)) &&
      (!tab.visible || tab.visible(project as ProjectResource | undefined)),
  );
};
