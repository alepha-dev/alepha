import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Switch,
  useDialog,
  useToast,
} from "@alepha/ui";
import { SettingsRow, SettingsSection } from "@alepha/ui/settings";
import {
  useAction,
  useAlepha,
  useClient,
  useQuery,
  useStore,
} from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { Copy, ShieldAlert } from "lucide-react";

import type { ProjectController } from "../../../../../api/controllers/ProjectController.ts";
import type { JoinPolicy } from "../../../../../api/schemas/joinPolicySchema.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { setCurrentProject } from "../../../services/currentProjectWrite.ts";
import type { I18n } from "../../../services/I18n.ts";

/**
 * Whether the project is public: anyone signed in may join it, as a viewer
 * (#Q3645, epic #E151). In Settings ▸ General, as a yes/no switch labelled
 * "Public project" (#Q3747); `joinPolicy` stays `invite` / `open` underneath.
 *
 * Public is offered only when it can be applied: while the launch gate is
 * off the switch is disabled with the reason, and while the Viewer rank
 * holds more than reads of the project's memory the section says so and
 * links to the rank. Making it public is confirmed, since it lets strangers
 * in.
 */
const ProjectSettingsJoinSection = () => {
  const { tr } = useI18n<I18n, "en">();
  const alepha = useAlepha();
  const dialog = useDialog();
  const toaster = useToast();
  // `projectSettingsRanks` is core's own page; the bare router is typed by
  // the registered routers.
  const router = useRouter<any>();
  const projectApi = useClient<ProjectController>();
  const [project] = useStore(currentProjectAtom);
  const current: JoinPolicy = project?.joinPolicy ?? "invite";

  const { data: settings } = useQuery(
    {
      key: ["project-join-settings", project?.id],
      enabled: !!project && projectApi.updateProjectById.can(),
      handler: () =>
        projectApi.getProjectJoinSettings({
          params: { id: project!.id },
        }),
    },
    [projectApi, project?.id],
  );

  const applyAction = useAction<[next: JoinPolicy], void>(
    {
      handler: async (_ctx, next) => {
        if (!project || next === current) return;
        if (next === "open") {
          const confirmed = await dialog.confirm({
            title: tr("project.settings.join.openConfirm.title"),
            description: tr("project.settings.join.openConfirm.description"),
            confirmLabel: tr("project.settings.join.openConfirm.confirm"),
          });
          if (!confirmed) return;
        }
        const updated = await projectApi.updateProjectById({
          params: { id: project.id },
          body: { joinPolicy: next },
        });
        setCurrentProject(alepha, updated);
      },
    },
    [projectApi, alepha, dialog, project, current, tr],
  );

  if (!project || !projectApi.updateProjectById.can()) return null;

  const extras = settings?.viewer?.extras ?? [];
  const blocked = !settings?.launched || !settings.viewer || extras.length > 0;
  const url =
    typeof window === "undefined"
      ? `/${project.slug}`
      : `${window.location.origin}/${project.slug}`;

  return (
    <SettingsSection
      title={tr("project.settings.join.title")}
      description={tr("project.settings.join.description")}
    >
      <SettingsRow
        label={tr("project.settings.join.policy.label")}
        description={
          settings && !settings.launched
            ? tr("project.settings.join.unavailable")
            : tr("project.settings.join.policy.description")
        }
      >
        <Switch
          data-testid="project-join-policy"
          aria-label={tr("project.settings.join.policy.label")}
          checked={current === "open"}
          disabled={applyAction.loading || (current === "invite" && blocked)}
          onCheckedChange={(checked) =>
            void applyAction.run(checked ? "open" : "invite")
          }
        />
      </SettingsRow>

      {settings?.launched && (!settings.viewer || extras.length > 0) && (
        <Alert data-testid="project-join-viewer-wider">
          <ShieldAlert />
          <AlertTitle>
            {settings.viewer
              ? tr("rank.viewer.wider.title", { args: [settings.viewer.name] })
              : tr("project.settings.join.noViewer")}
          </AlertTitle>
          {settings.viewer && (
            <AlertDescription>
              {tr("rank.viewer.wider.description", {
                args: [extras.join(", ")],
              })}
            </AlertDescription>
          )}
          <Button
            size="sm"
            variant="outlined"
            onClick={() =>
              router.push("projectSettingsRanks", {
                params: { projectSlug: project.slug },
              })
            }
          >
            {tr("project.settings.join.toRanks")}
          </Button>
        </Alert>
      )}

      {current === "open" && (
        <SettingsRow
          label={tr("project.settings.join.url.label")}
          description={url}
        >
          <Button
            size="sm"
            variant="outlined"
            aria-label={tr("project.settings.join.url.copy")}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(url);
                toaster.success(tr("project.settings.join.url.copied"));
              } catch (error) {
                toaster.error(
                  error instanceof Error ? error.message : String(error),
                );
              }
            }}
          >
            <Copy />
          </Button>
        </SettingsRow>
      )}
    </SettingsSection>
  );
};

export default ProjectSettingsJoinSection;
