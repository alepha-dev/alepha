import { I18n } from "@lore/core/web";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { beforeAll, describe, expect, it } from "vitest";

import type { ArtifactResource } from "../../../../../api/schemas/artifactResourceSchema.ts";
import ArtifactManifest from "./ArtifactManifest.tsx";

const LONG =
  "The key the payment provider signs its webhooks with, read on every delivery and rotated from the provider's dashboard, never from here.";

const MANIFEST = {
  manifestVersion: 2,
  project: "acme",
  runtimes: [{ runtime: "node", entry: "index.node.js", runtimeVersion: "26" }],
  resources: { hasDatabase: true, hasBucket: false },
  crons: ["*/5 * * * *", "30 8 * * 1", "0 9 * * 1-5"],
  secrets: [{ name: "WEBHOOK_SECRET", description: LONG }],
  variables: [{ name: "APP_URL" }],
  cloudflare: { websocketPaths: ["/ws"], config: { name: "acme" } },
  futureKey: { shape: "unknown to this Lore" },
};

const variant = (over: Partial<ArtifactResource> = {}) =>
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
    manifest: MANIFEST,
    ...over,
  }) as ArtifactResource;

/**
 * The Manifest tab draws the build's document and keeps the verbatim JSON
 * one click away (#Q3286).
 */
describe("ArtifactManifest", () => {
  // The view switch is a `Segmented`, which tracks its thumb with a
  // ResizeObserver, and jsdom ships none.
  beforeAll(() => {
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as never;
  });

  const show = async (shown: ArtifactResource, lang = "en") => {
    cleanup();
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaReact)
      .with(AlephaReactI18n);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang(lang);
    render(
      <AlephaContext.Provider value={alepha}>
        <ArtifactManifest variant={shown} />
      </AlephaContext.Provider>,
    );
  };

  const section = (name: string) =>
    screen.getByTestId(`artifact-manifest-${name}`).textContent ?? "";

  it("draws each thing the build declares as its own section", async () => {
    await show(variant());

    expect(section("build")).toContain("acme");
    expect(section("runtimes")).toContain("index.node.js");
    expect(section("runtimes")).toContain("26");
    // On and off are marks with a spoken state, not `true` / `false` lines.
    expect(screen.getByLabelText("database: on")).toBeTruthy();
    expect(screen.getByLabelText("bucket: off")).toBeTruthy();
    expect(section("resources")).not.toContain("true");
    expect(section("variables")).toContain("APP_URL");
    expect(section("cloudflare")).toContain("/ws");
    expect(section("cloudflare")).toContain('"name": "acme"');
    expect(screen.queryByTestId("artifact-manifest-raw")).toBeNull();
  });

  it("reads a cron aloud beside its expression, and leaves one it cannot read bare", async () => {
    await show(variant());

    const crons = section("crons");
    expect(crons).toContain("*/5 * * * *Every 5 minutes");
    expect(crons).toContain("30 8 * * 1Every Monday at 08:30 UTC");
    expect(crons.endsWith("0 9 * * 1-5")).toBe(true);
  });

  it("names the day in the reader's language", async () => {
    await show(variant(), "fr");

    expect(section("crons")).toContain("Chaque lundi à 08:30 UTC");
  });

  it("shows a secret's whole description in a cell that wraps", async () => {
    await show(variant());

    const cell = screen.getByText(LONG);
    expect(cell.tagName).toBe("TD");
    expect(cell.className).toContain("whitespace-normal");
    expect(cell.className).toContain("break-words");
    expect(cell.closest("pre")).toBeNull();
  });

  it("keeps a key it does not know, raw, under Other", async () => {
    await show(variant());

    const other = section("other");
    expect(other).toContain('"futureKey"');
    expect(other).toContain("unknown to this Lore");
  });

  it("switches to the verbatim JSON and back", async () => {
    await show(variant());

    fireEvent.click(screen.getByRole("radio", { name: "Raw" }));

    expect(screen.getByTestId("artifact-manifest-raw").textContent).toBe(
      JSON.stringify(MANIFEST, null, 2),
    );
    expect(screen.queryByTestId("artifact-manifest-runtimes")).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: "Structured" }));
    expect(screen.getByTestId("artifact-manifest-runtimes")).toBeTruthy();
  });

  it("leaves an image's OCI index raw, with no toggle", async () => {
    const index = { schemaVersion: 2, manifests: [] };
    await show(variant({ format: "image", manifest: index } as never));

    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.getByTestId("artifact-manifest-raw").textContent).toBe(
      JSON.stringify(index, null, 2),
    );
  });

  it("says so when the build carries no manifest", async () => {
    await show(variant({ manifest: undefined }));

    expect(screen.getByTestId("artifact-manifest").textContent).toContain(
      "carries no manifest",
    );
  });
});
