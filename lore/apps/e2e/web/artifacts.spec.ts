import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

// Its own subpath, not `./testing`: that barrel renders React pages, and
// Playwright's loader cannot import their stylesheets.
import { packedArtifact } from "@lore/deploy/testing/tarball";

import { expect, test } from "./_fixtures.ts";
import { createProjectViaWizard, registerAndVerify } from "./_helpers.ts";

test("downloads the stored artifact from its row menu with matching bytes", async ({
  page,
}) => {
  await registerAndVerify(
    page,
    `artifact-${crypto.randomUUID()}@example.com`,
    "GoodPassw0rd",
  );
  const project = await createProjectViaWizard(page, "Download artifacts", {
    capabilities: ["apps"],
  });
  const file = await packedArtifact({ name: "my-app-1.2.3-node.tar.gz" });
  const bytes = [...new Uint8Array(await file.arrayBuffer())];
  const pushed = await page.evaluate(
    async ({ projectId, bytes, name }) => {
      const body = new FormData();
      body.set("app", "my-app");
      body.set("tag", "1.2.3");
      body.set(
        "file",
        new File([new Uint8Array(bytes)], name, { type: "application/gzip" }),
      );
      const response = await fetch(`/api/projects/${projectId}/artifacts`, {
        method: "POST",
        body,
      });
      return { status: response.status, body: await response.json() };
    },
    { projectId: project.id, bytes, name: file.name },
  );

  expect(pushed.status).toBe(200);
  const artifact = pushed.body.artifact as { id: string; sha256: string };
  await page.goto(`/${project.slug}/artifacts`);
  const row = page.getByRole("row").filter({ hasText: "1.2.3" });
  await row.getByRole("button", { name: "Open row actions" }).click();
  const received = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Download", exact: true }).click();
  const download = await received;
  expect(download.suggestedFilename()).toBe(file.name);
  expect(await download.failure()).toBeNull();
  const downloadedPath = await download.path();
  expect(downloadedPath).not.toBeNull();
  const downloaded = await readFile(downloadedPath!);
  expect(createHash("sha256").update(downloaded).digest("hex")).toBe(
    artifact.sha256,
  );
  expect(downloaded).toEqual(Buffer.from(bytes));
});

test("opens a build from the table and reads what it declares", async ({
  page,
}) => {
  await registerAndVerify(
    page,
    `artifact-detail-${crypto.randomUUID()}@example.com`,
    "GoodPassw0rd",
  );
  const project = await createProjectViaWizard(page, "Artifact detail", {
    capabilities: ["apps"],
  });
  const file = await packedArtifact({
    name: "my-app-1.2.3-node.tar.gz",
    manifest: {
      runtimes: [{ runtime: "node", entry: "index.node.js" }],
      resources: { hasDatabase: true, hasKV: false },
      secrets: [{ name: "APP_SECRET" }],
    },
  });
  const bytes = [...new Uint8Array(await file.arrayBuffer())];
  const status = await page.evaluate(
    async ({ projectId, bytes, name }) => {
      const body = new FormData();
      body.set("app", "my-app");
      body.set("tag", "1.2.3");
      body.set(
        "file",
        new File([new Uint8Array(bytes)], name, { type: "application/gzip" }),
      );
      const response = await fetch(`/api/projects/${projectId}/artifacts`, {
        method: "POST",
        body,
      });
      return response.status;
    },
    { projectId: project.id, bytes, name: file.name },
  );
  expect(status).toBe(200);

  await page.goto(`/${project.slug}/artifacts`);
  await page.getByRole("link", { name: "1.2.3", exact: true }).click();

  await expect(page).toHaveURL(
    new RegExp(`/${project.slug}/artifacts/my-app/1\\.2\\.3`),
  );
  await expect(page.getByTestId("artifact-plate")).toContainText("my-app");
  await expect(page.getByTestId("artifact-needs")).toContainText("database");
  await expect(page.getByTestId("artifact-needs")).toContainText("APP_SECRET");

  await page
    .getByTestId("artifact-tabs")
    .getByRole("tab", { name: "Manifest" })
    .click();
  await expect(page).toHaveURL(/tab=manifest/);
  // Drawn (#Q3286): a section per thing the build declares...
  await expect(page.getByTestId("artifact-manifest-runtimes")).toContainText(
    "index.node.js",
  );
  await expect(page.getByTestId("artifact-manifest-secrets")).toContainText(
    "APP_SECRET",
  );
  // ...and the verbatim document one click away.
  await page
    .getByTestId("artifact-manifest")
    .getByRole("radio", { name: "Raw" })
    .click();
  await expect(page.getByTestId("artifact-manifest-raw")).toContainText(
    '"entry": "index.node.js"',
  );

  await page.goto(`/${project.slug}/artifacts/my-app/9.9.9`);
  await expect(page.getByTestId("artifact-not-found")).toBeVisible();
});

/**
 * The docs link under an empty artifact list follows its frame (#Q3266):
 * centred under the centred sentence on the project page. It sat hard left,
 * which only a real layout can show. The other frame, an app's card, now
 * lives in the Deploy tab's "Deploy new artifact" dialog, behind a host
 * this case does not set up (#Q3544).
 */
test("places the empty state's docs link where its sentence is", async ({
  page,
}) => {
  await registerAndVerify(
    page,
    `artifact-empty-${crypto.randomUUID()}@example.com`,
    "GoodPassw0rd",
  );
  const project = await createProjectViaWizard(page, "Empty artifacts", {
    capabilities: ["apps"],
  });

  /**
   * The link and the sentence above it, as boxes. The sentence is measured
   * by its TEXT (a range), not by its paragraph: the paragraph is as wide as
   * the frame in both cases and would say nothing.
   */
  const boxes = async () => {
    const link = page.getByTestId("artifacts-empty-docs");
    await expect(link).toBeVisible({ timeout: 15_000 });
    return link.evaluate((el) => {
      const sentence = el.parentElement!.previousElementSibling!;
      const range = document.createRange();
      range.selectNodeContents(sentence);
      const text = range.getBoundingClientRect();
      const self = el.getBoundingClientRect();
      const frame = sentence.getBoundingClientRect();
      return {
        linkLeft: self.left,
        linkCentre: self.left + self.width / 2,
        textLeft: text.left,
        textCentre: text.left + text.width / 2,
        frameLeft: frame.left,
        frameCentre: frame.left + frame.width / 2,
      };
    });
  };

  await page.goto(`/${project.slug}/artifacts`);
  const centred = await boxes();
  expect(Math.abs(centred.linkCentre - centred.textCentre)).toBeLessThan(2);
  expect(Math.abs(centred.linkCentre - centred.frameCentre)).toBeLessThan(2);
  // Not vacuous: a link this narrow, centred, is well clear of the left edge.
  expect(centred.linkLeft - centred.frameLeft).toBeGreaterThan(20);
});
