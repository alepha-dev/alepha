import { Button, Card, CardContent } from "@alepha/ui";
import { MarkdownView } from "@alepha/ui/markdown";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { Download } from "lucide-react";
import { useState } from "react";

import type { UseCaseResource } from "../../../../api/schemas/useCaseResourceSchema.ts";
import { gherkinOfUseCase } from "./gherkinOfUseCase.ts";

export interface UseCaseScenarioProps {
  useCase: UseCaseResource;
}

/**
 * The Scenario card (#E153): preconditions, then the steps as a list
 * (Steps) or one column per actor (Lanes), the alternatives, and Export as
 * Gherkin.
 */
const UseCaseScenario = (props: UseCaseScenarioProps) => {
  const { tr } = useI18n<I18n, "en">();
  const useCase = props.useCase;
  const [view, setView] = useState<"steps" | "lanes">("steps");
  const name = new Map(useCase.actors.map((a) => [a.personaId, a.name]));
  const actorOf = (id?: number) =>
    id === undefined
      ? tr("requirements.usecase.system")
      : (name.get(id) ?? "?");
  const lanes = [
    ...new Set(useCase.steps.map((step) => actorOf(step.actorPersonaId))),
  ];

  const exportGherkin = () => {
    const blob = new Blob([gherkinOfUseCase(useCase)], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `U${useCase.number}.feature`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">
            {tr("requirements.usecase.scenario")}
          </h2>
          <div className="flex gap-1" role="group">
            {(["steps", "lanes"] as const).map((it) => (
              <Button
                key={it}
                size="sm"
                variant={view === it ? "solid" : "minimal"}
                aria-pressed={view === it}
                onClick={() => setView(it)}
              >
                {tr(
                  it === "steps"
                    ? "requirements.usecase.view.steps"
                    : "requirements.usecase.view.lanes",
                )}
              </Button>
            ))}
          </div>
        </div>
        {useCase.preconditions ? (
          <div className="text-sm">
            <span className="font-semibold">
              {tr("requirements.usecase.field.preconditions")}
            </span>
            <MarkdownView content={useCase.preconditions} />
          </div>
        ) : null}
        {view === "steps" ? (
          <ol
            className="flex flex-col gap-2 text-sm"
            data-testid="scenario-steps"
          >
            {useCase.steps.map((step) => (
              <li
                key={step.id}
                className="grid grid-cols-[1.5rem_7rem_1fr] gap-2"
              >
                <span className="text-muted-foreground">{step.position}</span>
                <span className="bg-muted truncate rounded px-1.5 text-center text-xs leading-5">
                  {actorOf(step.actorPersonaId)}
                </span>
                <span>{step.text}</span>
              </li>
            ))}
          </ol>
        ) : (
          <div
            className="grid gap-2 text-sm"
            style={{
              gridTemplateColumns: `repeat(${Math.max(lanes.length, 1)}, minmax(0, 1fr))`,
            }}
            data-testid="scenario-lanes"
          >
            {lanes.map((lane) => (
              <div
                key={lane}
                className="text-muted-foreground border-b pb-1 text-xs font-semibold"
              >
                {lane}
              </div>
            ))}
            {useCase.steps.map((step) =>
              lanes.map((lane) => (
                <div key={`${step.id}:${lane}`} className="min-h-6">
                  {actorOf(step.actorPersonaId) === lane ? (
                    <span>
                      <span className="text-muted-foreground">
                        {step.position}.
                      </span>{" "}
                      {step.text}
                    </span>
                  ) : null}
                </div>
              )),
            )}
          </div>
        )}
        {useCase.alternatives.length ? (
          <ul className="flex flex-col gap-1 border-t pt-3 text-sm">
            {useCase.alternatives.map((alt) => (
              <li key={alt.id}>
                <span className="font-semibold">{alt.key}.</span> {alt.text}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="border-t pt-3">
          <Button size="sm" variant="link" onClick={exportGherkin}>
            <Download className="size-4" />
            {tr("requirements.usecase.exportGherkin")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default UseCaseScenario;
