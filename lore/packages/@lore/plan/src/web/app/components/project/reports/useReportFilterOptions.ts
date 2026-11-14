import {
  currentProjectAtom,
  type DashboardPickerContext,
  type I18n,
  useProjectUsers,
} from "@lore/core/web";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import { currentAreasAtom } from "../../../atoms/currentAreasAtom.ts";
import { useDashboardEpicOptions } from "../epics/useDashboardEpicOptions.ts";
import { useDashboardQuestTags } from "../quest/useDashboardQuestTags.ts";
import { useDashboardReleaseOptions } from "../releases/useDashboardReleaseOptions.ts";

export interface ReportFilterOption {
  value: string;
  label: string;
}

/**
 * The options of the Reports bar's Work filters (#Q2996): the dashboard
 * pickers' hooks and the atoms the project route already holds, so opening
 * Reports costs one more read at most, the tags.
 */
const usePickerContext = () => {
  const [project] = useStore(currentProjectAtom);
  return { projectId: project?.id, open: true } as DashboardPickerContext;
};

export const useReportAreaOptions = (): ReportFilterOption[] => {
  const [areas] = useStore(currentAreasAtom);
  return (areas ?? []).map((area) => ({ value: area.name, label: area.name }));
};

export const useReportEpicOptions = (): ReportFilterOption[] =>
  useDashboardEpicOptions(usePickerContext()).map((epic) => ({
    value: String(epic.id),
    label: epic.label,
  }));

export const useReportReleaseOptions = (): ReportFilterOption[] =>
  useDashboardReleaseOptions(usePickerContext()).map((release) => ({
    value: String(release.id),
    label: release.label,
  }));

export const useReportTagOptions = (): ReportFilterOption[] =>
  useDashboardQuestTags(usePickerContext()).map((tag) => ({
    value: tag,
    label: tag,
  }));

export const useReportPriorityOptions = (): ReportFilterOption[] => {
  const { tr } = useI18n<I18n, "en">();
  return (["high", "medium", "low", "optional"] as const).map((value) => ({
    value,
    label: tr(`dashboard.filterValue.${value}`),
  }));
};

export const useReportMemberOptions = (): ReportFilterOption[] =>
  useProjectUsers().map((user) => ({
    value: user.id,
    label: user.username ?? user.email ?? user.id.slice(0, 8),
  }));
