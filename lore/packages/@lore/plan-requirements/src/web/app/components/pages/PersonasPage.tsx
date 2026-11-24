import {
  Button,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Segmented,
} from "@alepha/ui";
import { canInProject, currentProjectAtom, type I18n } from "@lore/core/web";
import { useClient, useQuery, useQueryClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { Plus, UsersRound } from "lucide-react";
import { useState } from "react";

import type { PersonaController } from "../../../../api/controllers/PersonaController.ts";
import type { UseCaseController } from "../../../../api/controllers/UseCaseController.ts";
import type { PersonaResource } from "../../../../api/schemas/personaResourceSchema.ts";
import type { UseCaseResource } from "../../../../api/schemas/useCaseResourceSchema.ts";
import PersonaCard from "../personas/PersonaCard.tsx";
import { personaCoverage } from "../personas/personaCoverage.ts";
import {
  PERSONA_KIND_ICONS,
  PERSONA_KIND_LABEL_KEYS,
} from "../personas/personaKindLabels.ts";
import PersonaSheet from "../personas/PersonaSheet.tsx";
import PersonasToCover from "../personas/PersonasToCover.tsx";

/**
 * The Personas page (#E153): the "To cover" banner
 * (personas with no passing use case, use cases never run), one card per
 * persona, a kind filter and New persona. A viewer reads it and sees no
 * write control.
 */
const PersonasPage = () => {
  const { tr } = useI18n<I18n, "en">();
  const [project] = useStore(currentProjectAtom);
  const personaApi = useClient<PersonaController>();
  const queries = useQueryClient();
  // Pages of this package, named by string.
  const router = useRouter<any>();
  const [creating, setCreating] = useState(false);
  const [coverHidden, setCoverHidden] = useState(false);
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

  const all = personas.data ?? [];
  const rows = all.filter((it) => kind === "all" || it.kind === kind);
  // Each tab's count, from the list already loaded (#Q3961): one request
  // for the page, never one per tab. Absent while it loads.
  const countOf = (value: typeof kind) =>
    personas.data
      ? value === "all"
        ? all.length
        : all.filter((it) => it.kind === value).length
      : undefined;
  const count = (value: typeof kind) => {
    const n = countOf(value);
    // The space keeps the tab's accessible name "Human 17", not "Human17";
    // a flex row ignores it in layout.
    return n === undefined ? null : (
      <>
        {" "}
        {/* The selected tab's foreground, as the segmented control's own
            count takes it: muted grey on the primary fill read poorly
            (#Q3968). */}
        <span
          className={
            value === kind
              ? "text-primary-foreground tabular-nums"
              : "text-muted-foreground tabular-nums"
          }
          data-testid={`persona-filter-count-${value}`}
        >
          {n}
        </span>
      </>
    );
  };
  const canWrite = canInProject(project, "persona:write");
  const EmptyIcon = kind === "all" ? UsersRound : PERSONA_KIND_ICONS[kind];
  const cases = useCases.data ?? [];
  const passing = new Set(
    cases
      .filter((it) => it.state === "passed")
      .flatMap((it) => it.actors.map((a) => a.personaId)),
  );
  const uncovered = (personas.data ?? []).filter((it) => !passing.has(it.id));
  const neverRun = cases.filter((it) => it.state === "never_run");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="chrome flex flex-wrap items-center gap-3 border-b p-3">
        <Segmented
          variant="solid"
          value={kind}
          onChange={(value) => setKind(value as typeof kind)}
          options={[
            {
              value: "all",
              label: (
                <span className="flex items-center gap-1.5">
                  <UsersRound className="size-3.5" />
                  {tr("requirements.persona.filter.all")}
                  {count("all")}
                </span>
              ),
            },
            ...(["human", "system", "agent"] as const).map((value) => {
              const Icon = PERSONA_KIND_ICONS[value];
              return {
                value,
                label: (
                  <span className="flex items-center gap-1.5">
                    <Icon className="size-3.5" />
                    {tr(PERSONA_KIND_LABEL_KEYS[value])}
                    {count(value)}
                  </span>
                ),
              };
            }),
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
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
        {useCases.data &&
        personas.data &&
        !coverHidden &&
        (uncovered.length > 0 || neverRun.length > 0) ? (
          <PersonasToCover
            projectSlug={project.slug}
            personas={uncovered}
            useCases={neverRun}
            // Hidden until the page is opened again: nothing is stored.
            onDismiss={() => setCoverHidden(true)}
          />
        ) : null}
        {personas.data && rows.length === 0 ? (
          // Centred in the content below the banner: no persona at all, or
          // none of the kind picked, with that kind's glyph.
          <Empty data-testid="personas-empty">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <EmptyIcon />
              </EmptyMedia>
              <EmptyTitle>
                {tr(
                  personas.data.length === 0
                    ? "requirements.persona.empty.title"
                    : "requirements.persona.emptyFilter.title",
                )}
              </EmptyTitle>
              <EmptyDescription>
                {tr(
                  personas.data.length === 0
                    ? "requirements.persona.empty.description"
                    : "requirements.persona.emptyFilter.description",
                )}
              </EmptyDescription>
            </EmptyHeader>
            {personas.data.length === 0 && canWrite ? (
              <EmptyContent>
                <Button onClick={() => setCreating(true)}>
                  <Plus className="size-4" />
                  {tr("project.menu.create-persona")}
                </Button>
              </EmptyContent>
            ) : null}
          </Empty>
        ) : (
          <div
            className="grid gap-4"
            style={{
              // As many 18rem columns as fit, four at most: a column is
              // never narrower than a quarter of the row less its three
              // 1rem gaps, so a fifth never fits however wide the screen.
              gridTemplateColumns:
                "repeat(auto-fill, minmax(max(18rem, calc((100% - 3rem) / 4)), 1fr))",
            }}
          >
            {rows.map((persona) => (
              <PersonaCard
                key={persona.id}
                persona={persona}
                coverage={
                  useCases.data
                    ? personaCoverage(persona, useCases.data)
                    : undefined
                }
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

export default PersonasPage;
