import { I18n } from "@lore/core/web";
import { cleanup, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { describe, expect, it } from "vitest";

import type { ArtifactResource } from "../../../../../api/schemas/artifactResourceSchema.ts";
import ArtifactNeeds from "./ArtifactNeeds.tsx";

const variant = (resources: Record<string, boolean>) =>
  ({
    id: "01a188cd-9768-7384-a87c-d38bdbe34642",
    projectId: 1,
    app: "shop",
    tag: "1.0.0",
    runtime: "node",
    runtimes: ["node"],
    format: "archive",
    sha256: "a".repeat(64),
    size: 1_000,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    manifest: { manifestVersion: 2, project: "acme", resources },
  }) as ArtifactResource;

/**
 * "What it needs" lists the resources the build declares, and only those
 * (#Q4264).
 */
describe("ArtifactNeeds", () => {
  const show = async (shown: ArtifactResource) => {
    cleanup();
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaReact)
      .with(AlephaReactI18n);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    render(
      <AlephaContext.Provider value={alepha}>
        <ArtifactNeeds variant={shown} />
      </AlephaContext.Provider>,
    );
  };

  it("lists the declared resources and leaves the others out", async () => {
    await show(variant({ hasDatabase: true, hasBucket: false, hasKv: false }));
    const card = screen.getByTestId("artifact-needs").textContent ?? "";
    expect(card).toContain("database");
    expect(card).not.toContain("bucket");
    expect(card).not.toContain("kv");
    expect(screen.queryByTestId("artifact-needs-no-resources")).toBeNull();
  });

  it("says None when the build needs no resource", async () => {
    await show(variant({ hasDatabase: false, hasBucket: false }));
    expect(screen.getByTestId("artifact-needs-no-resources").textContent).toBe(
      "None",
    );
  });
});
