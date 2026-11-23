import { Badge, Card, CardContent } from "@alepha/ui";
import { MarkdownView } from "@alepha/ui/markdown";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { CircleCheck, CircleMinus, CircleX } from "lucide-react";

import type { UseCaseResource } from "../../../../api/schemas/useCaseResourceSchema.ts";
import type { UseCaseRunResource } from "../../../../api/schemas/useCaseRunResourceSchema.ts";
import RunEvidenceLinks from "./RunEvidenceLinks.tsx";
import RunScoreRing from "./RunScoreRing.tsx";

export interface UseCaseRunCardProps {
  run: UseCaseRunResource;
  /**
   * The use case's criteria, for each result's title.
   */
  criteria: UseCaseResource["criteria"];
}

const BY_KEYS = {
  agent: "requirements.run.by.agent",
  ci: "requirements.run.by.ci",
  person: "requirements.run.by.person",
} as const;

const RESULT_KEYS = {
  passed: "requirements.run.result.passed",
  failed: "requirements.run.result.failed",
  not_run: "requirements.run.result.not_run",
} as const;

/**
 * One run of a use case (#Q3975): a header with its score, its verdict, the
 * scenario version it played and who ran it where, then one row per
 * criterion (its result, the criterion's title, the evidence as Markdown and
 * the files placed on it), then the run's note as an Observation.
 *
 * Only what a run records is drawn: it keeps no duration and no persona, so
 * neither appears.
 */
const UseCaseRunCard = (props: UseCaseRunCardProps) => {
  const i18n = useI18n<I18n, "en">();
  const { tr } = i18n;
  const run = props.run;
  const titleOf = new Map(
    props.criteria.map((it) => [
      it.key,
      it.text ??
        [it.givenText, it.whenText, it.thenText].filter(Boolean).join(" · "),
    ]),
  );
  const passed = run.results.filter((it) => it.result === "passed").length;
  const failed = run.results.filter((it) => it.result === "failed");
  const notRun = run.results.filter((it) => it.result === "not_run").length;
  const total = run.results.length;
  const verdict =
    failed.length > 0
      ? tr("requirements.run.verdict.failed", {
          args: [
            String(failed.length),
            failed.map((it) => it.criterionKey).join(", "),
          ],
        })
      : total > 0 && passed === total
        ? tr("requirements.run.verdict.passed")
        : tr("requirements.run.verdict.notRun", { args: [String(notRun)] });
  const where = run.app
    ? `${run.app}${run.env ? `/${run.env}` : ""}`
    : (run.env ?? "local");
  const loose = run.evidence.filter(
    (file) => !run.results.some((it) => it.criterionKey === file.criterionKey),
  );

  return (
    <Card
      data-testid="use-case-run"
      data-result={failed.length ? "failed" : "ok"}
    >
      <CardContent className="flex flex-col gap-3 text-sm">
        <header className="flex flex-wrap items-center gap-3">
          <RunScoreRing
            passed={passed}
            total={total}
            failed={failed.length > 0}
            label={tr("requirements.run.score", {
              args: [String(passed), String(total)],
            })}
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span
              className={
                failed.length
                  ? "text-danger-text font-semibold"
                  : "font-semibold"
              }
              data-testid="run-verdict"
            >
              {verdict}
            </span>
            <span className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline">v{run.scenarioVersion}</Badge>
              <Badge variant="outline">
                {tr(BY_KEYS[run.by])}
                {run.client ? ` · ${run.client}` : ""}
              </Badge>
              <Badge variant="outline">{where}</Badge>
            </span>
          </div>
          <span className="text-muted-foreground text-xs">
            {i18n.l(run.ranAt, { date: "lll" })}
          </span>
        </header>
        <ul className="flex flex-col divide-y">
          {run.results.map((it) => {
            const Icon =
              it.result === "passed"
                ? CircleCheck
                : it.result === "failed"
                  ? CircleX
                  : CircleMinus;
            return (
              <li
                key={it.criterionKey}
                data-criterion={it.criterionKey}
                className="flex gap-2 py-2"
              >
                <Icon
                  aria-label={tr(RESULT_KEYS[it.result])}
                  className={
                    it.result === "passed"
                      ? "text-success-text mt-0.5 size-4 shrink-0"
                      : it.result === "failed"
                        ? "text-danger-text mt-0.5 size-4 shrink-0"
                        : "text-muted-foreground mt-0.5 size-4 shrink-0"
                  }
                />
                <div className="flex min-w-0 flex-col gap-1">
                  <span>
                    <span className="font-semibold">{it.criterionKey}</span>
                    {titleOf.get(it.criterionKey) ? (
                      <span> {titleOf.get(it.criterionKey)}</span>
                    ) : null}
                  </span>
                  {it.note ? (
                    <div
                      className="text-muted-foreground text-xs"
                      data-testid="run-evidence"
                    >
                      <MarkdownView content={it.note} />
                    </div>
                  ) : null}
                  <RunEvidenceLinks
                    files={run.evidence.filter(
                      (file) => file.criterionKey === it.criterionKey,
                    )}
                  />
                </div>
              </li>
            );
          })}
        </ul>
        {/* Files on no criterion the run recorded, kept after them. */}
        <RunEvidenceLinks files={loose} />
        {run.note ? (
          <footer
            className="chrome rounded-md p-2 text-xs"
            data-testid="run-observation"
          >
            <span className="font-semibold">
              {tr("requirements.run.observation")}
            </span>
            <MarkdownView content={run.note} />
          </footer>
        ) : null}
      </CardContent>
    </Card>
  );
};

export default UseCaseRunCard;
