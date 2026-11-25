import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  useDialog,
} from "@alepha/ui";
import { DetailLayout, type DetailTab, useDetailTab } from "@alepha/ui/shell";
import {
  canInProject,
  currentProjectAtom,
  type I18n,
  LazyProjectActivityPage,
  LoreViewer,
  PinnedPromptsButton,
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
import {
  ExternalLink,
  FileText,
  GitCommitHorizontal,
  History,
  ListChecks,
  Pencil,
  Trash2,
  Video,
} from "lucide-react";
import { useState } from "react";

import type { PersonaController } from "../../../../api/controllers/PersonaController.ts";
import type { PersonaInsightController } from "../../../../api/controllers/PersonaInsightController.ts";
import type { UseCaseController } from "../../../../api/controllers/UseCaseController.ts";
import type {
  PersonaAppCopy,
  PersonaChanges as Changes,
  PersonaShowcase as Showcase,
} from "../../../../api/schemas/personaInsightSchemas.ts";
import type { PersonaResource } from "../../../../api/schemas/personaResourceSchema.ts";
import type { UseCaseResource } from "../../../../api/schemas/useCaseResourceSchema.ts";
import { currentPersonaAtom } from "../../atoms/currentPersonaAtom.ts";
import DetailMoreMenu from "../shared/DetailMoreMenu.tsx";
import RequirementsHover from "../shared/RequirementsHover.tsx";
import WarningNotice from "../shared/WarningNotice.tsx";
import VerifyMenu from "../verify/VerifyMenu.tsx";
import PersonaAside from "./PersonaAside.tsx";
import PersonaChanges from "./PersonaChanges.tsx";
import PersonaSheet from "./PersonaSheet.tsx";
import PersonaShowcase from "./PersonaShowcase.tsx";
import PersonaUseCases from "./PersonaUseCases.tsx";

export interface PersonaPageProps {
  persona: PersonaResource;
}

type TabKey = "overview" | "usecases" | "changes" | "showcase" | "activity";

/**
 * A persona's page (#E153): a full page outside the Requirements layout
 * (decision 77), its identity card on the left and its tabs: Overview (with
 * the Changes card), Use cases (the ones it acts in, #Q3966), Changes (scope changes since its last run, What's new
 * per release), Showcase (hidden while there is no recording) and
 * Activity. Open as opens its app copy in a new tab: Lore signs no one in.
 */
const PersonaPage = (props: PersonaPageProps) => {
  const { tr } = useI18n<I18n, "en">();
  const alepha = useAlepha();
  const dialog = useDialog();
  const [project] = useStore(currentProjectAtom);
  const personaApi = useClient<PersonaController>();
  // A page of this package, named by string.
  const router = useRouter<any>();
  const [persona, setPersona] = useState(props.persona);
  const [tab, setTab] = useDetailTab<TabKey>("overview");
  const [editing, setEditing] = useState(false);
  const insightApi = useClient<PersonaInsightController>();
  const projectId = project?.id ?? 0;
  const params = { projectId, number: props.persona.number };
  const changes = useQuery<Changes>(
    {
      key: ["persona-changes", projectId, props.persona.number],
      enabled: projectId > 0,
      handler: async () => await insightApi.getPersonaChanges({ params }),
    },
    [insightApi, projectId, props.persona.number],
  );
  const appCopy = useQuery<PersonaAppCopy>(
    {
      key: [
        "persona-app-copy",
        projectId,
        props.persona.number,
        persona.environmentApp ?? "",
        persona.environmentEnv ?? "",
      ],
      enabled: projectId > 0,
      handler: async () => await insightApi.getPersonaAppCopy({ params }),
    },
    [
      insightApi,
      projectId,
      props.persona.number,
      persona.environmentApp,
      persona.environmentEnv,
    ],
  );
  // The project's use cases, under the key the lists and the aside read, so
  // the Use cases tab costs no request when either loaded them first.
  const useCaseApi = useClient<UseCaseController>();
  const useCases = useQuery<UseCaseResource[]>(
    {
      key: ["use-cases", projectId],
      enabled: projectId > 0,
      handler: async () =>
        await useCaseApi.getUseCases({ params: { projectId }, query: {} }),
    },
    [useCaseApi, projectId],
  );
  const showcase = useQuery<Showcase>(
    {
      key: ["persona-showcase", projectId, props.persona.number],
      enabled: projectId > 0,
      handler: async () => await insightApi.getPersonaShowcase({ params }),
    },
    [insightApi, projectId, props.persona.number],
  );

  const remove = useAction<[], boolean>(
    {
      handler: async () => {
        const confirmed = await dialog.confirm({
          title: tr("requirements.persona.delete.title"),
          description: tr("requirements.persona.delete.description", {
            args: [persona.name],
          }),
          confirmLabel: tr("requirements.persona.delete.confirm"),
          destructive: true,
        });
        if (!confirmed) return false;
        await personaApi.deletePersona({ params: { id: persona.id } });
        await router.push("projectPersonas", {
          params: { projectSlug: project?.slug ?? "" },
        });
        return true;
      },
      invalidates: [["personas", project?.id ?? 0]],
    },
    [personaApi, persona.id, persona.name, dialog, tr, router, project?.slug],
  );

  if (!project) return null;
  const canWrite = canInProject(project, "persona:write");

  const changed = changes.data?.changes.length ?? 0;
  const mine = (useCases.data ?? []).filter((useCase) =>
    useCase.actors.some((actor) => actor.personaId === persona.id),
  );
  const hasShowcase = (showcase.data ?? []).some((it) => it.items.length);
  const copy = appCopy.data;
  const tabs: DetailTab[] = [
    {
      value: "overview",
      icon: FileText,
      label: tr("requirements.persona.tab.overview"),
    },
    {
      value: "usecases",
      icon: ListChecks,
      label: tr("requirements.persona.tab.useCases", {
        args: [String(mine.length)],
      }),
    },
    {
      value: "changes",
      icon: GitCommitHorizontal,
      label: tr("requirements.persona.tab.changes"),
    },
    ...(hasShowcase
      ? [
          {
            value: "showcase",
            icon: Video,
            label: tr("requirements.persona.tab.showcase"),
          },
        ]
      : []),
    {
      value: "activity",
      icon: History,
      label: tr("requirements.persona.tab.activity"),
    },
  ];

  const sections = [
    {
      key: "who",
      label: tr("requirements.persona.field.who"),
      body: persona.who,
    },
    {
      key: "goals",
      label: tr("requirements.persona.field.goals"),
      body: persona.goals,
    },
    {
      key: "frustrations",
      label: tr("requirements.persona.field.frustrations"),
      body: persona.frustrations,
    },
  ].filter((section) => section.body.trim().length > 0);

  return (
    <DetailLayout
      aside={
        <PersonaAside
          persona={persona}
          onOpenUseCases={() => setTab("usecases")}
        />
      }
      tabs={tabs}
      tab={tab}
      onTabChange={(value) => setTab(value as TabKey)}
      actions={
        <>
          <VerifyMenu subject={{ kind: "persona", number: persona.number }} />
          {/* The prompts pinned on the Persona view (#Q4412), the persona
              filled in. */}
          <PinnedPromptsButton
            page="persona"
            item={{ type: "persona", value: String(persona.number) }}
          />
          {copy?.state === "ready" && copy.url ? (
            <Button
              variant="outlined"
              size="lg"
              title={tr("requirements.persona.openAs.help")}
              onClick={() =>
                window.open(copy.url, "_blank", "noopener,noreferrer")
              }
            >
              <ExternalLink className="size-4" />
              {tr("requirements.persona.openAs", { args: [persona.name] })}
            </Button>
          ) : copy?.state === "production" ? (
            <Button
              variant="outlined"
              size="lg"
              disabled
              title={tr("requirements.persona.openAs.production")}
            >
              <ExternalLink className="size-4" />
              {tr("requirements.persona.openAs", { args: [persona.name] })}
            </Button>
          ) : null}
          {canWrite ? (
            <>
              <Button
                variant="outlined"
                size="lg"
                disabled={remove.loading}
                onClick={() => setEditing(true)}
              >
                <Pencil className="size-4" />
                {tr("requirements.persona.edit")}
              </Button>
              <DetailMoreMenu
                disabled={remove.loading}
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
          ) : null}
        </>
      }
    >
      {tab === "usecases" ? (
        <PersonaUseCases personaId={persona.id} useCases={mine} />
      ) : tab === "activity" ? (
        <LazyProjectActivityPage
          resource={{ type: "persona", id: String(persona.number) }}
          persistenceKey={`lor.activity.${project.id}.persona.${persona.number}`}
        />
      ) : (
        <RequirementsHover className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4">
          {changed > 0 ? (
            <WarningNotice data-testid="scope-changed-banner">
              {tr(
                (changes.data?.toReverify ?? 0) === 1
                  ? "requirements.persona.scopeChanged.one"
                  : "requirements.persona.scopeChanged",
                { args: [String(changes.data?.toReverify ?? 0)] },
              )}
            </WarningNotice>
          ) : null}
          {tab === "overview" ? (
            <div className="flex flex-col gap-4" data-testid="persona-overview">
              {changed > 0 ? (
                <Card data-testid="persona-changes-card">
                  <CardContent className="flex items-center justify-between gap-2 text-sm">
                    <span>
                      {tr(
                        changed === 1
                          ? "requirements.persona.changes.card.one"
                          : "requirements.persona.changes.card",
                        { args: [String(changed)] },
                      )}
                    </span>
                    <Button
                      variant="outlined"
                      onClick={() => setTab("changes")}
                    >
                      {tr("requirements.persona.changes.open")}
                    </Button>
                  </CardContent>
                </Card>
              ) : null}
              {sections.length === 0 ? (
                <p className="text-muted-foreground text-sm italic">
                  {tr("requirements.persona.overview.empty")}
                </p>
              ) : (
                sections.map((section) => (
                  <Card key={section.key}>
                    <CardHeader>
                      <CardTitle>{section.label}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <LoreViewer
                        element={{
                          kind: "persona",
                          projectId: project.id,
                          projectSlug: project.slug,
                          id: persona.id,
                        }}
                        content={section.body}
                      />
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          ) : tab === "changes" ? (
            changes.data ? (
              <PersonaChanges
                name={persona.name}
                number={persona.number}
                changes={changes.data}
              />
            ) : null
          ) : (
            <PersonaShowcase showcase={showcase.data ?? []} />
          )}
        </RequirementsHover>
      )}

      <PersonaSheet
        projectId={project.id}
        persona={persona}
        open={editing}
        onOpenChange={setEditing}
        onSubmit={(saved) => {
          setEditing(false);
          setPersona(saved);
          alepha.store.set(currentPersonaAtom, saved);
        }}
      />
    </DetailLayout>
  );
};

export default PersonaPage;
