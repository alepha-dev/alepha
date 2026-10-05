import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useMemo } from "react";

import { currentEpicsAtom } from "../../../atoms/currentEpicsAtom.ts";
import type {
  DashboardPickerContext,
  DashboardScopeOption,
} from "../../../registries/DashboardPickerRegistry.ts";
import type { I18n } from "../../../services/I18n.ts";
import { STATUS_LABEL_KEYS } from "./epicStatus.ts";

/**
 * The epics a dashboard card can be scoped to, registered by `WorkShell` on
 * core's `DashboardPickerRegistry` (#E75, #Q2624).
 *
 * ⚠️ Read, never fetched. The `project` route loader already issues
 * `getEpicRefs` inside the one `Promise.all` the browser coalesces into a
 * single `/api/_batch`, so the picker costs the dashboard no request at all.
 */
export const useDashboardEpicOptions = (
  // Unread: the atom is the open project's, which is the only board this
  // picker is reached from.
  _context: DashboardPickerContext,
): DashboardScopeOption[] => {
  const { tr } = useI18n<I18n, "en">();
  const [epics] = useStore(currentEpicsAtom);

  return useMemo(
    () =>
      (epics ?? []).map((epic) => ({
        id: epic.id,
        prefix: `#${epic.number}`,
        label: epic.title,
        detail: tr(STATUS_LABEL_KEYS[epic.status]),
      })),
    [epics, tr],
  );
};
