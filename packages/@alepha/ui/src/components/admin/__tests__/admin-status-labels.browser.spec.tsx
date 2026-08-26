import { render } from "@testing-library/react";
import { Alepha } from "alepha";
import { jobExecutionEntity } from "alepha/api/jobs";
import {
  workflowExecutions,
  workflowStepExecutions,
} from "alepha/api/workflows";
import { AlephaContext } from "alepha/react";
import { $dictionary, AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { describe, expect, it } from "vitest";

import { uiFr } from "../../../lib/i18n-fr.ts";
import {
  JOB_EXECUTION_STATUSES,
  useJobStatusLabels,
} from "../admin-jobs-status-labels.ts";
import {
  useWorkflowStatusLabels,
  WORKFLOW_EXECUTION_STATUSES,
} from "../admin-workflows-status-labels.ts";

/**
 * The status vocabularies are the one place where a translation can go
 * missing without anything noticing.
 *
 * They used to be looked up with `tr(\`admin.jobs.status.${status}\`)`, a
 * computed key: `i18n-fr.spec.ts` matches a literal after `tr(`, so those
 * keys were invisible to it in BOTH directions — nothing reported them as
 * untranslated, and adding the French would have been reported as a
 * translation nothing asks for. French users read `ok`, `error`,
 * `compensation_failed` raw.
 *
 * With the keys literal the catalogue check covers them again. What it still
 * cannot see is a status added to the entity enum and forgotten here, which
 * is what the first two cases below are for.
 */
const statusesOf = (entity: { schema: any }): string[] =>
  entity.schema.shape.status.options;

describe("admin status labels", () => {
  /**
   * Render the hook and read its record back out of the DOM.
   *
   * Through the DOM rather than a captured variable: assigning to an outer
   * binding during render is a side effect, and the lint rule that says so is
   * right — the point here is what the component actually rendered.
   */
  const renderWith = async (
    useLabels: () => Record<string, string>,
    lang: string,
  ): Promise<Record<string, string>> => {
    const Probe = () => (
      <div data-testid="labels">{JSON.stringify(useLabels())}</div>
    );

    class Catalogues {
      en = $dictionary({ lazy: async () => ({ default: {} }) });
      fr = $dictionary({ lazy: async () => ({ default: uiFr }) });
    }

    const alepha = Alepha.create().with(AlephaReactI18n);
    alepha.inject(Catalogues);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang(lang);

    const ui = render(
      <AlephaContext.Provider value={alepha}>
        <Probe />
      </AlephaContext.Provider>,
    );
    const labels = JSON.parse(ui.getByTestId("labels").textContent ?? "{}");
    await alepha.stop();
    return labels;
  };

  it("offers every job status the entity can hold", () => {
    expect(JOB_EXECUTION_STATUSES).toEqual(statusesOf(jobExecutionEntity));
  });

  it("offers every workflow EXECUTION status, and no step-only one", () => {
    expect(WORKFLOW_EXECUTION_STATUSES).toEqual(statusesOf(workflowExecutions));
    // `skipped` is a step status: offering it as an execution filter would be
    // a value the query can never match.
    expect(WORKFLOW_EXECUTION_STATUSES).not.toContain("skipped");
  });

  it("translates every job status into French", async () => {
    const labels = await renderWith(useJobStatusLabels, "fr");

    for (const status of statusesOf(jobExecutionEntity)) {
      const label = labels[status as keyof typeof labels];
      expect(label).toBeTruthy();
      // The failure this exists for: a missing key falls back to the raw
      // status, which reads as a value rather than as a missing translation.
      expect(label).not.toBe(status);
    }
    expect(labels.ok).toBe("Réussie");
  });

  it("translates both workflow vocabularies into French", async () => {
    const labels = await renderWith(useWorkflowStatusLabels, "fr");

    // The badge takes either an execution or a step status, so the labels
    // have to span the union — the two enums differ on `timed_out`/`skipped`.
    const union = new Set([
      ...statusesOf(workflowExecutions),
      ...statusesOf(workflowStepExecutions),
    ]);
    for (const status of union) {
      expect(labels[status]).toBeTruthy();
      expect(labels[status]).not.toBe(status);
    }
    expect(labels.compensation_failed).toBe("Échec de la compensation");
  });

  it("falls back to the English default when no catalogue defines the key", async () => {
    const labels = await renderWith(useJobStatusLabels, "en");
    expect(labels.ok).toBe("Succeeded");
    expect(labels.error).toBe("Failed");
  });
});
