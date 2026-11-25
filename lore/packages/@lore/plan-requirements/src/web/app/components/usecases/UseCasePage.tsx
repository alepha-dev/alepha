import { Button, useDialog } from "@alepha/ui";
import { DetailLayout, type DetailTab, useDetailTab } from "@alepha/ui/shell";
import {
  canInProject,
  currentProjectAtom,
  type I18n,
  LazyProjectActivityPage,
  PinnedPromptsButton,
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
import DetailMoreMenu from "../shared/DetailMoreMenu.tsx";
import RequirementsHover from "../shared/RequirementsHover.tsx";
import WarningNotice from "../shared/WarningNotice.tsx";
import VerifyMenu from "../verify/VerifyMenu.tsx";
import UseCaseAiContextPublisher from "./UseCaseAiContextPublisher.tsx";
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
  const [tab, setTab] = useDetailTab<TabKey>("scenario");
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
  const open = useCase.status !== "deprecated";
  const canRequest = canWrite && open && useCase.status !== "validated";

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
    <>
      <UseCaseAiContextPublisher useCase={useCase} />
      <DetailLayout
        aside={<UseCaseAside useCase={useCase} />}
        tabs={tabs}
        tab={tab}
        onTabChange={(value) => setTab(value as TabKey)}
        actions={
          <>
            <VerifyMenu subject={{ kind: "usecase", number: useCase.number }} />
            {/* The prompts pinned on the Use case view (#Q4412), the use
                case filled in, each shown when its arg accepts its status. */}
            <PinnedPromptsButton
              page="use-case"
              item={{
                type: "useCase",
                value: String(useCase.number),
                status: useCase.status,
              }}
            />
            {/* One validation button, the reader's own: a validator
              validates, a writer asks for it. The other verbs are in the
              overflow menu, so the bar never crowds the tabs out. */}
            {canValidate && open ? (
              <Button
                variant="outlined"
                size="lg"
                disabled={busy}
                onClick={() => void answer.run("validated")}
              >
                <CircleCheck className="size-4" />
                {tr("requirements.usecase.validation.validate")}
              </Button>
            ) : canRequest ? (
              <Button
                variant="outlined"
                size="lg"
                disabled={busy}
                onClick={() => void request.run()}
              >
                <Send className="size-4" />
                {tr("requirements.usecase.validation.request")}
              </Button>
            ) : null}
            {canWrite ? (
              <Button
                variant="outlined"
                size="lg"
                disabled={busy}
                onClick={() => setEditing(true)}
              >
                <Pencil className="size-4" />
                {tr("requirements.usecase.edit")}
              </Button>
            ) : null}
            <DetailMoreMenu
              disabled={busy}
              items={[
                ...(canValidate && open
                  ? [
                      {
                        key: "changes",
                        icon: MessageSquareWarning,
                        label: tr("requirements.usecase.validation.changes"),
                        onSelect: () => void answer.run("changes_requested"),
                      },
                    ]
                  : []),
                ...(canValidate && open && canRequest
                  ? [
                      {
                        key: "request",
                        icon: Send,
                        label: tr("requirements.usecase.validation.request"),
                        onSelect: () => void request.run(),
                      },
                    ]
                  : []),
                ...(canWrite
                  ? [
                      {
                        key: "delete",
                        icon: Trash2,
                        label: tr("requirements.persona.delete"),
                        destructive: true,
                        onSelect: () => void remove.run(),
                      },
                    ]
                  : []),
              ]}
            />
          </>
        }
      >
        {tab === "activity" ? (
          <LazyProjectActivityPage
            resource={{ type: "usecase", id: String(useCase.number) }}
            persistenceKey={`lor.activity.${project.id}.usecase.${useCase.number}`}
          />
        ) : (
          <RequirementsHover className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4">
            {useCase.stale && useCase.lastRun ? (
              <WarningNotice data-testid="stale-banner">
                {tr("requirements.run.staleBanner")}
              </WarningNotice>
            ) : null}
            {tab === "scenario" ? (
              <div className="grid gap-4 xl:grid-cols-2">
                <UseCaseScenario useCase={useCase} />
                <UseCaseCriteria useCase={useCase} />
              </div>
            ) : tab === "coverage" ? (
              <UseCaseCoverage projectId={project.id} useCase={useCase} />
            ) : (
              <UseCaseRuns
                projectId={project.id}
                number={useCase.number}
                criteria={useCase.criteria}
              />
            )}
          </RequirementsHover>
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
    </>
  );
};

export default UseCasePage;
