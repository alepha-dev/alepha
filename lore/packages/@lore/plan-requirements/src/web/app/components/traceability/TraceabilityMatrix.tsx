import { Segmented } from "@alepha/ui";
import { formatReference, type I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

import type { PersonaResource } from "../../../../api/schemas/personaResourceSchema.ts";
import type { RequirementResource } from "../../../../api/schemas/requirementResourceSchema.ts";
import type { UseCaseResource } from "../../../../api/schemas/useCaseResourceSchema.ts";
import { formatMetricValue } from "../requirements/metricText.ts";
import ReferenceLink from "../shared/ReferenceLink.tsx";
import MatrixCellDot, { MATRIX_CELL_LABEL_KEYS } from "./MatrixCellDot.tsx";
import {
  personaUseCaseCell,
  requirementEpicCell,
  requirementUseCaseCell,
} from "./matrixCells.ts";

export interface TraceabilityMatrixProps {
  requirements: RequirementResource[];
  useCases: UseCaseResource[];
  personas: PersonaResource[];
  selected?: number;
  onSelect: (number: number) => void;
}

const VIEW_LABEL_KEYS = {
  usecase: "requirements.trace.view.usecase",
  epic: "requirements.trace.view.epic",
  persona: "requirements.trace.view.persona",
} as const;

/**
 * The traceability matrix (#E153, #Q3774), three ways: requirement by use
 * case (the default), requirement by epic, persona by use case, with a
 * Metric column for the requirements a measure verifies. Drawn from the
 * lists the page already reads; a row opens its impact chain.
 */
const TraceabilityMatrix = (props: TraceabilityMatrixProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [view, setView] = useState<"usecase" | "epic" | "persona">("usecase");
  const epics = [
    ...new Map(
      props.requirements
        .flatMap((it) => it.coveringEpics)
        .map((it) => [it.number, it]),
    ).values(),
  ].sort((a, b) => a.number - b.number);
  const metric = props.requirements.some((it) => it.metric);
  const columns =
    view === "epic"
      ? epics.map((it) => ({
          key: it.number,
          head: formatReference("epic", it.number),
          sub: it.title,
        }))
      : props.useCases.map((it) => ({
          key: it.number,
          head: formatReference("usecase", it.number),
          sub: it.actors.map((a) => a.name).join(", "),
        }));

  return (
    // The matrix fills its box and its table is the one scroll area, both
    // ways, with the header row and the first column pinned.
    <div
      className="flex min-h-0 flex-1 flex-col gap-3"
      data-testid="traceability-matrix"
    >
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          size="sm"
          value={view}
          onChange={(value) => setView(value as typeof view)}
          options={(["usecase", "epic", "persona"] as const).map((value) => ({
            value,
            label: tr(VIEW_LABEL_KEYS[value]),
          }))}
        />
        <div className="flex-1" />
        <span className="text-muted-foreground flex flex-wrap items-center gap-3 text-xs">
          {(
            [
              "verified",
              "failing",
              "in_development",
              "stale",
              "never_run",
            ] as const
          ).map((it) => (
            <span key={it} className="flex items-center gap-1">
              <MatrixCellDot state={it} />
              {tr(MATRIX_CELL_LABEL_KEYS[it])}
            </span>
          ))}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="text-muted-foreground bg-background sticky top-0 z-20 text-xs">
            <tr className="border-b">
              <th className="bg-background sticky left-0 z-10 p-2 text-left font-medium">
                {tr(
                  view === "persona"
                    ? "requirements.trace.col.persona"
                    : "requirements.trace.col.requirement",
                )}
              </th>
              {columns.map((it) => (
                <th key={it.key} className="p-2 text-center font-medium">
                  <div className="text-foreground font-semibold">{it.head}</div>
                  <div className="max-w-24 truncate font-normal">{it.sub}</div>
                </th>
              ))}
              {view !== "persona" && metric ? (
                <th className="p-2 text-center font-medium">
                  {tr("requirements.requirement.metric")}
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {view === "persona"
              ? props.personas.map((persona) => (
                  <tr
                    key={persona.id}
                    className="border-b"
                    data-testid="matrix-row"
                  >
                    <td className="bg-background sticky left-0 z-10 p-2">
                      <ReferenceLink kind="persona" number={persona.number}>
                        {persona.name}
                      </ReferenceLink>
                    </td>
                    {props.useCases.map((uc) => (
                      <td key={uc.number} className="p-2 text-center">
                        <MatrixCellDot
                          state={personaUseCaseCell(persona.number, uc)}
                        />
                      </td>
                    ))}
                  </tr>
                ))
              : props.requirements.map((req) => (
                  <tr
                    key={req.id}
                    className={`hover:bg-hover-weak cursor-pointer border-b ${
                      props.selected === req.number ? "bg-hover" : ""
                    }`}
                    data-testid="matrix-row"
                    onClick={() => props.onSelect(req.number)}
                  >
                    <td className="bg-background sticky left-0 z-10 p-2">
                      <ReferenceLink kind="requirement" number={req.number}>
                        {req.statement}
                      </ReferenceLink>
                    </td>
                    {view === "epic"
                      ? epics.map((epic) => (
                          <td key={epic.number} className="p-2 text-center">
                            <MatrixCellDot
                              state={requirementEpicCell(req, epic.number)}
                            />
                          </td>
                        ))
                      : props.useCases.map((uc) => (
                          <td key={uc.number} className="p-2 text-center">
                            <MatrixCellDot
                              state={requirementUseCaseCell(req, uc)}
                            />
                          </td>
                        ))}
                    {metric ? (
                      <td className="p-2 text-center text-xs">
                        {req.metric && req.metricValue !== undefined ? (
                          <span
                            className={`rounded px-1.5 py-0.5 ${
                              req.metricStatus === "verified"
                                ? "bg-success/15 text-success-text"
                                : "bg-danger/15 text-danger-text"
                            }`}
                            data-testid="matrix-metric"
                          >
                            {formatMetricValue(req.metric, req.metricValue)}
                          </span>
                        ) : req.metric ? (
                          <span className="text-muted-foreground">
                            {tr("requirements.requirement.status.no_data")}
                          </span>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default TraceabilityMatrix;
