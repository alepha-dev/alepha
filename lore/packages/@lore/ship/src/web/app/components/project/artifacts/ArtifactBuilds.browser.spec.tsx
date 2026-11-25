import { projectFixture } from "@lore/core/testing";
import { currentProjectAtom, I18n } from "@lore/core/web";
import { cleanup, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { describe, expect, it } from "vitest";

import type { ArtifactGroup } from "../../../../../api/schemas/artifactGroupSchema.ts";
import type { ArtifactResource } from "../../../../../api/schemas/artifactResourceSchema.ts";
import ArtifactBuilds from "./ArtifactBuilds.tsx";

const aProject = projectFixture({ title: "Acme", slug: "acme" });

const variant = (over: Partial<ArtifactResource> = {}): ArtifactResource => ({
  id: "01a188cd-9768-7384-a87c-d38bdbe34642",
  projectId: 1,
  app: "shop",
  tag: "1.0.0",
  runtime: "node",
  runtimes: ["node"],
  format: "archive",
  sha256: "a".repeat(64),
  size: 1_000_000,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  ...over,
});

const group = (tag: string, only: ArtifactResource): ArtifactGroup => ({
  app: "shop",
  tag,
  pushedAt: only.updatedAt,
  variants: [only],
});

/**
 * The Builds tab says what changed from one build to the next, beyond its
 * size (#Q4265).
 */
describe("ArtifactBuilds", () => {
  const show = async (builds: ArtifactGroup[]) => {
    cleanup();
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaReact)
      .with(AlephaReactRouter)
      .with(AlephaReactI18n);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    alepha.store.set(currentProjectAtom, aProject);
    render(
      <AlephaContext.Provider value={alepha}>
        <ArtifactBuilds
          app="shop"
          tag="2.0.0"
          variant={builds[0].variants[0]}
          builds={builds}
        />
      </AlephaContext.Provider>,
    );
  };

  const text = (testId: string) => screen.getByTestId(testId).textContent ?? "";

  it("shows each build's variables and secrets with their move, and what else changed", async () => {
    await show([
      group(
        "2.0.0",
        variant({
          tag: "2.0.0",
          updatedAt: "2026-10-02T00:00:00.000Z",
          commitSha: "c0ffee1".padEnd(40, "0"),
          runtimes: ["node", "workerd"],
          declares: {
            variables: ["APP_URL", "LOG_LEVEL", "REGION"],
            secrets: [],
            resources: ["database", "bucket"],
            crons: ["0 3 * * *"],
          },
        }),
      ),
      group(
        "1.0.0",
        variant({
          declares: {
            variables: ["APP_URL"],
            secrets: ["APP_SECRET"],
            resources: ["database"],
            crons: [],
          },
        }),
      ),
    ]);

    expect(text("artifact-build-variables-2.0.0")).toBe("3(+2)");
    expect(
      screen
        .getByTestId("artifact-build-variables-2.0.0")
        .getAttribute("title"),
    ).toBe("+LOG_LEVEL, +REGION");
    expect(text("artifact-build-secrets-2.0.0")).toBe("0(-1)");
    const changes = text("artifact-build-changes-2.0.0");
    expect(changes).toContain("+bucket");
    expect(changes).not.toContain("database");
    expect(changes).toContain("runtimes: node, workerd");
    expect(changes).toContain("crons: +1");
    expect(text("artifact-build-2.0.0")).toContain("c0ffee1");

    // The oldest build: its counts, and no move to name.
    expect(text("artifact-build-variables-1.0.0")).toBe("1");
    expect(text("artifact-build-changes-1.0.0")).toBe("");
  });

  it("leaves a build of unknown content blank, never zero", async () => {
    await show([
      group(
        "2.0.0",
        variant({ tag: "2.0.0", updatedAt: "2026-10-02T00:00:00.000Z" }),
      ),
      group("1.0.0", variant()),
    ]);

    expect(text("artifact-build-variables-2.0.0")).toBe("");
    expect(text("artifact-build-secrets-2.0.0")).toBe("");
    expect(text("artifact-build-changes-2.0.0")).toBe("");
  });
});
