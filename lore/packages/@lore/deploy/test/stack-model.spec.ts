import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Alepha } from "alepha";
import { afterEach, beforeEach, describe, it } from "vitest";
import { parse as parseYaml } from "yaml";

import {
  StackComposeParser,
  StackController,
  StackTargets,
} from "../src/api/index.ts";
import { gzip, tar } from "../src/testing/artifactTarball.ts";
import {
  bootStackSpec,
  createStack,
  lentBayEstate,
  stackWorld,
} from "./support/stackWorld.ts";

/**
 * The target-neutral stack model and the per-target checks (#Q2691).
 *
 * `test/fixtures/bay/compose/` is the conformance set: the files Bay's own
 * acceptance tests deploy are accepted here, and each refused case carries
 * the words Bay uses, so a file fails at upload exactly where and how it
 * would fail on the machine.
 */
const fixtures = join(import.meta.dirname, "fixtures/bay/compose");

const accepted = readdirSync(join(fixtures, "accepted"));
const refused = parseYaml(
  readFileSync(join(fixtures, "refused/cases.yml"), "utf8"),
) as Array<{
  name: string;
  stage: "parse" | "bay";
  expect: string;
  compose: string;
}>;

const filesOf = (dir: string) => readdirSync(dir);

describe("the stack model", () => {
  const parser = new StackComposeParser();
  const targets = new StackTargets();

  describe("Bay's compose fixtures", () => {
    for (const name of accepted) {
      it(`${name} is read and accepted by Bay`, ({ expect }) => {
        const dir = join(fixtures, "accepted", name);
        const model = parser.parse(
          readFileSync(join(dir, "compose.yml"), "utf8"),
          filesOf(dir),
        );
        expect(() => targets.assert(model, ["bay"])).not.toThrow();
        expect(model.services.length).toBeGreaterThan(0);
      });
    }

    for (const c of refused) {
      it(`${c.name} is refused with Bay's words`, ({ expect }) => {
        const run = () => targets.assert(parser.parse(c.compose, []), ["bay"]);
        expect(run).toThrow(c.expect);
        if (c.stage === "parse") {
          expect(() => parser.parse(c.compose, [])).toThrow(c.expect);
        } else {
          expect(() => parser.parse(c.compose, [])).not.toThrow();
        }
      });
    }
  });

  describe("what the model holds", () => {
    it("reads apps, routes, ports, mounts, dependencies, healthchecks and backup hooks", ({
      expect,
    }) => {
      const dir = join(fixtures, "accepted/app-stack");
      const model = parser.parse(
        readFileSync(join(dir, "compose.yml"), "utf8"),
        [],
      );
      const byName = Object.fromEntries(model.services.map((s) => [s.name, s]));
      expect(byName.api).toMatchObject({
        kind: "app",
        app: "api",
        routes: ["@", "api"],
        dependsOn: ["cache", "db"],
      });
      expect(byName.db).toMatchObject({
        kind: "service",
        image: "postgres:17-alpine",
        healthcheck: true,
        backup: { kind: "postgres", user: "app", db: "app" },
        mounts: [
          {
            kind: "volume",
            source: "pgdata",
            target: "/var/lib/postgresql/data",
          },
        ],
        environment: ["POSTGRES_DB", "POSTGRES_PASSWORD", "POSTGRES_USER"],
      });
      expect(model.volumes).toEqual(["pgdata"]);
    });

    it("lists interpolated variables, required unless they carry a default, and never a value", ({
      expect,
    }) => {
      const model = parser.parse(
        [
          "services:",
          "  db:",
          "    image: redis:${TAG:-7}",
          "    environment:",
          "      A: ${SECRET}",
          "      B: $$NOT_A_VAR",
          "      C: $PLAIN",
          "      D: ${STRICT:?set it}",
          "    # comment ${IN_COMMENT}",
        ].join("\n"),
        [],
      );
      expect(model.variables).toEqual([
        { name: "PLAIN", required: true },
        { name: "SECRET", required: true },
        { name: "STRICT", required: true },
        { name: "TAG", required: false },
      ]);
      expect(JSON.stringify(model)).not.toContain("set it");
    });

    it("keeps Umami's escaped $${POSTGRES_USER} out of the variables", ({
      expect,
    }) => {
      const model = parser.parse(
        readFileSync(join(fixtures, "accepted/umami/compose.yml"), "utf8"),
        [],
      );
      expect(model.variables).toEqual([]);
      expect(model.services.map((s) => s.name)).toEqual(["db", "umami"]);
    });
  });

  describe("other targets", () => {
    it("Cloudflare runs apps only; Kubernetes refuses the host", ({
      expect,
    }) => {
      const model = parser.parse(
        "services:\n  api: {x-lore: {app: api}}\n  db:\n    image: postgres\n    network_mode: host\n",
        [],
      );
      expect(() => targets.assert(model, ["cloudflare"])).toThrow(
        "service db: Cloudflare runs apps only",
      );
      expect(() => targets.assert(model, ["kubernetes"])).toThrow(
        "network_mode host is not allowed on Kubernetes",
      );
      const appsOnly = parser.parse(
        "services:\n  api: {x-lore: {app: api}}\n",
        [],
      );
      expect(() =>
        targets.assert(appsOnly, ["cloudflare", "kubernetes", "bay"]),
      ).not.toThrow();
    });
  });
});

