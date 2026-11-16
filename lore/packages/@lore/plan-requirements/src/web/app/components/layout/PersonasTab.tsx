import { Button } from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import { canInProject, currentProjectAtom, type I18n } from "@lore/core/web";
import { z } from "alepha";
import { useClient, useQuery, useQueryClient, useStore } from "alepha/react";
import { useForm, useFormValues } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { Plus } from "lucide-react";
import { useState } from "react";

import type { PersonaController } from "../../../../api/controllers/PersonaController.ts";
import type { PersonaResource } from "../../../../api/schemas/personaResourceSchema.ts";
import PersonaCard from "../personas/PersonaCard.tsx";
import { PERSONA_KIND_LABEL_KEYS } from "../personas/personaKindLabels.ts";
import PersonaSheet from "../personas/PersonaSheet.tsx";

/**
 * The Personas tab of the Requirements page (#E153): one card per persona,
 * a kind filter and New persona. A viewer reads it and sees no write
 * control.
 */
const PersonasTab = () => {
  const { tr } = useI18n<I18n, "en">();
  const [project] = useStore(currentProjectAtom);
  const personaApi = useClient<PersonaController>();
  const queries = useQueryClient();
  // Pages of this package, named by string.
  const router = useRouter<any>();
  const [creating, setCreating] = useState(false);
  const projectId = project?.id ?? 0;

  const personas = useQuery<PersonaResource[]>(
    {
      key: ["personas", projectId],
      enabled: projectId > 0,
      handler: async () =>
        await personaApi.getPersonas({ params: { projectId }, query: {} }),
    },
    [personaApi, projectId],
  );

  const filter = useForm({
    id: "personas-kind",
    schema: z.object({
      kind: z.enum(["all", "human", "system", "agent"]),
    }),
    initialValues: { kind: "all" as const },
    handler: async () => {},
  });
  const { kind } = useFormValues(filter);

  if (!project) return null;

  const rows = (personas.data ?? []).filter(
    (it) => !kind || kind === "all" || it.kind === kind,
  );
  const canWrite = canInProject(project, "persona:write");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b p-3">
        <form {...filter.props}>
          <Control
            input={filter.input.kind}
            segmented
            items={[
              { value: "all", label: tr("requirements.persona.filter.all") },
              ...(["human", "system", "agent"] as const).map((value) => ({
                value,
                label: tr(PERSONA_KIND_LABEL_KEYS[value]),
              })),
            ]}
          />
        </form>
        <div className="flex-1" />
        {canWrite ? (
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            {tr("project.menu.create-persona")}
          </Button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {personas.data && rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {tr(
              personas.data.length === 0
                ? "requirements.persona.empty"
                : "requirements.persona.emptyFilter",
            )}
          </p>
        ) : (
          <div
            className="grid gap-4"
            style={{
              gridTemplateColumns: "repeat(auto-fill, minmax(18rem, 1fr))",
            }}
          >
            {rows.map((persona) => (
              <PersonaCard
                key={persona.id}
                persona={persona}
                href={router.path("projectPersona", {
                  params: {
                    projectSlug: project.slug,
                    personaNumber: String(persona.number),
                  },
                })}
              />
            ))}
          </div>
        )}
      </div>
      <PersonaSheet
        projectId={projectId}
        open={creating}
        onOpenChange={setCreating}
        onSubmit={() => {
          setCreating(false);
          queries.invalidate(["personas", projectId]);
        }}
      />
    </div>
  );
};

export default PersonasTab;
