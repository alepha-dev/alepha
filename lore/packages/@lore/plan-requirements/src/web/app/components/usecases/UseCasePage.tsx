import { Button, useDialog } from "@alepha/ui";
import { DetailLayout, type DetailTab } from "@alepha/ui/shell";
import {
  canInProject,
  currentProjectAtom,
  type I18n,
  LazyProjectActivityPage,
} from "@lore/core/web";
import { useAction, useAlepha, useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import {
  CircleCheck,
  PlayCircle,
  FileText,
  History,
  ListTree,
  MessageSquareWarning,
  Pencil,
  Send,
  Trash2,
} from "lucide-react";
import { useState } from "react";

import type { UseCaseController } from "../../../../api/controllers/UseCaseController.ts";
import type { UseCaseResource } from "../../../../api/schemas/useCaseResourceSchema.ts";
import { currentUseCaseAtom } from "../../atoms/currentUseCaseAtom.ts";
import UseCaseAside from "./UseCaseAside.tsx";
import UseCaseCoverage from "./UseCaseCoverage.tsx";
import UseCaseCriteria from "./UseCaseCriteria.tsx";
import UseCaseRuns from "./UseCaseRuns.tsx";
import UseCaseScenario from "./UseCaseScenario.tsx";
import UseCaseSheet from "./UseCaseSheet.tsx";

export interface UseCasePageProps {
  useCase: UseCaseResource;
}

type TabKey = "scenario" | "coverage" | "runs" | "activity";

/**
 * A use case's page (#E153): a full page outside the Requirements layout,
 * its identity card, tabs Scenario (the Steps / Lanes card and the
 * criteria), Coverage and Activity, and its validation: Request validation
 * for a writer, Validated / Changes requested for a holder of
 * `usecase:validate`. Requirements, Runs and History arrive with their
 * quests.
 */
const UseCasePage = (props: UseCasePageProps) => {
  const { tr } = useI18n<I18n, "en">();
  const alepha = useAlepha();
  const dialog = useDialog();
  const [project] = useStore(currentProjectAtom);
  const useCaseApi = useClient<UseCaseController>();
  // A page of this package, named by string.
  const router = useRouter<any>();
  const [useCase, setUseCase] = useState(props.useCase);
  const [tab, setTab] = useState<TabKey>("scenario");
  const [editing, setEditing] = useState(false);

  const apply = (next: UseCaseResource) => {
    setUseCase(next);
    alepha.store.set(currentUseCaseAtom, next);
  };

  const request = useAction<[], void>(
    {
      handler: async () => {
        await useCaseApi.requestUseCaseValidation({
          params: { id: useCase.id },
        });
        apply({ ...useCase, validationRequestedAt: new Date().toISOString() });
      },
    },
    [useCaseApi, useCase],
  );

  const answer = useAction<
    [decision: "validated" | "changes_requested"],
    boolean
  >(
    {
      handler: async (_ctx, decision) => {
        const note = await dialog.prompt({
          title: tr(
            decision === "validated"
              ? "requirements.usecase.validation.validate"
              : "requirements.usecase.validation.changes",
          ),
          description: tr("requirements.usecase.validation.note"),
        });
        if (note === null || note === undefined) return false;
        apply(
          await useCaseApi.validateUseCase({
            params: { id: useCase.id },
            body: { decision, ...(note ? { note } : {}) },
          }),
        );
        return true;
      },
    },
    [useCaseApi, useCase.id, dialog, tr],
  );

  const remove = useAction<[], boolean>(
    {
      handler: async () => {
        const ok = await dialog.confirm({
          title: tr("requirements.usecase.delete.title"),
          description: tr("requirements.usecase.delete.description", {
            args: [useCase.title],
          }),
          confirmLabel: tr("requirements.usecase.delete.confirm"),
          destructive: true,
        });
        if (!ok) return false;
        await useCaseApi.deleteUseCase({ params: { id: useCase.id } });
        await router.push("projectUseCases", {
          params: { projectSlug: project?.slug ?? "" },
        });
        return true;
      },
      invalidates: [["use-cases", project?.id ?? 0]],
    },
    [useCaseApi, useCase.id, useCase.title, dialog, tr, router, project?.slug],
  );

  if (!project) return null;
  const canWrite = canInProject(project, "usecase:write");
  const canValidate = canInProject(project, "usecase:validate");
  const busy = request.loading || answer.loading || remove.loading;

  const tabs: DetailTab[] = [
    {
      value: "scenario",
      icon: ListTree,
      label: tr("requirements.usecase.tab.scenario"),
    },
    {
      value: "coverage",
      icon: FileText,
      label: tr("requirements.usecase.tab.coverage"),
    },
    {
      value: "runs",
      icon: PlayCircle,
      label: tr("requirements.usecase.tab.runs"),
    },
    {
      value: "activity",
      icon: History,
      label: tr("requirements.persona.tab.activity"),
    },
  ];

  return (
    <DetailLayout
      aside={<UseCaseAside useCase={useCase} />}
      tabs={tabs}
      tab={tab}
      onTabChange={(value) => setTab(value as TabKey)}
      actions={
        <>
          {canWrite &&
          useCase.status !== "validated" &&
          useCase.status !== "deprecated" ? (
            <Button
              variant="outlined"
              size="sm"
              disabled={busy}
              onClick={() => void request.run()}
            >
              <Send className="size-4" />
              {tr("requirements.usecase.validation.request")}
            </Button>
          ) : null}
          {canValidate && useCase.status !== "deprecated" ? (
            <>
              <Button
                variant="outlined"
                size="sm"
                disabled={busy}
                onClick={() => void answer.run("validated")}
              >
                <CircleCheck className="size-4" />
                {tr("requirements.usecase.validation.validate")}
              </Button>
              <Button
                variant="outlined"
                size="sm"
                disabled={busy}
                onClick={() => void answer.run("changes_requested")}
              >
                <MessageSquareWarning className="size-4" />
                {tr("requirements.usecase.validation.changes")}
              </Button>
            </>
          ) : null}
          {canWrite ? (
            <>
              <Button
                variant="outlined"
                size="sm"
                disabled={busy}
                onClick={() => setEditing(true)}
              >
                <Pencil className="size-4" />
                {tr("requirements.usecase.edit")}
              </Button>
              <Button
                variant="outlined"
                size="sm"
                disabled={busy}
                onClick={() => void remove.run()}
              >
                <Trash2 className="size-4" />
                {tr("requirements.persona.delete")}
              </Button>
            </>
          ) : null}
        </>
      }
    >
      {useCase.stale && useCase.lastRun ? (
        <div
          className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950"
          data-testid="stale-banner"
        >
          {tr("requirements.run.staleBanner")}
        </div>
      ) : null}
      {tab === "scenario" ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <UseCaseScenario useCase={useCase} />
          <UseCaseCriteria useCase={useCase} />
        </div>
      ) : tab === "coverage" ? (
        <UseCaseCoverage projectId={project.id} useCase={useCase} />
      ) : tab === "runs" ? (
        <UseCaseRuns projectId={project.id} number={useCase.number} />
      ) : (
        <LazyProjectActivityPage
          resource={{ type: "usecase", id: String(useCase.number) }}
          persistenceKey={`lor.activity.${project.id}.usecase.${useCase.number}`}
        />
      )}
      <UseCaseSheet
        projectId={project.id}
        useCase={useCase}
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

export default UseCasePage;
