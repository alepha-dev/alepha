import { Alert, AlertDescription, AlertTitle } from "@alepha/ui";
import type { OrganizationRankController } from "alepha/api/organizations";
import { useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { ShieldAlert, Users } from "lucide-react";

import type { ProjectController } from "../../../../../api/controllers/ProjectController.ts";
import { LoreViewerAllowlist } from "../../../../../api/security/LoreViewerAllowlist.ts";
import type { I18n } from "../../../services/I18n.ts";

export interface ProjectViewerRankNoticeProps {
  organizationId: string;
  projectId: number;
}

/**
 * Flags a `viewer` rank wider than the Viewer allowlist (#Q3661).
 *
 * A project created before every project had the default ranks may hold a
 * Viewer that reads automations, errors or hosts. It is not narrowed
 * silently, since the people it was given to would lose reads, so the ranks
 * page says so and names the extras: a project cannot be opened to everyone
 * signed in until its Viewer fits.
 *
 * Reads the rank list under the editor's own key, so an edit there refreshes
 * this too.
 *
 * Also warns, before any edit, when members who joined by themselves still
 * hold Viewer (#Q3797): closing a project keeps them, and lifts the rule
 * that held Viewer to its allowlist, so widening it widens what those
 * strangers read.
 */
export const ProjectViewerRankNotice = (
  props: ProjectViewerRankNoticeProps,
) => {
  const api = useClient<OrganizationRankController>();
  const { tr } = useI18n<I18n, "en">();
  const { data } = useQuery(
    {
      key: ["organization-ranks", props.organizationId],
      handler: () =>
        api.getOrganizationRanks({
          params: { organizationId: props.organizationId },
        }),
      onError: () => {},
    },
    [api, props.organizationId],
  );

  const projectApi = useClient<ProjectController>();
  const { data: join } = useQuery(
    {
      key: ["project-join-settings", props.projectId],
      enabled: projectApi.getProjectJoinSettings.can(),
      handler: () =>
        projectApi.getProjectJoinSettings({ params: { id: props.projectId } }),
      onError: () => {},
    },
    [projectApi, props.projectId],
  );

  const viewer = data?.items.find((rank) => rank.key === "viewer");
  const extras = viewer ? LoreViewerAllowlist.extrasOf(viewer.permissions) : [];
  const selfJoined = join?.selfJoinedViewers ?? 0;

  return (
    <>
      {viewer && selfJoined > 0 && (
        <Alert data-testid="viewer-rank-self-joined-notice">
          <Users />
          <AlertTitle>{tr("rank.viewer.selfJoined.title")}</AlertTitle>
          <AlertDescription>
            {tr("rank.viewer.selfJoined.description", {
              args: [String(selfJoined)],
            })}
          </AlertDescription>
        </Alert>
      )}
      {viewer && extras.length > 0 && (
        <Alert data-testid="viewer-rank-wider-notice">
          <ShieldAlert />
          <AlertTitle>
            {tr("rank.viewer.wider.title", { args: [viewer.name] })}
          </AlertTitle>
          <AlertDescription>
            {tr("rank.viewer.wider.description", {
              args: [extras.join(", ")],
            })}
          </AlertDescription>
        </Alert>
      )}
    </>
  );
};
