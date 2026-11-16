import { Button, useDialog } from "@alepha/ui";
import { MarkdownView } from "@alepha/ui/markdown";
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
import { FileText, History, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";

import type { PersonaController } from "../../../../api/controllers/PersonaController.ts";
import type { PersonaResource } from "../../../../api/schemas/personaResourceSchema.ts";
import { currentPersonaAtom } from "../../atoms/currentPersonaAtom.ts";
import PersonaAside from "./PersonaAside.tsx";
import PersonaSheet from "./PersonaSheet.tsx";

export interface PersonaPageProps {
  persona: PersonaResource;
}

type TabKey = "overview" | "activity";

/**
 * A persona's page (#E153): a full page outside the Requirements layout
 * (decision 77), its identity card on the left and its tabs. The Use cases,
 * Epics, Requirements, Runs, Changes and Showcase tabs, and Open as and
 * Verify, arrive with the quests that bring what they show.
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

  const tabs: DetailTab[] = [
    {
      value: "overview",
      icon: FileText,
      label: tr("requirements.persona.tab.overview"),
    },
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
        canWrite ? (
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
        ) : undefined
      }
    >
      {tab === "overview" ? (
        <div className="flex flex-col gap-6" data-testid="persona-overview">
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
      ) : (
        <LazyProjectActivityPage
          resource={{ type: "persona", id: String(persona.number) }}
          persistenceKey={`lor.activity.${project.id}.persona.${persona.number}`}
        />
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