describe("uploading a revision", () => {
  let alepha: Alepha;

  beforeEach(async () => {
    alepha = await bootStackSpec();
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const upload = async (
    w: Awaited<ReturnType<typeof stackWorld>>,
    stackId: string,
    file: File,
  ) =>
    (
      await alepha
        .inject(StackController)
        .uploadStackRevision.fetch(
          { params: { projectId: w.project.id, stackId }, body: { file } },
          { user: w.user },
        )
    ).data;

  it("stores a bare compose file as a one-file bundle, with its model and text", async ({
    expect,
  }) => {
    const w = await stackWorld(alepha);
    const stack = await createStack(alepha, w, { name: "umami" });
    const text = readFileSync(
      join(fixtures, "accepted/umami/compose.yml"),
      "utf8",
    );
    const revision = await upload(
      w,
      stack.id,
      new File([text], "compose.yml", { type: "application/octet-stream" }),
    );
    expect(revision.number).toBe(1);
    expect(revision.compose).toBe(text);
    expect(JSON.parse(revision.model).services).toHaveLength(2);
    expect(revision.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reads a tar.gz bundle and checks its bind mounts against what it carries", async ({
    expect,
  }) => {
    const w = await stackWorld(alepha);
    const stack = await createStack(alepha, w, { name: "broker" });
    const dir = join(fixtures, "accepted/mosquitto");
    const files = Object.fromEntries(
      filesOf(dir).map((f) => [f, readFileSync(join(dir, f), "utf8")]),
    );
    const revision = await upload(
      w,
      stack.id,
      new File([(await gzip(tar(files))) as BlobPart], "bundle.tar.gz", {
        type: "application/gzip",
      }),
    );
    expect(JSON.parse(revision.model).services[0].tcp).toBe(21883);

    const { "mosquitto.conf": _conf, ...lacking } = files;
    await expect(
      upload(
        w,
        stack.id,
        new File([(await gzip(tar(lacking))) as BlobPart], "bundle.tar.gz", {
          type: "application/gzip",
        }),
      ),
    ).rejects.toThrow("not in the bundle");
  });

  it("refuses what the stack's estate cannot run, before anything is stored", async ({
    expect,
  }) => {
    const w = await stackWorld(alepha);
    const estate = await lentBayEstate(w);
    const stack = await createStack(alepha, w, {
      name: "web",
      estateId: estate.id,
    });
    await expect(
      upload(
        w,
        stack.id,
        new File(
          ["services:\n  web: {image: nginx, privileged: true}\n"],
          "compose.yml",
        ),
      ),
    ).rejects.toThrow("privileged is not allowed on Bay");
    expect(
      await w.rows.revisions.findMany({ where: { stackId: { eq: stack.id } } }),
    ).toEqual([]);
  });
});
