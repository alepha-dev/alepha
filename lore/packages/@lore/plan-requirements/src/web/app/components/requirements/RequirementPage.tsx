import { Button, useDialog } from "@alepha/ui";
import { DetailLayout, type DetailTab, useDetailTab } from "@alepha/ui/shell";
import {
  canInProject,
  currentProjectAtom,
  type I18n,
  LazyProjectActivityPage,
} from "@lore/core/web";
import {
  useAction,
  useAlepha,
  useClient,
  useQuery,
  useStore,
} from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { FileText, History, Pencil, Trash2, Waypoints } from "lucide-react";
import { useState } from "react";

import type { RequirementController } from "../../../../api/controllers/RequirementController.ts";
import type { RequirementResource } from "../../../../api/schemas/requirementResourceSchema.ts";
import { currentRequirementAtom } from "../../atoms/currentRequirementAtom.ts";
import DetailMoreMenu from "../shared/DetailMoreMenu.tsx";
import RequirementsHover from "../shared/RequirementsHover.tsx";
import ImpactChain from "../traceability/ImpactChain.tsx";
import RequirementAside from "./RequirementAside.tsx";
import RequirementOverview from "./RequirementOverview.tsx";
import RequirementSheet from "./RequirementSheet.tsx";

export interface RequirementPageProps {
  requirement: RequirementResource;
}

type TabKey = "overview" | "impact" | "activity";

/**
 * A requirement's page (#E153): a full page outside the Requirements
 * layout, as a persona's and a use case's, its identity card on the left
 * (with its Target release) and its tabs: Overview (description, metric,
 * the criteria verifying it, Source changed's Update / Keep), Impact (its
 * chain down to commits, errors and the release) and Activity. It replaced
 * the pane beside the list: every other thing in Lore opens on a page.
 */
const RequirementPage = (props: RequirementPageProps) => {
  const { tr } = useI18n<I18n, "en">();
  const alepha = useAlepha();
  const dialog = useDialog();
  const [project] = useStore(currentProjectAtom);
  const api = useClient<RequirementController>();
  // A page of this package, named by string.
  const router = useRouter<any>();
  const [requirement, setRequirement] = useState(props.requirement);
  const [tab, setTab] = useDetailTab<TabKey>("overview");
  const [editing, setEditing] = useState(false);
  const projectId = project?.id ?? 0;

  const releases = useQuery<
    Array<{ id: number; tag?: string; title?: string }>
  >(
    {
      key: ["requirements-releases", projectId],
      enabled: projectId > 0,
      handler: async () =>
        await api.getRequirementReleases({ params: { projectId } }),
    },
    [api, projectId],
  );

  const apply = (next: RequirementResource) => {
    setRequirement(next);
    alepha.store.set(currentRequirementAtom, next);
  };

  const resync = useAction<[], void>(
    {
      handler: async () => {
        apply(
          await api.resyncRequirementSource({ params: { id: requirement.id } }),
        );
      },
      invalidates: [["requirements", projectId]],
    },
    [api, requirement.id],
  );

  const remove = useAction<[], boolean>(
    {
      handler: async () => {
        const ok = await dialog.confirm({
          title: tr("requirements.requirement.delete.title"),
          description: tr("requirements.requirement.delete.description", {
            args: [requirement.statement],
          }),
          confirmLabel: tr("requirements.requirement.delete.confirm"),
          destructive: true,
        });
        if (!ok) return false;
        await api.deleteRequirement({ params: { id: requirement.id } });
        await router.push("projectRequirements", {
          params: { projectSlug: project?.slug ?? "" },
        });
        return true;
      },
      invalidates: [["requirements", projectId]],
    },
    [
      api,
      requirement.id,
      requirement.statement,
      dialog,
      tr,
      router,
      project?.slug,
    ],
  );

  if (!project) return null;
  const canWrite = canInProject(project, "requirement:write");
  const busy = resync.loading || remove.loading;

  const tabs: DetailTab[] = [
    {
      value: "overview",
      icon: FileText,
      label: tr("requirements.persona.tab.overview"),
    },
    {
      value: "impact",
      icon: Waypoints,
      label: tr("requirements.trace.impact"),
    },
    {
      value: "activity",
      icon: History,
      label: tr("requirements.persona.tab.activity"),
    },
  ];

  return (
    <DetailLayout
      aside={
        <RequirementAside
          requirement={requirement}
          releases={releases.data ?? []}
          onChange={apply}
        />
      }
      tabs={tabs}
      tab={tab}
      onTabChange={(value) => setTab(value as TabKey)}
      actions={
        canWrite ? (
          <>
            <Button
              variant="outlined"
              size="lg"
              disabled={busy}
              onClick={() => setEditing(true)}
            >
              <Pencil className="size-4" />
              {tr("requirements.requirement.edit")}
            </Button>
            <DetailMoreMenu
              disabled={busy}
              items={[
                {
                  key: "delete",
                  icon: Trash2,
                  label: tr("requirements.persona.delete"),
                  destructive: true,
                  onSelect: () => void remove.run(),
                },
              ]}
            />
          </>
        ) : null
      }
    >
      {tab === "activity" ? (
        <LazyProjectActivityPage
          resource={{ type: "requirement", id: String(requirement.number) }}
          persistenceKey={`lor.activity.${project.id}.requirement.${requirement.number}`}
        />
      ) : (
        <RequirementsHover className="min-h-0 flex-1 overflow-auto p-4">
          {tab === "overview" ? (
            <RequirementOverview
              requirement={requirement}
              canWrite={canWrite}
              busy={busy}
              onEdit={() => setEditing(true)}
              onKeep={() => void resync.run()}
            />
          ) : (
            <ImpactChain projectId={projectId} requirement={requirement} />
          )}
        </RequirementsHover>
      )}

      <RequirementSheet
        key={`edit-${requirement.id}`}
        projectId={projectId}
        requirement={requirement}
        open={editing}
        onOpenChange={setEditing}
        onSubmit={(saved) => {
          setEditing(false);
          apply(saved);
        }}
      />
    </DetailLayout>
  );
};

export default RequirementPage;
