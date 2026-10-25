import { Control } from "@alepha/ui/form";
import { z } from "alepha";
import { useStore } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";

import { dashboardWindowAtom } from "../../../atoms/dashboardWindowAtom.ts";
import type { I18n } from "../../../services/I18n.ts";

export interface ProjectDashboardWindowProps {
  /**
   * The reader picked another window: the board resolves once with it.
   */
  onChange: (days: "7" | "14" | "30") => void;
}

/**
 * The board's time window, 7, 14 or 30 days (#Q2661), in the header. One
 * window for every tile, so deltas and sparklines agree; remembered per
 * viewer in `dashboardWindowAtom`, never on the board.
 *
 * A one-field `useForm`, because a field is always a `Control`.
 */
const ProjectDashboardWindow = (props: ProjectDashboardWindowProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [window] = useStore(dashboardWindowAtom);
  const form = useForm({
    schema: z.object({ days: z.enum(["7", "14", "30"]) }),
    initialValues: { days: window.days },
    keepDirty: false,
    handler: async () => {},
    onChange: (_key, next) => props.onChange(next as "7" | "14" | "30"),
  });

  return (
    <Control
      input={form.input.days}
      label=""
      inputProps={{
        "data-testid": "dashboard-window",
        "aria-label": tr("dashboard.window"),
      }}
      triggerClassName="h-9"
      items={(["7", "14", "30"] as const).map((days) => ({
        value: days,
        label: tr("dashboard.window.days", { args: [days] }),
      }))}
    />
  );
};

export default ProjectDashboardWindow;
