import { projectFixture } from "@lore/core/testing";
import { currentProjectAtom, I18n } from "@lore/core/web";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { $page, AlephaReactRouter, ReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, it } from "vitest";

import type { ArtifactDetail } from "../../../../../api/schemas/artifactDetailSchema.ts";
import ArtifactDeployments from "./ArtifactDeployments.tsx";

/**
 * The page a row opens.
 */
class Routes {
  appDeploy = $page({
    name: "appDeploy",
    path: "/:projectSlug/apps/:app/:env/deploy",
    component: () => null,
  });
}

const detail: ArtifactDetail = {
  app: "docs",
  tag: "1.0.0",
  pushedAt: "2026-10-01T00:00:00.000Z",
  commitSha: "0123456789abcdef0123456789abcdef01234567",
  variants: [
    {
      id: "00000000-0000-4000-8000-000000000003",
      projectId: 1,
      app: "docs",
      tag: "1.0.0",
      runtime: "workerd",
      runtimes: ["workerd"],
      format: "archive",
      sha256: "a".repeat(64),
      commitSha: "fedcba9876543210fedcba9876543210fedcba98",
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    },
  ],
  copies: [],
  deployments: [
    {
      id: "00000000-0000-4000-8000-0000000000d1",
      instanceId: "00000000-0000-4000-8000-0000000000c1",
      sha256: "a".repeat(64),
      status: "succeeded",
      createdAt: "2026-10-02T00:00:00.000Z",
      env: "production",
      author: "Nico",
    },
    {
      id: "00000000-0000-4000-8000-0000000000d2",
      instanceId: "00000000-0000-4000-8000-0000000000c2",
      sha256: "b".repeat(64),
      status: "failed",
      error: "the host refused the bundle",
      createdAt: "2026-10-03T00:00:00.000Z",
      env: "staging",
    },
  ],
} as ArtifactDetail;

/**
 * The artifact page's Deployments tab (#Q3669): a flat DataTable of the runs,
 * one row each linking to its copy's Deploy tab.
 */
describe("ArtifactDeployments", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (value: ArtifactDetail) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with(AlephaReact)
      .with(AlephaReactRouter)
      .with(AlephaReactI18n);
    alepha.inject(Routes);
    alepha.inject(I18n);
    await alepha.start();
    alepha.store.set(
      currentProjectAtom,
      projectFixture({ title: "Alepha", slug: "alepha" }),
    );
    return render(
      <AlephaContext.Provider value={alepha}>
        <ArtifactDeployments detail={value} />
      </AlephaContext.Provider>,
    );
  };

  it("lists the runs as rows under real columns, newest first", async ({
    expect,
  }) => {
    await mount(detail);

    await waitFor(() =>
      expect(screen.getByText("docs / production")).toBeTruthy(),
    );
    const headers = screen
      .getAllByRole("columnheader")
      .map((it) => it.textContent?.trim())
      .filter(Boolean);
    expect(headers).toEqual(
      expect.arrayContaining(["Copy", "Status", "Commit", "When", "Author"]),
    );

    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("docs / staging"),
      expect.stringContaining("docs / production"),
    ]);
    // The failed run names its error. The commit is the deployed variant's
    // own; a digest no variant holds any more shows the digest's head
    // rather than a guess.
    expect(rows[0].textContent).toContain("Failed");
    expect(rows[0].textContent).toContain("the host refused the bundle");
    expect(rows[0].textContent).toContain("b".repeat(12));
    expect(rows[1].textContent).toContain("fedcba9");
    expect(rows[1].textContent).toContain("Nico");
  });

  it("opens the copy's Deploy tab from its row", async ({ expect }) => {
    await mount(detail);
    const router = alepha!.inject(ReactRouter);

    fireEvent.click(await screen.findByText("docs / production"));

    await waitFor(() =>
      expect(router.state.url.pathname).toBe(
        "/alepha/apps/docs/production/deploy",
      ),
    );
  });

  it("says so when the tag has never been deployed", async ({ expect }) => {
    await mount({ ...detail, deployments: [] });

    expect(
      await screen.findByText("This tag has not been deployed."),
    ).toBeTruthy();
  });
});
