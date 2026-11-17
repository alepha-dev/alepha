import {
  Button,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  FilterSlot,
} from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import { canInProject, currentProjectAtom, type I18n } from "@lore/core/web";
import { z } from "alepha";
import { useClient, useQuery, useQueryClient, useStore } from "alepha/react";
import { useForm, useFormValues } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { Plus, Search, SearchX, Shapes, UsersRound } from "lucide-react";
import { useState } from "react";

import type { PersonaController } from "../../../../api/controllers/PersonaController.ts";
import type { UseCaseController } from "../../../../api/controllers/UseCaseController.ts";
import { personaKindSchema } from "../../../../api/schemas/personaKindSchema.ts";
import type { PersonaResource } from "../../../../api/schemas/personaResourceSchema.ts";
import type { UseCaseResource } from "../../../../api/schemas/useCaseResourceSchema.ts";
import PersonaCard from "../personas/PersonaCard.tsx";
import { PERSONA_KIND_LABEL_KEYS } from "../personas/personaKindLabels.ts";
import PersonaSheet from "../personas/PersonaSheet.tsx";
import GuideLink from "../shared/GuideLink.tsx";
import ListSkeleton from "../shared/ListSkeleton.tsx";
import WarningNotice from "../shared/WarningNotice.tsx";

/**
 * The Personas tab of the Requirements page (#E153): one card per persona
 * under a filter bar shaped like every other list's (a search, a kind filter
 * that starts empty, New persona at its end), and the "To cover" notice
 * (personas with no passing use case, use cases never run). A viewer reads
 * it and sees no write control.
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

  const filters = useForm({
    id: "persona-filters",
    schema: z.object({
      search: z.text().optional(),
      kind: personaKindSchema.optional(),
    }),
    handler: async () => {},
  });
  const values = useFormValues(filters);

  if (!project) return null;
  // The first load only: a refetch keeps the cards on screen.
  if (!personas.data) return <ListSkeleton />;

  const needle = (values.search ?? "").trim().toLowerCase();
  const rows = personas.data.filter(
    (it) =>
      (!values.kind || it.kind === values.kind) &&
      (!needle ||
        `a${it.number} ${it.name} ${it.role ?? ""} ${it.goals}`
          .toLowerCase()
          .includes(needle)),
  );
  const canWrite = canInProject(project, "persona:write");
  const cases = useCases.data ?? [];
  const passing = new Set(
    cases
      .filter((it) => it.state === "passed")
      .flatMap((it) => it.actors.map((a) => a.personaId)),
  );
  const uncovered = personas.data.filter((it) => !passing.has(it.id)).length;
  const neverRun = cases.filter((it) => it.state === "never_run").length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="chrome flex flex-wrap items-center gap-2 border-b p-2">
        <form
          {...filters.props}
          className="flex flex-1 flex-wrap items-center gap-2"
        >
          <FilterSlot>
            <Control
              input={filters.input.search}
              label=""
              icon={Search}
              placeholder={tr("requirements.persona.filter.search")}
              inputProps={{
                className: "h-7 text-sm",
                "aria-label": tr("requirements.persona.filter.search"),
                "data-testid": "persona-search",
              }}
            />
          </FilterSlot>
          <FilterSlot>
            <Control
              input={filters.input.kind}
              label=""
              select
              size="sm"
              clearable
              icon={Shapes}
              placeholder={tr("requirements.persona.filter.anyKind")}
              clearLabel={tr("requirements.persona.filter.anyKind")}
              triggerClassName="w-full"
              inputProps={{
                "aria-label": tr("requirements.persona.field.kind"),
                "data-testid": "persona-kind",
              }}
              items={personaKindSchema.options.map((value) => ({
                value,
                label: tr(PERSONA_KIND_LABEL_KEYS[value]),
              }))}
            />
          </FilterSlot>
        </form>
        {canWrite ? (
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            {tr("project.menu.create-persona")}
          </Button>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        {useCases.data &&
        personas.data.length > 0 &&
        (uncovered > 0 || neverRun > 0) ? (
          <WarningNotice data-testid="to-cover-banner">
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
        {rows.length === 0 ? (
          personas.data.length === 0 ? (
            <Empty data-testid="personas-empty">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <UsersRound />
                </EmptyMedia>
                <EmptyTitle>
                  {tr("requirements.persona.empty.title")}
                </EmptyTitle>
                <EmptyDescription>
                  {tr("requirements.persona.empty")}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                {canWrite ? (
                  <Button onClick={() => setCreating(true)}>
                    <Plus className="size-4" />
                    {tr("project.menu.create-persona")}
                  </Button>
                ) : null}
                <GuideLink guide="plan-personas" />
              </EmptyContent>
            </Empty>
          ) : (
            <Empty data-testid="personas-no-match">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <SearchX />
                </EmptyMedia>
                <EmptyDescription>
                  {tr("requirements.persona.emptyFilter")}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )
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
