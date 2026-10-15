import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { Archive } from "lucide-react";

import type { I18n } from "../../../services/I18n.ts";

export interface ProjectDashboardArchivedProps {
  projectSlug: string;
  /**
   * Where the project's record lives: its folios when it has Knowledge,
   * else its quests when it has Work, else nowhere to point.
   */
  destination?: "projectFolios" | "projectQuests";
}

/**
 * An archived project's root (#Q2662): no board, one notice and the way to
 * what the project kept. Minorca.
 *
 * ⚠️ **Rendered, never redirected.** The owner's ruling on #Q2662: the
 * project root renders at `/` and nothing redirects from it (#156, #2066,
 * see `CoreRouter.projectDashboard`), so the notice links to the folios or
 * the quests instead of sending the reader there.
 */
const ProjectDashboardArchived = (props: ProjectDashboardArchivedProps) => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter();

  return (
    <div
      data-testid="dashboard-archived"
      className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center"
    >
      <Archive className="text-muted-foreground size-8" />
      <h1 className="text-xl font-semibold tracking-[-0.02em]">
        {tr("dashboard.archived.title")}
      </h1>
      <p className="text-muted-foreground max-w-md text-[13.5px]">
        {tr("dashboard.archived.body")}
      </p>
      {props.destination && (
        <Link
          data-testid="dashboard-archived-link"
          href={router.path(
            props.destination as never,
            {
              params: { projectSlug: props.projectSlug },
            } as never,
          )}
          className="text-primary-text text-[13.5px] font-medium hover:underline"
        >
          {tr(
            props.destination === "projectFolios"
              ? "dashboard.archived.folios"
              : "dashboard.archived.quests",
          )}
        </Link>
      )}
    </div>
  );
};

export default ProjectDashboardArchived;
