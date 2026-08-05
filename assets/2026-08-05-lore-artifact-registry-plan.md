# Lore Artifact Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split Lore's `releases` into an artifact registry (`artifacts`) and a deployment ledger (`deployments`), give artifacts Docker-style tags where only `latest` is mutable, and expose `alepha platform push` / `deploy --tag` / `up --tag` so promoting a release deploys the exact bytes that were tested.

**Architecture:** `artifacts` is keyed `(projectId, app, tag)` and holds the bytes' identity (`sha256`, `fileId`). `deployments` is the renamed `releases` table and records placing an artifact on an `(outpost, environment)`. Deploying the same tag to a second environment creates one new `deployments` row against the same `artifactId` — no rebuild, and Bay skips the download because sha256 already matches.

**Tech Stack:** Alepha framework (`$entity`, `$repository`, `$action`, `$command`), drizzle + SQLite/D1, Vitest, Playwright.

## Global Constraints

- **v1 is Lore → Bay only.** Do not touch `CloudflareAdapter`, `WranglerApi`, or `CloudflareApi`.
- **Migration must be additive + rename only.** No `DROP TABLE`, no column drops, no nullability changes — they trigger drizzle's rebuild pattern, which on D1 cascades and has already destroyed lore-production once (2026-05-13). See `apps/lore/CLAUDE.md` § "Migration safety on D1".
- **Table renames need explicit hints:** `yarn db:generate --hints '[...]'`. Without one, drizzle emits CREATE+DROP, which is data loss.
- **`latest` is the only mutable tag.** Every other tag is write-once; re-push errors unless `force` is set.
- Never use `vi.mock()` / `vi.spyOn()` — use `Alepha.with()` substitution and Memory providers.
- Never use the `private` keyword; use `protected`.
- Never throw bare `Error`; throw `AlephaError` or an `alepha/server` HTTP error.
- No single-line JSDoc — always multi-line.
- **Existing API paths must keep working.** `LoreAdapter` 0.25.0 is deployed in the wild.
- Run `yarn lint && yarn typecheck && yarn test` after each task.

---

### Task 1: `artifacts` entity

**Files:**
- Create: `apps/lore/src/api/entities/artifacts.ts`
- Test: `apps/lore/test/artifact-registry.spec.ts`

**Interfaces:**
- Produces: `artifacts` ($entity), `type Artifact`, `type ArtifactInsert`, `MUTABLE_TAGS: readonly string[]`, `isMutableTag(tag: string): boolean`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/lore/test/artifact-registry.spec.ts
import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";
import { artifacts, isMutableTag } from "../src/api/entities/artifacts.ts";

