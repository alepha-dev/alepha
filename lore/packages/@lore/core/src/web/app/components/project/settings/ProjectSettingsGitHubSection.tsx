import { Badge, Button, CardContent, useDialog } from "@alepha/ui";
import { SettingsSection } from "@alepha/ui/settings";
import { useAction, useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { ExternalLink, GitPullRequest } from "lucide-react";

import type { AdminGitHubController } from "../../../../../api/controllers/AdminGitHubController.ts";
import type { ProjectGitHubController } from "../../../../../api/controllers/ProjectGitHubController.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { loreDocsUrl } from "../../../services/docsUrl.ts";
import type { I18n } from "../../../services/I18n.ts";
import { canInProject } from "../../../services/projectRank.ts";

/**
 * Settings > General's GitHub card (#Q4362): the repository the project is
 * connected to, or the button that installs the instance's App on one.
 *
 * Unavailable while the instance has no GitHub App, with a link to Admin >
 * GitHub for an instance admin. A connection GitHub ended (uninstalled,
 * suspended, repository removed) says so, and offers to connect again.
 */
const ProjectSettingsGitHubSection = () => {
  const { tr } = useI18n<I18n, "en">();
  const [project] = useStore(currentProjectAtom);
  const api = useClient<ProjectGitHubController>();
  const admin = useClient<AdminGitHubController>();
  const dialog = useDialog();
  const projectId = project?.id;
  const canEdit = canInProject(project, "project:update");

  const status = useQuery(
    {
      key: ["project-github", projectId],
      handler: () =>
        api.getProjectGitHub({ params: { projectId: projectId! } }),
      enabled: projectId !== undefined,
    },
    [api, projectId],
  );

  const connect = useAction<[], void>(
    {
      handler: async () => {
        const { url } = await api.getProjectGitHubInstallLink({
          params: { projectId: projectId! },
        });
        window.location.assign(url);
      },
    },
    [api, projectId],
  );

  const disconnect = useAction<[], void>(
    {
      handler: async () => {
        const name = status.data?.connection?.fullName ?? "";
        const sure = await dialog.confirm({
          title: tr("project.github.disconnect.confirm", { args: [name] }),
          confirmLabel: tr("project.github.disconnect"),
          destructive: true,
        });
        if (!sure) return;
        await api.disconnectProjectGitHub({
          params: { projectId: projectId! },
        });
        await status.refetch();
      },
    },
    [api, projectId, status, dialog, tr],
  );

  const reasonOf = (reason: string, name: string): string => {
    const args = { args: [name] };
    if (reason === "uninstalled") {
      return tr("project.github.reason.uninstalled", args);
    }
    if (reason === "suspended") {
      return tr("project.github.reason.suspended", args);
    }
    if (reason === "removed") return tr("project.github.reason.removed", args);
    return tr("project.github.reason.member", args);
  };

  if (!project || !status.data) return null;
  const { available, connection } = status.data;
  const busy = connect.loading || disconnect.loading;

  return (
    <SettingsSection
      id="github"
      title={tr("project.github.title")}
      description={
        <a
          href={loreDocsUrl("project-github")}
          target="_blank"
          rel="noreferrer"
          className="text-primary underline-offset-2 hover:underline"
          data-testid="project-settings-github-guide"
        >
          {tr("project.github.guide")}
        </a>
      }
    >
      <CardContent
        data-testid="project-settings-github"
        className="flex flex-col gap-3 px-4 py-3"
      >
        {connection?.connected ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-col gap-1 text-sm">
              <a
                href={connection.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-medium underline"
                data-testid="project-settings-github-repository"
              >
                <GitPullRequest className="size-4" />
                {connection.fullName}
                <ExternalLink className="size-3" />
              </a>
              <span className="text-muted-foreground">
                {tr("project.github.defaultBranch", {
                  args: [connection.defaultBranch],
                })}
                {connection.connectedBy?.name
                  ? ` · ${tr("project.github.connectedBy", {
                      args: [connection.connectedBy.name],
                    })}`
                  : ""}
              </span>
            </div>
            {canEdit && (
              <Button
                type="button"
                variant="outlined"
                intent="danger"
                disabled={busy}
                onClick={() => disconnect.run()}
                data-testid="project-settings-github-disconnect"
              >
                {tr("project.github.disconnect")}
              </Button>
            )}
          </div>
        ) : !available ? (
          <div
            className="flex flex-wrap items-center justify-between gap-3 text-sm"
            data-testid="project-settings-github-unavailable"
          >
            <span className="text-muted-foreground">
              {tr("project.github.unavailable")}
            </span>
            {admin.getGitHubApp.can() && (
              <a href="/admin/github" className="underline">
                {tr("project.github.unavailable.admin")}
              </a>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-col gap-1 text-sm">
              {!connection && (
                <span className="text-muted-foreground">
                  {tr("project.github.notConnected")}
                </span>
              )}
              {connection?.disconnectReason && (
                <span data-testid="project-settings-github-reason">
                  <Badge variant="tint" tone="warning">
                    {reasonOf(connection.disconnectReason, connection.fullName)}
                  </Badge>
                </span>
              )}
            </div>
            {canEdit && (
              <Button
                type="button"
                disabled={busy}
                onClick={() => connect.run()}
                data-testid="project-settings-github-connect"
              >
                {connection
                  ? tr("project.github.reconnect")
                  : tr("project.github.connect")}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </SettingsSection>
  );
};

export default ProjectSettingsGitHubSection;
