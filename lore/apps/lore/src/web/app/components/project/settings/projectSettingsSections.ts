import { type LucideIcon, Settings2, Users } from "lucide-react";

import type { CapabilityKey } from "@/api/schemas/capabilityKeySchema.ts";
import type { ProjectResource } from "@/api/schemas/projectResourceSchema.ts";
import {
  capabilityOption,
  hasCapability,
} from "@/web/app/services/projectCapabilities.ts";
import {
  canInProject,
  type ProjectRankSource,
} from "@/web/app/services/projectRank.ts";

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
   * A rank permission the tab needs. Not a route guard: the page stays
   * reachable by a link somebody already holds, and every write re-checks.
   */
  requires?: string;
}

export interface SettingsSectionDef {
  key: string;
  /**
   * Position in the Settings group, ascending: General 10, Members 20, then
   * each capability's section as its module registers it.
   */
  order: number;
  /**
   * The sidebar's own noun for the section (Quests, Folios, Apps), never the
   * capability's name: the settings group sits under entries saying exactly
   * that, and "Work" beside "Quests" read as two different things.
   */
  labelKey:
    | "project.settings.nav.general"
    | "project.settings.nav.members"
    | "project.menu.quests"
    | "project.menu.folios"
    | "project.menu.apps";
  descriptionKey:
    | "project.settings.section.general"
    | "project.settings.section.members"
    | "project.settings.section.work"
    | "project.settings.section.knowledge"
    | "project.settings.section.apps";
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
 * These are Core's two; each capability's section is its module's, through
 * `ProjectShellRegistry.registerSettings` (#E75, #Q2624).
 *
 * ⚠️ Support has no section. Its master switch is in General and it has no
 * option of its own, so a section would be an empty page. Give it one the
 * day it grows an option.
 */
export const CORE_SETTINGS_SECTIONS: SettingsSectionDef[] = [
  {
    key: "general",
    order: 10,
    labelKey: "project.settings.nav.general",
    descriptionKey: "project.settings.section.general",
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
    ],
  },
  {
    key: "members",
    order: 20,
    labelKey: "project.settings.nav.members",
    descriptionKey: "project.settings.section.members",
    icon: Users,
    tabs: [
      {
        route: "projectSettingsMembers",
        labelKey: "project.settings.nav.members",
      },
      {
        route: "projectSettingsRanks",
        labelKey: "project.settings.nav.ranks",
        requires: "rank:manage",
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
      (!tab.option ||
        !section.capability ||
        capabilityOption(project, section.capability, tab.option)) &&
      (!tab.requires || canInProject(project, tab.requires)),
  );
};