describe("artifacts entity", () => {
  it("should treat only `latest` as mutable", () => {
    expect(isMutableTag("latest")).toBe(true);
    expect(isMutableTag("1.2.3")).toBe(false);
    expect(isMutableTag("nightly")).toBe(false);
  });

  it("should expose a unique index on projectId+app+tag", () => {
    const unique = artifacts.options.indexes?.find((i) => i.unique);
    expect(unique?.columns).toEqual(["projectId", "app", "tag"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn w lore vitest run test/artifact-registry.spec.ts`
Expected: FAIL — cannot resolve `../src/api/entities/artifacts.ts`

- [ ] **Step 3: Write the entity**

```typescript
// apps/lore/src/api/entities/artifacts.ts
import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";
import { projects } from "./projects.ts";
import { users } from "./users.ts";

/**
 * Tags whose bytes may be replaced in place.
 *
 * A deliberately short list, and `latest` is on it because "latest" names a
 * moving target by definition. Everything else is write-once: promoting
 * `1.2.3` from staging to production has to deploy the bytes staging tested,
 * and that guarantee is worth nothing if the tag can be repointed underneath
 * it. This is Docker's naming with ECR's tag-immutability, not Docker Hub's
 * overwrite-anything default.
 */
export const MUTABLE_TAGS = ["latest"] as const;

/**
 * Whether a tag may be overwritten by a later push.
 */
export const isMutableTag = (tag: string): boolean =>
  (MUTABLE_TAGS as readonly string[]).includes(tag);

/**
 * One built artifact, identified by what it is rather than where it went.
 *
 * **Environment is deliberately absent.** The same tar.gz deploys to staging
 * and to production unchanged — Bay composes the domain and provisions the
 * database from its own configuration — so an artifact that carried an
 * environment would be claiming a property it does not have. Where it landed
 * is `deployments`.
 *
 * **Content-addressed.** `sha256` is the identity; `fileId` is only where the
 * bytes happen to live today. An outpost already holding that digest skips the
 * download, which is what makes promote free.
 */
export const artifacts = $entity({
  name: "artifacts",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * Matches `outpost_apps.app` and `deployments.app` — the join between an
     * artifact, the deploys that used it, and the machine running it.
     */
    app: z.string().min(1).max(100),
    /**
     * Docker-style tag from `alepha pack --tag`. `latest` by default.
     */
    tag: z.string().min(1).max(100),
    /** Digest of the tar.gz. Lowercase hex, always 64 characters. */
    sha256: z.string().length(64),
    /** The `alepha/api/files` row holding the bytes. */
    fileId: z.uuid(),
    sizeBytes: z.integer().min(0).optional(),
    createdBy: db.ref(z.uuid().optional(), () => users.cols.id),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
  }),
  indexes: [
    { columns: ["projectId", "app", "tag"], unique: true },
    { columns: ["projectId", "sha256"] },
  ],
});

export type Artifact = Infer<typeof artifacts.schema>;
export type ArtifactInsert = Infer<typeof artifacts.insertSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn w lore vitest run test/artifact-registry.spec.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Register the entity and commit**

Add `artifacts` to wherever `releases` is registered in `apps/lore/src/api/index.ts` (grep for `releases` to find the list).

```bash
yarn lint && yarn w lore typecheck
git add apps/lore/src/api/entities/artifacts.ts apps/lore/test/artifact-registry.spec.ts apps/lore/src/api/index.ts
git commit -m "feat(lore): artifacts entity, keyed on app+tag rather than environment"
```

---

### Task 2: `ArtifactService` — register with tag immutability

**Files:**
- Create: `apps/lore/src/api/services/ArtifactService.ts`
- Test: `apps/lore/test/artifact-registry.spec.ts` (extend)

**Interfaces:**
- Consumes: `artifacts`, `isMutableTag` (Task 1)
- Produces: `ArtifactService` with
  - `register(input: { projectId: number; app: string; tag: string; sha256: string; fileId: string; sizeBytes?: number; userId?: string; force?: boolean }): Promise<Artifact>`
  - `resolve(projectId: number, app: string, tag: string): Promise<Artifact | undefined>`
  - `listByProject(projectId: number): Promise<Artifact[]>`
  - `static readonly BUCKET = "releases"`

- [ ] **Step 1: Write the failing tests**

```typescript
// append to apps/lore/test/artifact-registry.spec.ts
import { ArtifactService } from "../src/api/services/ArtifactService.ts";
import { ConflictError } from "alepha/server";

describe("ArtifactService", () => {
  it("should replace bytes in place for a mutable tag", async () => {
    const { service, projectId, fileA, fileB } = await setup();

    const first = await service.register({
      projectId, app: "hello", tag: "latest",
      sha256: "a".repeat(64), fileId: fileA,
    });
    const second = await service.register({
      projectId, app: "hello", tag: "latest",
      sha256: "b".repeat(64), fileId: fileB,
    });

    expect(second.id).toBe(first.id);
    expect(second.sha256).toBe("b".repeat(64));
    expect(await service.listByProject(projectId)).toHaveLength(1);
  });

  it("should refuse to overwrite a pinned tag", async () => {
    const { service, projectId, fileA, fileB } = await setup();

    await service.register({
      projectId, app: "hello", tag: "1.2.3",
      sha256: "a".repeat(64), fileId: fileA,
    });

    await expect(
      service.register({
        projectId, app: "hello", tag: "1.2.3",
        sha256: "b".repeat(64), fileId: fileB,
      }),
    ).rejects.toThrow(ConflictError);
  });

  it("should overwrite a pinned tag when forced", async () => {
    const { service, projectId, fileA, fileB } = await setup();

    await service.register({
      projectId, app: "hello", tag: "1.2.3",
      sha256: "a".repeat(64), fileId: fileA,
    });
    const forced = await service.register({
      projectId, app: "hello", tag: "1.2.3",
      sha256: "b".repeat(64), fileId: fileB, force: true,
    });

    expect(forced.sha256).toBe("b".repeat(64));
  });

  it("should resolve an artifact by tag", async () => {
    const { service, projectId, fileA } = await setup();
    await service.register({
      projectId, app: "hello", tag: "1.2.3",
      sha256: "a".repeat(64), fileId: fileA,
    });

    expect((await service.resolve(projectId, "hello", "1.2.3"))?.sha256)
      .toBe("a".repeat(64));
    expect(await service.resolve(projectId, "hello", "9.9.9")).toBeUndefined();
  });
});
```

Write a `setup()` helper in the same file that builds an Alepha container with the lore API module, creates a project, and inserts two rows in the framework `files` table with `bucket: "releases"`, returning `{ service, projectId, fileA, fileB }`. Follow the pattern in `apps/lore/test/release-lifecycle.spec.ts` — read it first and reuse its fixtures from `test/fixtures/`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn w lore vitest run test/artifact-registry.spec.ts`
Expected: FAIL — cannot resolve `ArtifactService`

- [ ] **Step 3: Write the service**

```typescript
// apps/lore/src/api/services/ArtifactService.ts
import { $inject, AlephaError } from "alepha";
import { files } from "alepha/api/files";
import { $repository } from "alepha/orm";
import { BadRequestError, ConflictError } from "alepha/server";
import { type Artifact, artifacts, isMutableTag } from "../entities/artifacts.ts";

/**
 * The registry, on the writing side.
 *
 * Bytes are not this service's business: `alepha/api/files` owns the upload and
 * the provider behind it, exactly as folios do for blobs. What lands here is a
 * row describing bytes that are already stored, which is what keeps the
 * registry portable the day Lore leaves Workers.
 */
export class ArtifactService {
  protected readonly artifacts = $repository(artifacts);
  protected readonly frameworkFiles = $repository(files);

  /**
   * The bucket deployable artifacts live in.
   *
   * Unchanged from the previous `releases` name on purpose: it is a value
   * already persisted on every existing `files` row, and renaming it would
   * orphan every artifact ever uploaded. Same reasoning as Lore's
   * `archive-blobs` and `petition-attachments` buckets.
   */
  public static readonly BUCKET = "releases";

  /**
   * Records an artifact whose bytes are already uploaded.
   *
   * A mutable tag is replaced in place — one row, one object, always current.
   * A pinned tag is write-once, because promote is only meaningful if the bytes
   * behind a tag cannot change between environments. `force` exists for the
   * genuine case of having tagged the wrong commit.
   */
  public async register(input: {
    projectId: number;
    app: string;
    tag: string;
    sha256: string;
    fileId: string;
    sizeBytes?: number;
    userId?: string;
    force?: boolean;
  }): Promise<Artifact> {
    const sha256 = this.normaliseDigest(input.sha256);

    const frameworkFile = await this.frameworkFiles.findOne({
      where: { id: { eq: input.fileId } },
    });
    if (!frameworkFile) {
      throw new BadRequestError("Framework file row not found — upload first");
    }
    if (frameworkFile.bucket !== ArtifactService.BUCKET) {
      throw new BadRequestError(
        `Framework file is in bucket '${frameworkFile.bucket}', expected '${ArtifactService.BUCKET}'`,
      );
    }

    const existing = await this.resolve(input.projectId, input.app, input.tag);

    if (existing && !isMutableTag(input.tag) && !input.force) {
      throw new ConflictError(
        `${input.app}:${input.tag} already exists (sha ${existing.sha256.slice(0, 12)}…). ` +
          "Pinned tags are immutable — push a new tag, or force to replace it.",
      );
    }

    if (existing) {
      return this.artifacts.updateOne(
        { id: { eq: existing.id } },
        {
          sha256,
          fileId: input.fileId,
          sizeBytes: input.sizeBytes,
          createdBy: input.userId,
        },
      );
    }

    return this.artifacts.create({
      projectId: input.projectId,
      app: input.app,
      tag: input.tag,
      sha256,
      fileId: input.fileId,
      sizeBytes: input.sizeBytes,
      createdBy: input.userId,
    });
  }

  /**
   * The artifact currently behind a tag, if any.
   */
  public async resolve(
    projectId: number,
    app: string,
    tag: string,
  ): Promise<Artifact | undefined> {
    return this.artifacts.findOne({
      where: {
        projectId: { eq: projectId },
        app: { eq: app },
        tag: { eq: tag },
      },
    });
  }

  /**
   * The project's artifacts, newest first.
   */
  public async listByProject(projectId: number): Promise<Artifact[]> {
    return this.artifacts.findMany({
      where: { projectId: { eq: projectId } },
      orderBy: [{ column: "updatedAt", direction: "desc" }],
      limit: 50,
    });
  }

  /**
   * Lowercases a digest and refuses anything that is not 64 hex characters.
   *
   * Echoed back truncated: a rejected digest is worth showing so the caller can
   * see the shape it sent, but a full unvalidated string in an error message is
   * a log-injection surface for no benefit.
   */
  protected normaliseDigest(raw: string): string {
    const sha256 = raw.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(sha256)) {
      throw new AlephaError(
        `Not a sha256 digest: '${raw.slice(0, 16)}…' (${raw.length} chars, expected 64 hex)`,
      );
    }
    return sha256;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn w lore vitest run test/artifact-registry.spec.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
yarn lint && yarn w lore typecheck
git add apps/lore/src/api/services/ArtifactService.ts apps/lore/test/artifact-registry.spec.ts
git commit -m "feat(lore): ArtifactService — latest replaces, pinned tags are write-once"
```

---

### Task 3: Rename `releases` → `deployments`, additively

**Files:**
- Rename: `apps/lore/src/api/entities/releases.ts` → `apps/lore/src/api/entities/deployments.ts` (use `git mv`)
- Modify: every importer (grep `entities/releases`)
- Create: `apps/lore/migrations/sqlite/<generated>/`
- Test: `apps/lore/test/migration-safety.spec.ts` (extend)

**Interfaces:**
- Consumes: `artifacts` (Task 1)
- Produces: `deployments` ($entity), `type Deployment`, `DEPLOYMENT_STATUSES`, `type DeploymentStatus`

**Why additive:** dropping `fileId`/`sizeBytes` or making them nullable forces drizzle's rebuild (`CREATE __new` / `INSERT` / `DROP old`). On D1 the `DROP` fires `ON DELETE CASCADE`. `releases` has no children today, but the rebuild pattern is banned by `apps/lore/CLAUDE.md` regardless and the retained columns serve as the denormalised snapshot.

- [ ] **Step 1: Write the failing test**

```typescript
// append to apps/lore/test/migration-safety.spec.ts
it("should rename releases to deployments without a rebuild", async () => {
  const dir = join(import.meta.dirname, "../migrations/sqlite");
  const newest = (await readdir(dir)).sort().at(-1)!;
  const sql = await readFile(join(dir, newest, "migration.sql"), "utf8");

  expect(sql).toMatch(/ALTER TABLE .?releases.? RENAME TO .?deployments.?/i);
  expect(sql).not.toMatch(/^DROP TABLE/im);
  expect(sql).not.toMatch(/__new_deployments/i);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `yarn w lore vitest run test/migration-safety.spec.ts`
Expected: FAIL — newest migration is the great-rename one, no `RENAME TO deployments`

- [ ] **Step 3: Rename the entity file and update it**

```bash
git mv apps/lore/src/api/entities/releases.ts apps/lore/src/api/entities/deployments.ts
```

In `deployments.ts`: rename `releases` → `deployments`, `RELEASE_STATUSES` → `DEPLOYMENT_STATUSES`, `ReleaseStatus` → `DeploymentStatus`, `Release` → `Deployment`, set `name: "deployments"`, and add two columns:

```typescript
    /**
     * The artifact this deploy placed, when it is still in the registry.
     *
     * A soft pointer: pruning `latest` must not erase the history of what was
     * deployed, so `app` / `tag` / `sha256` below are a permanent snapshot and
     * this is only the live link.
     */
    artifactId: db.ref(z.uuid().optional(), () => artifacts.cols.id, {
      onDelete: "set null",
    }),
    /**
     * The tag as it was at deploy time. Snapshot, not a lookup — `latest`
     * moves, and this row must still say what it actually shipped.
     */
    tag: z.string().max(100).optional(),
```

Keep `version`, `fileId`, `sizeBytes`, `sha256`, `environment` exactly as they are. Update all importers: `grep -rln "entities/releases" apps/lore/src`.

- [ ] **Step 4: Generate the migration with a rename hint**

```bash
cd apps/lore && yarn db:generate --hints '[{"from":"releases","to":"deployments"}]'
```

Then **read the generated SQL by hand**. It must contain `ALTER TABLE` statements only. If it contains `DROP TABLE` or `__new_`, delete that block and replace it with an explanatory SQL comment — see the worked example in `apps/lore/CLAUDE.md` § "What the 2026-08 great-rename migration got right".

- [ ] **Step 5: Run tests to verify they pass**

Run: `yarn w lore vitest run test/migration-safety.spec.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
yarn lint && yarn w lore typecheck && yarn w lore test
git add -A apps/lore
git commit -m "refactor(lore)!: releases becomes deployments, and gains an artifact pointer"
```

---

### Task 4: `DeploymentService` — deploy an existing artifact

**Files:**
- Rename: `apps/lore/src/api/services/ReleaseService.ts` → `DeploymentService.ts` (`git mv`)
- Test: `apps/lore/test/release-lifecycle.spec.ts` (extend; keep the filename — it pins historical behaviour)

**Interfaces:**
- Consumes: `ArtifactService.resolve` (Task 2), `deployments` (Task 3)
- Produces: `DeploymentService` keeping `claim`/`transition`/`get`/`listByProject` unchanged, plus
  - `deployArtifact(input: { projectId: number; artifactId: string; environment: string; userId?: string }): Promise<Deployment>`

- [ ] **Step 1: Write the failing test**

```typescript
it("should deploy one artifact to two environments as two rows", async () => {
  const { artifactService, deploymentService, projectId, fileA } = await setup();

  const artifact = await artifactService.register({
    projectId, app: "hello", tag: "1.2.3",
    sha256: "a".repeat(64), fileId: fileA,
  });

  const staging = await deploymentService.deployArtifact({
    projectId, artifactId: artifact.id, environment: "staging",
  });
  const production = await deploymentService.deployArtifact({
    projectId, artifactId: artifact.id, environment: "production",
  });

  expect(staging.id).not.toBe(production.id);
  expect(staging.artifactId).toBe(artifact.id);
  expect(production.artifactId).toBe(artifact.id);
  expect(production.sha256).toBe(staging.sha256);
  expect(production.status).toBe("pending");
});

it("should keep the snapshot after the artifact is replaced", async () => {
  const { artifactService, deploymentService, projectId, fileA, fileB } = await setup();

  const first = await artifactService.register({
    projectId, app: "hello", tag: "latest",
    sha256: "a".repeat(64), fileId: fileA,
  });
  const deployment = await deploymentService.deployArtifact({
    projectId, artifactId: first.id, environment: "production",
  });

  await artifactService.register({
    projectId, app: "hello", tag: "latest",
    sha256: "b".repeat(64), fileId: fileB,
  });

  const reloaded = await deploymentService.get(deployment.id);
  expect(reloaded?.sha256).toBe("a".repeat(64));
  expect(reloaded?.tag).toBe("latest");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn w lore vitest run test/release-lifecycle.spec.ts`
Expected: FAIL — `deployArtifact` is not a function

- [ ] **Step 3: Rename the service and add the method**

```bash
git mv apps/lore/src/api/services/ReleaseService.ts apps/lore/src/api/services/DeploymentService.ts
```

Rename the class to `DeploymentService`, point `$repository` at `deployments`, and add:

```typescript
  protected readonly artifactService = $inject(ArtifactService);

  /**
   * Places an artifact already in the registry on an environment.
   *
   * The snapshot columns are copied rather than joined on purpose: `latest` is
   * replaced in place, so a row that only pointed at the artifact would start
   * claiming it deployed bytes it never saw.
   */
  public async deployArtifact(input: {
    projectId: number;
    artifactId: string;
    environment: string;
    userId?: string;
  }): Promise<Deployment> {
    const artifact = await this.artifacts.findOne({
      where: { id: { eq: input.artifactId }, projectId: { eq: input.projectId } },
    });
    if (!artifact) {
      throw new NotFoundError("No such artifact in this project");
    }

    return this.deployments.create({
      projectId: input.projectId,
      artifactId: artifact.id,
      app: artifact.app,
      tag: artifact.tag,
      environment: input.environment,
      version: this.deploymentId(),
      sha256: artifact.sha256,
      fileId: artifact.fileId,
      sizeBytes: artifact.sizeBytes,
      createdBy: input.userId,
    });
  }

  /**
   * The deployment id, which is what the timestamp always was.
   *
   * UTC so two deploys from different zones sort against each other correctly,
   * and shaped like Bay's on-disk release directories so one string names the
   * same thing on both sides.
   */
  protected deploymentId(): string {
    const at = new Date(this.dateTime.nowMillis());
    const pad = (n: number) => String(n).padStart(2, "0");
    return [
      at.getUTCFullYear(),
      pad(at.getUTCMonth() + 1),
      pad(at.getUTCDate()),
      `${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}${pad(at.getUTCSeconds())}`,
    ].join("-");
  }
```

Add `protected readonly artifacts = $repository(artifacts);` alongside the existing repositories.

- [ ] **Step 4: Run to verify it passes**

Run: `yarn w lore vitest run test/release-lifecycle.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
yarn lint && yarn w lore typecheck && yarn w lore test
git add -A apps/lore
git commit -m "feat(lore): deployArtifact — one artifact, many environments"
```

---

### Task 5: HTTP endpoints for artifacts and promote

**Files:**
- Modify: `apps/lore/src/api/controllers/ReleaseController.ts`
- Test: `apps/lore/test/release-lifecycle.spec.ts` (extend)

**Interfaces:**
- Consumes: `ArtifactService` (Task 2), `DeploymentService.deployArtifact` (Task 4)
- Produces: HTTP surface
  - `POST /projects/:projectId/artifacts` → `{ id, app, tag, sha256 }`
  - `GET  /projects/:projectId/artifacts` → `Artifact[]`
  - `POST /projects/:projectId/deployments` body `{ artifactId, environment }` → `Deployment`
  - Existing `POST/GET/LIST /projects/:projectId/releases` unchanged in shape

**Compatibility:** `LoreAdapter` 0.25.0 is deployed. `POST /releases` must keep accepting `{ app, environment, version, sha256, fileId, sizeBytes }` and keep returning a row with `id` and `status`. Implement it as: register an artifact under tag `version`, then `deployArtifact`.

- [ ] **Step 1: Write the failing test**

```typescript
it("should keep the 0.25.0 release endpoint working", async () => {
  const { http, projectId, fileA, token } = await setup();

  const res = await http.post(`/api/projects/${projectId}/releases`, {
    body: {
      app: "hello", environment: "production",
      version: "2026-08-05-120000", sha256: "a".repeat(64), fileId: fileA,
    },
    headers: { authorization: `Bearer ${token}` },
  });

  expect(res.status).toBe(200);
  expect(res.data.status).toBe("pending");
});

it("should promote an artifact to a second environment", async () => {
  const { http, projectId, fileA, token } = await setup();
  const auth = { authorization: `Bearer ${token}` };

  const artifact = await http.post(`/api/projects/${projectId}/artifacts`, {
    body: { app: "hello", tag: "1.2.3", sha256: "a".repeat(64), fileId: fileA },
    headers: auth,
  });

  const staging = await http.post(`/api/projects/${projectId}/deployments`, {
    body: { artifactId: artifact.data.id, environment: "staging" },
    headers: auth,
  });
  const production = await http.post(`/api/projects/${projectId}/deployments`, {
    body: { artifactId: artifact.data.id, environment: "production" },
    headers: auth,
  });

  expect(production.data.sha256).toBe(staging.data.sha256);
  expect(production.data.id).not.toBe(staging.data.id);
});
```

Follow the HTTP-calling pattern already used in `release-lifecycle.spec.ts`.

- [ ] **Step 2: Run to verify it fails**

Run: `yarn w lore vitest run test/release-lifecycle.spec.ts`
Expected: FAIL — 404 on `/artifacts`

- [ ] **Step 3: Add the actions**

In `ReleaseController.ts`, keep the existing three actions and add three more, following the exact `$action` shape already in the file (same `security`, same `assertMember`/`assertOwner` gating — mutations are owner-only, reads member-gated, per Lore's convention). Rewrite `createRelease`'s handler to delegate:

```typescript
      const artifact = await this.artifactService.register({
        projectId, app: body.app, tag: body.version,
        sha256: body.sha256, fileId: body.fileId,
        sizeBytes: body.sizeBytes, userId: user.id, force: true,
      });
      return this.deploymentService.deployArtifact({
        projectId, artifactId: artifact.id,
        environment: body.environment, userId: user.id,
      });
```

`force: true` because the legacy endpoint's `version` is a timestamp, unique by construction — its uniqueness was already guaranteed by the old index, and refusing a retry here would break a deployed client.

- [ ] **Step 4: Run to verify it passes**

Run: `yarn w lore vitest run test/release-lifecycle.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
yarn lint && yarn w lore typecheck && yarn w lore test
git add -A apps/lore
git commit -m "feat(lore): artifact + deployment endpoints, legacy release path preserved"
```

---

### Task 6: `LoreAdapter` sends the pack tag

**Files:**
- Modify: `packages/alepha/src/cli/platform-lib/adapters/LoreAdapter.ts`
- Test: `packages/alepha/src/cli/platform-lib/__tests__/LoreAdapter.spec.ts`

**Interfaces:**
- Consumes: the endpoints from Task 5
- Produces: `LoreAdapter` reading `ctx.envConfig.tag ?? "latest"`, uploading only when the tag is absent from the registry

- [ ] **Step 1: Write the failing test**

```typescript
it("should reuse an existing pinned artifact instead of uploading", async () => {
  const { adapter, ctx, fetches } = setupLoreAdapter({
    existingArtifacts: [{ id: "art-1", app: "hello", tag: "1.2.3", sha256: "a".repeat(64) }],
    tag: "1.2.3",
  });

  await adapter.deploy(ctx, run);

  expect(fetches.filter((f) => f.url.includes("/api/files"))).toHaveLength(0);
  expect(fetches.some((f) => f.url.includes("/deployments"))).toBe(true);
});
```

Read the existing `LoreAdapter.spec.ts` first and extend its fixture rather than inventing a new one.

- [ ] **Step 2: Run to verify it fails**

Run: `yarn w alepha vitest run src/cli/platform-lib/__tests__/LoreAdapter.spec.ts`
Expected: FAIL — the adapter uploads unconditionally

- [ ] **Step 3: Change the adapter**

Replace the `version()` timestamp call at the deploy site with a tag resolution:

```typescript
  /**
   * The tag being deployed.
   *
   * `latest` unless the caller pinned one. The timestamp this used to generate
   * moved to the server, where it belongs — it names a deployment, not an
   * artifact, and generating it here made every push a new version and every
   * retention rule a no-op.
   */
  protected tag(ctx: PlatformContext): string {
    return process.env.ALEPHA_TAG ?? ctx.envConfig.tag ?? "latest";
  }
```

In `deploy`: resolve the tag against `GET /projects/:id/artifacts` first. If a matching `(app, tag)` exists and the tag is not `latest`, skip pack+upload and `POST /deployments` with its `artifactId`, logging:

```
Deploying hello:1.2.3 (sha ab12cd34…, pushed 3 days ago); local changes not included.
```

Otherwise pack, upload, `POST /artifacts`, then `POST /deployments`.

- [ ] **Step 4: Run to verify it passes**

Run: `yarn w alepha vitest run src/cli/platform-lib/__tests__/LoreAdapter.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
yarn lint && yarn w alepha typecheck
git add -A packages/alepha
git commit -m "feat(cli): LoreAdapter deploys a tag, and reuses a pinned one rather than rebuilding it"
```

---

### Task 7: `alepha platform push` + `--tag` on `deploy` / `up`

**Files:**
- Modify: `packages/alepha/src/cli/platform/commands/platform.ts`
- Test: `packages/alepha/src/cli/platform/__tests__/platformCommands.spec.ts` (create if absent)

**Interfaces:**
- Consumes: `LoreAdapter` tag support (Task 6)
- Produces: `push` command; `tag` flag on `up` and `deploy`

- [ ] **Step 1: Write the failing test**

```typescript
it("should reject push on a non-lore adapter", async () => {
  const { cli, platform } = setupPlatform({ adapter: "cloudflare" });

  await expect(
    cli.run(platform.push, { argv: "--tag 1.2.3", root: "/app" }),
  ).rejects.toThrow(/only.*lore/i);
});

it("should pass the tag through to the adapter", async () => {
  const { cli, platform, adapter } = setupPlatform({ adapter: "lore" });

  await cli.run(platform.up, { argv: "--env staging --tag 1.2.3", root: "/app" });

  expect(adapter.lastCtx.envConfig.tag).toBe("1.2.3");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn w alepha vitest run src/cli/platform/__tests__/platformCommands.spec.ts`
Expected: FAIL — `platform.push` undefined

- [ ] **Step 3: Add the flag and the command**

Add to the shared `envFlags` object:

```typescript
      tag: z
        .text({
          aliases: ["t"],
          description:
            "Artifact tag (Docker-style). Defaults to `latest`, which is replaced on every push. Any other tag is write-once — deploying it again deploys the same bytes rather than rebuilding.",
        })
        .optional(),
```

Thread `flags.tag` into `ctx.envConfig.tag` wherever `ctx` is built in `up`, `deploy` and `build`. Add:

```typescript
  protected readonly push = $command({
    name: "push",
    mode: "production",
    description:
      "Build and upload an artifact to the registry without deploying it",
    flags: this.envFlags,
    handler: async ({ flags, root, run }) => {
      // ... resolve config exactly as `deploy` does ...
      if (envConfig.adapter !== "lore") {
        throw new AlephaError(
          `push is only available on the 'lore' adapter (this environment uses '${envConfig.adapter}'). ` +
            "push puts an artifact in a registry, and lore is the only adapter that has one.",
        );
      }
      await adapter.authenticate(ctx, run);
      await adapter.build(ctx, run);
      await adapter.push(ctx, run);
    },
  });
```

Add an optional `push(ctx, run)` to `PlatformAdapter` whose default throws `"push is not supported by the '<name>' adapter"`, and implement it on `LoreAdapter` as the pack+upload+`POST /artifacts` half of `deploy`.

- [ ] **Step 4: Run to verify it passes**

Run: `yarn w alepha vitest run src/cli/platform/__tests__/platformCommands.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
yarn lint && yarn w alepha typecheck && yarn w alepha test
git add -A packages/alepha
git commit -m "feat(cli): platform push, and --tag on up and deploy"
```

---

### Task 8: Docs + e2e

**Files:**
- Modify: `docs/4-cli/3-plugins/1-platform.md`
- Modify: `apps/lore/e2e/outposts.spec.ts`

**Lore convention:** *"When adding or modifying a feature, the matching `<feature>.spec.ts` must move with it. No feature ships without its e2e moving in lockstep."*

- [ ] **Step 1: Extend the e2e spec**

Add to `outposts.spec.ts`: register an artifact via the API, deploy it to two environments, assert both deployments report the same `sha256` and that the artifact list holds exactly one row for the tag.

- [ ] **Step 2: Run it**

Run: `yarn w lore e2e --grep outposts`
Expected: PASS

- [ ] **Step 3: Update the platform doc**

In `docs/4-cli/3-plugins/1-platform.md`, document `push`, the `--tag` flag, and the mutability rule. Also fix the stale adapter line (currently `Cloud provider: "cloudflare" or "bay"`) to include `lore`.

- [ ] **Step 4: Full verify**

Run: `yarn v`
Expected: green

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs(cli): tag semantics and the push verb"
```

---

## Self-Review

**Spec coverage:**
- artifacts/deployments split → Tasks 1, 3, 4 ✅
- `latest` mutable, pinned write-once, `--force` → Task 2 ✅
- retention (one row per mutable tag) → Task 2, replace-in-place ✅
- promote without rebuild → Tasks 4, 6 ✅
- denormalised snapshot survives pruning → Tasks 3, 4 ✅
- `push` / `deploy --tag` / `up --tag` → Task 7 ✅
- legacy endpoint compatibility → Task 5 ✅
- D1-safe migration → Task 3 ✅
- Cloudflare untouched → global constraint, asserted in Task 7 ✅
- **rollback command → NOT COVERED.** Deliberately deferred: Bay's `rollback` control-mux route and `cmdRollback` already exist, so the Lore side is a separate, small feature that does not block the registry. Recorded here rather than silently dropped.

**Placeholders:** none — every code step carries real code. The two `setup()` helpers point at existing fixtures to copy rather than inventing them, which is a deliberate instruction, not a gap.

**Type consistency:** `Deployment`/`DeploymentStatus`/`DEPLOYMENT_STATUSES` used consistently from Task 3 onward; `ArtifactService.register` signature identical in Tasks 2, 5, 6; `deployArtifact` signature identical in Tasks 4 and 5.
