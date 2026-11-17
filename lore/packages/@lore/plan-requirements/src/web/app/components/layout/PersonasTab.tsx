import { Button, Segmented } from "@alepha/ui";
import { canInProject, currentProjectAtom, type I18n } from "@lore/core/web";
import { useClient, useQuery, useQueryClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { Plus } from "lucide-react";
import { useState } from "react";

import type { PersonaController } from "../../../../api/controllers/PersonaController.ts";
import type { UseCaseController } from "../../../../api/controllers/UseCaseController.ts";
import type { PersonaResource } from "../../../../api/schemas/personaResourceSchema.ts";
import type { UseCaseResource } from "../../../../api/schemas/useCaseResourceSchema.ts";
import PersonaCard from "../personas/PersonaCard.tsx";
import { PERSONA_KIND_LABEL_KEYS } from "../personas/personaKindLabels.ts";
import PersonaSheet from "../personas/PersonaSheet.tsx";
import WarningNotice from "../shared/WarningNotice.tsx";

/**
 * The Personas tab of the Requirements page (#E153): the "To cover" banner
 * (personas with no passing use case, use cases never run), one card per
 * persona, a kind filter and New persona. A viewer reads it and sees no
 * write control.
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

  const [kind, setKind] = useState<"all" | "human" | "system" | "agent">("all");

  if (!project) return null;

  const rows = (personas.data ?? []).filter(
    (it) => kind === "all" || it.kind === kind,
  );
  const canWrite = canInProject(project, "persona:write");
  const cases = useCases.data ?? [];
  const passing = new Set(
    cases
      .filter((it) => it.state === "passed")
      .flatMap((it) => it.actors.map((a) => a.personaId)),
  );
  const uncovered = (personas.data ?? []).filter(
    (it) => !passing.has(it.id),
  ).length;
  const neverRun = cases.filter((it) => it.state === "never_run").length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="chrome flex flex-wrap items-center gap-3 border-b p-3">
        <Segmented
          size="sm"
          value={kind}
          onChange={(value) => setKind(value as typeof kind)}
          options={[
            { value: "all", label: tr("requirements.persona.filter.all") },
            ...(["human", "system", "agent"] as const).map((value) => ({
              value,
              label: tr(PERSONA_KIND_LABEL_KEYS[value]),
            })),
          ]}
        />
        <div className="flex-1" />
        {canWrite ? (
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            {tr("project.menu.create-persona")}
          </Button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {useCases.data && personas.data && (uncovered > 0 || neverRun > 0) ? (
          <WarningNotice className="mb-4" data-testid="to-cover-banner">
            {tr("requirements.persona.toCover", {
              args: [
                tr(
                  uncovered === 1
                    ? "requirements.persona.toCover.personas.one"
                    : "requirements.persona.toCover.personas",
                  { args: [String(uncovered)] },
                ),
                tr(
                  neverRun === 1
                    ? "requirements.persona.toCover.useCases.one"
                    : "requirements.persona.toCover.useCases",
                  { args: [String(neverRun)] },
                ),
              ],
            })}
          </WarningNotice>
        ) : null}
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
