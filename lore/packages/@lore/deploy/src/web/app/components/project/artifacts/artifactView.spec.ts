import { describe, it } from "vitest";

import type { ArtifactGroup } from "../../../../../api/schemas/artifactGroupSchema.ts";
import type { ArtifactResource } from "../../../../../api/schemas/artifactResourceSchema.ts";
import {
  artifactBuildRows,
  artifactCopyState,
  artifactImagePlatforms,
  artifactManifestSummary,
  artifactVariantKey,
} from "./artifactView.ts";

const variant = (over: Partial<ArtifactResource> = {}): ArtifactResource => ({
  id: "01a188cd-9768-7384-a87c-d38bdbe34642",
  projectId: 1,
  app: "lore",
  tag: "1.0.0",
  runtime: "node",
  runtimes: ["node"],
  format: "archive",
  sha256: "a".repeat(64),
  size: 1_000,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  ...over,
});

const group = (
  tag: string,
  ...variants: ArtifactResource[]
): ArtifactGroup => ({
  app: "lore",
  tag,
  pushedAt: variants[0].updatedAt,
  variants,
});

describe("artifactCopyState", () => {
  const run = (over: object) => ({
    id: "r",
    instanceId: "copy",
    sha256: "a".repeat(64),
    status: "succeeded",
    createdAt: "2026-10-01T00:00:00.000Z",
    ...over,
  });

  it("reads the digest, so a copy on older bytes of one tag is not running this", ({
    expect,
  }) => {
    const copy = {
      id: "copy",
      env: "production",
      deployed: { tag: "1.0.0", sha256: "b".repeat(64), at: "x" },
    };

    expect(artifactCopyState(copy, variant(), [])).toBe("other");
  });

  it("is running when the newest run shipped these bytes", ({ expect }) => {
    const copy = {
      id: "copy",
      env: "production",
      deployed: { tag: "1.0.0", sha256: "a".repeat(64), at: "x" },
    };

    expect(artifactCopyState(copy, variant(), [])).toBe("running");
  });

  it("is superseded only after a run that succeeded", ({ expect }) => {
    const copy = { id: "copy", env: "production" };

    expect(artifactCopyState(copy, variant(), [run({})] as any)).toBe(
      "superseded",
    );
    expect(
      artifactCopyState(copy, variant(), [run({ status: "failed" })] as any),
    ).toBe("other");
  });
});

describe("artifactBuildRows", () => {
  it("sizes each build against the next older one of its runtime and format", ({
    expect,
  }) => {
    const rows = artifactBuildRows(
      [
        group(
          "2.0.0",
          variant({ size: 1_500, updatedAt: "2026-10-02T00:00:00.000Z" }),
          variant({
            format: "image",
            size: 90_000,
            updatedAt: "2026-10-02T00:00:00.000Z",
          }),
        ),
        group("1.0.0", variant()),
      ],
      variant(),
    );

    expect(rows.map((it) => [it.tag, it.delta])).toEqual([
      ["2.0.0", 500],
      ["1.0.0", undefined],
    ]);
  });

  it("gives no delta beside a build of unknown size", ({ expect }) => {
    const rows = artifactBuildRows(
      [
        group("2.0.0", variant({ updatedAt: "2026-10-02T00:00:00.000Z" })),
        group("1.0.0", variant({ size: undefined })),
      ],
      variant(),
    );

    expect(rows[0].delta).toBeUndefined();
  });
});

describe("artifactManifestSummary", () => {
  it("names a resource from the document's own key, on or off", ({
    expect,
  }) => {
    const summary = artifactManifestSummary({
      runtimes: [
        { runtime: "node", entry: "index.node.js", runtimeVersion: "26" },
      ],
      resources: { hasDatabase: true, hasKV: false, hasDurableObjects: true },
      crons: ["0 3 * * *"],
      secrets: [{ name: "APP_SECRET" }],
      variables: [{ name: "APP_NAME" }],
      cloudflare: { websocketPaths: ["/ws/chat"] },
    });

    expect(summary).toEqual({
      slices: [{ runtime: "node", entry: "index.node.js", version: "26" }],
      resources: [
        { name: "database", on: true },
        { name: "kv", on: false },
        { name: "durable objects", on: true },
      ],
      crons: ["0 3 * * *"],
      secrets: ["APP_SECRET"],
      variables: ["APP_NAME"],
      websocketPaths: ["/ws/chat"],
    });
  });

  it("survives a document from a build of any age", ({ expect }) => {
    expect(artifactManifestSummary({ resources: "?", secrets: 3 })).toEqual({
      slices: [],
      resources: [],
      crons: [],
      secrets: [],
      variables: [],
      websocketPaths: [],
    });
  });
});

describe("artifactImagePlatforms", () => {
  it("skips the attestation entries of an OCI index", ({ expect }) => {
    expect(
      artifactImagePlatforms({
        manifests: [
          {
            digest: "sha256:1",
            platform: { os: "linux", architecture: "amd64" },
          },
          {
            digest: "sha256:2",
            platform: { os: "unknown", architecture: "unknown" },
          },
        ],
      }),
    ).toEqual([{ platform: "linux/amd64", digest: "sha256:1" }]);
  });
});

describe("artifactVariantKey", () => {
  it("tells a node tarball from a node image of one tag", ({ expect }) => {
    expect(artifactVariantKey(variant())).not.toBe(
      artifactVariantKey(variant({ format: "image" })),
    );
  });
});
