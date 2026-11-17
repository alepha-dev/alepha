import { Button, Card, CardContent } from "@alepha/ui";
import { formatReference, type I18n } from "@lore/core/web";
import { useAction, useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Bot, Wrench } from "lucide-react";
import { useState } from "react";

import type { RequirementCoverageController } from "../../../../api/controllers/RequirementCoverageController.ts";
import type { RequirementCoverage } from "../../../../api/schemas/requirementCoverageSchema.ts";
import VerifyDialog, { type VerifySubject } from "../verify/VerifyDialog.tsx";

export interface CoverageGapsProps {
  projectId: number;
  canWrite: boolean;
  coverage: RequirementCoverage;
}

/**
 * The coverage gaps (#E153, #Q3774): requirements not verified, use cases
 * without a requirement, personas without a passing use case, epics
 * without a use case, each with what fixes it: an agent drafting use
 * cases, or marking an epic technical.
 */
const CoverageGaps = (props: CoverageGapsProps) => {
  const { tr } = useI18n<I18n, "en">();
  const api = useClient<RequirementCoverageController>();
  const [drafting, setDrafting] = useState<VerifySubject | undefined>();
  const { gaps } = props.coverage;
  const canWrite = props.canWrite;

  const technical = useAction<[epicNumber: number], void>(
    {
      handler: async (_ctx, epicNumber) => {
        await api.setEpicTechnical({
          params: { projectId: props.projectId },
          body: { epicNumber, technical: true },
        });
      },
      invalidates: [["requirement-coverage", props.projectId]],
    },
    [api, props.projectId],
  );

  const sections = [
    {
      key: "requirements",
      title: tr("requirements.trace.gap.requirements"),
      items: gaps.requirementsNotVerified.map((it) =>
        formatReference("requirement", it.number),
      ),
      action:
        gaps.requirementsNotVerified[0] !== undefined ? (
          <Button
            size="sm"
            variant="outlined"
            onClick={() =>
              setDrafting({
                kind: "draft",
                requirement: gaps.requirementsNotVerified[0].number,
              })
            }
          >
            <Bot className="size-4" />
            {tr("requirements.trace.gap.draft")}
          </Button>
        ) : null,
    },
    {
      key: "usecases",
      title: tr("requirements.trace.gap.useCases"),
      items: gaps.useCasesWithoutRequirement.map((it) =>
        formatReference("usecase", it.number),
      ),
    },
    {
      key: "personas",
      title: tr("requirements.trace.gap.personas"),
      items: gaps.personasWithoutPassingUseCase.map(
        (it) => `${formatReference("persona", it.number)} ${it.name}`,
      ),
    },
    {
      key: "epics",
      title: tr("requirements.trace.gap.epics"),
      items: gaps.epicsWithoutUseCase.map(
        (it) => `${formatReference("epic", it.number)} ${it.title}`,
      ),
      action:
        gaps.epicsWithoutUseCase[0] !== undefined ? (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outlined"
              onClick={() =>
                setDrafting({
                  kind: "draft",
                  epic: gaps.epicsWithoutUseCase[0].number,
                })
              }
            >
              <Bot className="size-4" />
              {tr("requirements.trace.gap.draft")}
            </Button>
            {canWrite ? (
              <Button
                size="sm"
                variant="outlined"
                disabled={technical.loading}
                onClick={() =>
                  void technical.run(gaps.epicsWithoutUseCase[0].number)
                }
              >
                <Wrench className="size-4" />
                {tr("requirements.trace.gap.technical", {
                  args: [
                    formatReference("epic", gaps.epicsWithoutUseCase[0].number),
                  ],
                })}
              </Button>
            ) : null}
          </div>
        ) : null,
    },
  ];

  return (
    <Card data-testid="coverage-gaps">
      <CardContent className="flex flex-col gap-3 text-sm">
        <h3 className="font-semibold">{tr("requirements.trace.gaps")}</h3>
        {sections.map((section) => (
          <section
            key={section.key}
            className="flex flex-col gap-1 border-t pt-2"
            data-testid={`gap-${section.key}`}
          >
            <div className="flex justify-between font-medium">
              <span>{section.title}</span>
              <span>{section.items.length}</span>
            </div>
            {section.items.length ? (
              <>
                <p className="text-muted-foreground text-xs">
                  {section.items.join(", ")}
                </p>
                {section.action ?? null}
              </>
            ) : null}
          </section>
        ))}
      </CardContent>
      {drafting ? (
        <VerifyDialog
          subject={drafting}
          open
          onOpenChange={(open) => {
            if (!open) setDrafting(undefined);
          }}
        />
      ) : null}
    </Card>
  );
};

export default CoverageGaps;
