import { Button, Card, CardContent, useDialog } from "@alepha/ui";
import { MarkdownView } from "@alepha/ui/markdown";
import { DetailLayout, type DetailTab } from "@alepha/ui/shell";
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
import {
  ClipboardCheck,
  ExternalLink,
  FileText,
  GitCommitHorizontal,
  History,
  Pencil,
  Trash2,
  Video,
} from "lucide-react";
import { useState } from "react";

import type { PersonaController } from "../../../../api/controllers/PersonaController.ts";
import type { PersonaInsightController } from "../../../../api/controllers/PersonaInsightController.ts";
import type {
  PersonaAppCopy,
  PersonaChanges as Changes,
  PersonaShowcase as Showcase,
} from "../../../../api/schemas/personaInsightSchemas.ts";
import type { PersonaResource } from "../../../../api/schemas/personaResourceSchema.ts";
import { currentPersonaAtom } from "../../atoms/currentPersonaAtom.ts";
import VerifyDialog from "../verify/VerifyDialog.tsx";
import PersonaAside from "./PersonaAside.tsx";
import PersonaChanges from "./PersonaChanges.tsx";
import PersonaSheet from "./PersonaSheet.tsx";
import PersonaShowcase from "./PersonaShowcase.tsx";

export interface PersonaPageProps {
  persona: PersonaResource;
}

type TabKey = "overview" | "changes" | "showcase" | "activity";

/**
 * A persona's page (#E153): a full page outside the Requirements layout
 * (decision 77), its identity card on the left and its tabs: Overview (with
 * the Changes card), Changes (scope changes since its last run, What's new
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
  const [tab, setTab] = useState<TabKey>("overview");
  const [editing, setEditing] = useState(false);
  const [verifying, setVerifying] = useState(false);
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
  const hasShowcase = (showcase.data ?? []).some((it) => it.items.length);
  const copy = appCopy.data;
  const tabs: DetailTab[] = [
    {
      value: "overview",
      icon: FileText,
      label: tr("requirements.persona.tab.overview"),
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
      aside={<PersonaAside persona={persona} />}
      tabs={tabs}
      tab={tab}
      onTabChange={(value) => setTab(value as TabKey)}
      actions={
        <>
          <Button size="sm" onClick={() => setVerifying(true)}>
            <ClipboardCheck className="size-4" />
            {tr("requirements.verify")}
          </Button>
          {copy?.state === "ready" && copy.url ? (
            <Button
              variant="outlined"
              size="sm"
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
              size="sm"
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
                size="sm"
                onClick={() => setEditing(true)}
              >
                <Pencil className="size-4" />
                {tr("requirements.persona.edit")}
              </Button>
              <Button
                variant="outlined"
                size="sm"
                disabled={remove.loading}
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
      {changed > 0 ? (
        <div
          className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950"
          data-testid="scope-changed-banner"
        >
          {tr("requirements.persona.scopeChanged", {
            args: [String(changes.data?.toReverify ?? 0)],
          })}
        </div>
      ) : null}
      {tab === "overview" ? (
        <div className="flex flex-col gap-6" data-testid="persona-overview">
          {changed > 0 ? (
            <Card data-testid="persona-changes-card">
              <CardContent className="flex items-center justify-between gap-2 text-sm">
                <span>
                  {tr("requirements.persona.changes.card", {
                    args: [String(changed)],
                  })}
                </span>
                <Button
                  variant="outlined"
                  size="sm"
                  onClick={() => setTab("changes")}
                >
                  {tr("requirements.persona.changes.open")}
                </Button>
              </CardContent>
            </Card>
          ) : null}
          {sections.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {tr("requirements.persona.overview.empty")}
            </p>
          ) : (
            sections.map((section) => (
              <section key={section.key} className="flex flex-col gap-2">
                <h2 className="text-sm font-semibold">{section.label}</h2>
                <MarkdownView content={section.body} />
              </section>
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
      ) : tab === "showcase" ? (
        <PersonaShowcase showcase={showcase.data ?? []} />
      ) : (
        <LazyProjectActivityPage
          resource={{ type: "persona", id: String(persona.number) }}
          persistenceKey={`lor.activity.${project.id}.persona.${persona.number}`}
        />
      )}

      <VerifyDialog
        subject={{ kind: "persona", number: persona.number }}
        open={verifying}
        onOpenChange={setVerifying}
      />
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
