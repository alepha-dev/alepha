import type {
  DashboardPickerContext,
  DashboardScopeOption,
  I18n,
} from "@lore/core/web";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useMemo } from "react";

import { currentReleasesAtom } from "../../../atoms/currentReleasesAtom.ts";

/**
 * The releases a dashboard card can be scoped to, registered by `WorkShell`
 * on core's `DashboardPickerRegistry` (#E75, #Q2624), read from the
 * project layout's atom like the epics.
 *
 * Published is the load-bearing half of the detail line: a published
 * release is frozen, so its card is finished by definition rather than
 * stale. Saying so here is what stops a reader picking one and reading its
 * unmoving number as a bug.
 */
export const useDashboardReleaseOptions = (
  _context: DashboardPickerContext,
): DashboardScopeOption[] => {
  const { tr } = useI18n<I18n, "en">();
  const [releases] = useStore(currentReleasesAtom);

  return useMemo(
    () =>
      (releases ?? []).map((release) => ({
        id: release.id,
        label: release.tag ?? "",
        detail: tr(
          release.releasedAt
            ? "dashboard.scope.releasePublished"
            : "dashboard.scope.releaseOpen",
        ),
      })),
    [releases, tr],
  );
};
