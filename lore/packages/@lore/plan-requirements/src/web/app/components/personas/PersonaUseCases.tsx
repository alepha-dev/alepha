import { DataTable } from "@alepha/ui/table";
import { currentProjectAtom, formatReference, type I18n } from "@lore/core/web";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";

import type { UseCaseResource } from "../../../../api/schemas/useCaseResourceSchema.ts";
import RunStateBadge from "../usecases/RunStateBadge.tsx";
import { ACTOR_ROLE_LABEL_KEYS } from "../usecases/useCaseLabels.ts";
import UseCasePriorityBadge from "../usecases/UseCasePriorityBadge.tsx";
import UseCaseStatusBadge from "../usecases/UseCaseStatusBadge.tsx";

export interface PersonaUseCasesProps {
  personaId: number;
  /**
   * The use cases this persona acts in, from the project's list.
   */
  useCases: UseCaseResource[];
}

/**
 * The Use cases tab of a persona's page (#Q3966): every use case the persona
 * acts in, with its status, priority, the persona's role in it and its last
 * result, each row opening the use case.
 */
const PersonaUseCases = (props: PersonaUseCasesProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [project] = useStore(currentProjectAtom);
  // A page of this package, named by string.
  const router = useRouter<any>();
  if (!project) return null;

  const hrefOf = (row: UseCaseResource) =>
    router.path("projectUseCase", {
      params: { projectSlug: project.slug, useCaseNumber: String(row.number) },
    });
  const roleOf = (row: UseCaseResource) =>
    row.actors.find((it) => it.personaId === props.personaId)?.role;

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-testid="persona-use-cases"
    >
      {/* Bounded, as the use case list's table is (#Q4209): without
          `min-h-0 flex-1` the table grows to every row and the pane clips
          it, so a persona acting in many use cases could not scroll to
          the last. Its own scroller then keeps the header in view. */}
      <DataTable<UseCaseResource>
        className="min-h-0 flex-1"
        data={props.useCases}
        defaultSize={50}
        hideToolbar
        rowKey={(row) => String(row.id)}
        defaultSort={{ field: "useCase", direction: "asc" }}
        onRowClick={(row) => void router.push(hrefOf(row))}
        emptyState={{ title: tr("requirements.persona.useCases.empty") }}
        columns={{
          useCase: {
            label: tr("requirements.usecase.col.useCase"),
            sortable: true,
            sortValue: (row) => row.number,
            cell: (row) => (
              <Link
                href={hrefOf(row)}
                className="hover:underline"
                data-testid="persona-use-case-row"
                onClick={(event) => event.stopPropagation()}
              >
                <span className="font-semibold">
                  {formatReference("usecase", row.number)}
                </span>{" "}
                {row.title}
              </Link>
            ),
          },
          status: {
            label: tr("requirements.usecase.col.status"),
            cell: (row) => <UseCaseStatusBadge status={row.status} />,
          },
          priority: {
            label: tr("requirements.usecase.field.priority"),
            cell: (row) => <UseCasePriorityBadge priority={row.priority} />,
          },
          role: {
            label: tr("requirements.persona.useCases.role"),
            cell: (row) => {
              const role = roleOf(row);
              return role ? (
                <span className="text-muted-foreground text-xs">
                  {tr(ACTOR_ROLE_LABEL_KEYS[role])}
                </span>
              ) : null;
            },
          },
          lastResult: {
            label: tr("requirements.run.lastResult"),
            cell: (row) => (
              <RunStateBadge state={row.state} stale={row.stale} />
            ),
          },
        }}
      />
    </div>
  );
};

export default PersonaUseCases;
