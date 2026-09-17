import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { packedArtifact } from "../test/fixtures/artifactTarball.ts";
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
