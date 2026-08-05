import { Alepha } from "alepha";
import { files } from "alepha/api/files";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake } from "alepha/fake";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, ServerProvider } from "alepha/server";
import { AlephaServerCors } from "alepha/server/cors";
import { describe, expect, it } from "vitest";
import { outposts } from "../src/api/entities/outposts.ts";
import { projects } from "../src/api/entities/projects.ts";
import { releases } from "../src/api/entities/releases.ts";
import { LoreApi } from "../src/api/index.ts";
import { OutpostTokenService } from "../src/api/services/OutpostTokenService.ts";
import { ReleaseService } from "../src/api/services/ReleaseService.ts";

class Probe {
  projects = $repository(projects);
  outposts = $repository(outposts);
  releases = $repository(releases);
  files = $repository(files);
}

/**
 * Boots a real HTTP server, a project, two enrolled machines and one artifact.
 *
 * Two outposts because the interesting refusals are between machines, not
 * between a machine and an anonymous caller: the credential is designed to be
 * cheap to hand out, so "a valid token that is not yours" is the case worth
 * pinning.
 */
const setup = async () => {
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      SERVER_PORT: 0,
      SERVER_HOST: "127.0.0.1",
      DATABASE_URL: ":memory:",
      PUBLIC_URL: "https://lore.test",
    },
  });

  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaServerCors);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with(LoreApi);

  const probe = alepha.inject(Probe);
  const tokens = alepha.inject(OutpostTokenService);
  const service = alepha.inject(ReleaseService);
  const server = alepha.inject(ServerProvider);
  const users = alepha.inject(UserService);
  await alepha.start();

  const owner = await users.createUser({ username: "owner" });
  const project = await probe.projects.create({
    title: "Test",
    createdBy: owner.id,
  } as any);

  const enrol = async (label: string) => {
    const minted = tokens.mint();
    const outpost = await probe.outposts.create({
      projectId: project.id,
      label,
      tokenHash: minted.hash,
      tokenPrefix: minted.prefix,
      createdBy: owner.id,
    });
    return { outpost, token: minted.token };
  };

  const bay = await enrol("OVH Bay");
  const other = await enrol("Another Bay");

  const file = await probe.files.create({
    blobId: "blob-1",
    bucket: ReleaseService.BUCKET,
    name: "lindocara-main-latest.tar.gz",
    size: 1024,
    mimeType: "application/gzip",
  });

  // No default token: passing `undefined` has to MEAN "send no header". The
  // same helper with a default silently turned the unauthenticated case into
  // an authenticated one in the ingest spec, and the test passed against a 204
  // it should have refused.
  const call = (
    path: string,
    token: string | undefined,
    body?: unknown,
    method = "POST",
  ) =>
    fetch(`${server.hostname}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const addRelease = (version: string) =>
    service.register({
      projectId: project.id,
      app: "lindocara-main",
      environment: "production",
      version,
      sha256: "c".repeat(64),
      fileId: file.id,
    });

  return { alepha, probe, bay, other, call, addRelease };
};

describe("outpost command channel", () => {
  it("refuses a missing, malformed or unknown token alike", async () => {
    const { call } = await setup();

    for (const token of [undefined, "not-a-bearer", "op_wrong"]) {
      const res = await call("/outposts/commands", token);
      expect(res.status).toBe(401);
    }
  });

  it("answers 204 when there is nothing to do", async () => {
    const { bay, call } = await setup();

    const res = await call("/outposts/commands", bay.token);

    expect(res.status).toBe(204);
  });

  it("hands a pending release over once, and not twice", async () => {
    const { bay, call, addRelease } = await setup();
    const release = await addRelease("2026-08-03-120000");

    const first = await call("/outposts/commands", bay.token);
    expect(first.status).toBe(200);
    const body = (await first.json()) as any;
    expect(body.deploy.releaseId).toBe(release.id);
    expect(body.deploy.sha256).toBe("c".repeat(64));
    expect(body.deploy.downloadUrl).toBe(
      `https://lore.test/outposts/artifacts/${release.id}`,
    );

    // Claimed by the first caller, so the channel has nothing left to say —
    // otherwise two machines deploy the same release and race for the same
    // systemd unit.
    const second = await call("/outposts/commands", bay.token);
    expect(second.status).toBe(204);
  });

  it("refuses a status report about a release claimed by another machine", async () => {
    const { bay, other, call, addRelease } = await setup();
    const release = await addRelease("2026-08-03-120000");
    await call("/outposts/commands", bay.token);

    const res = await call(
      `/outposts/releases/${release.id}/status`,
      other.token,
      { status: "failed", failureReason: "not mine to fail" },
    );

    expect(res.status).toBe(404);
  });

  it("records the transitions the claiming machine reports", async () => {
    const { probe, bay, call, addRelease } = await setup();
    const release = await addRelease("2026-08-03-120000");
    await call("/outposts/commands", bay.token);

    for (const status of ["pulling", "migrating", "serving"]) {
      const res = await call(
        `/outposts/releases/${release.id}/status`,
        bay.token,
        { status },
      );
      expect(res.status).toBe(204);
    }

    const stored = await probe.releases.findOne({
      where: { id: { eq: release.id } },
    });
    expect(stored?.status).toBe("serving");
    expect(stored?.outpostId).toBe(bay.outpost.id);
  });

  it("keeps Bay's own words when a deploy fails", async () => {
    const { probe, bay, call, addRelease } = await setup();
    const release = await addRelease("2026-08-03-120000");
    await call("/outposts/commands", bay.token);

    await call(`/outposts/releases/${release.id}/status`, bay.token, {
      status: "failed",
      failureReason: "rebuild with --target=bare",
    });

    const stored = await probe.releases.findOne({
      where: { id: { eq: release.id } },
    });
    expect(stored?.failureReason).toBe("rebuild with --target=bare");
  });

  it("refuses to reopen a release that already finished", async () => {
    const { bay, call, addRelease } = await setup();
    const release = await addRelease("2026-08-03-120000");
    await call("/outposts/commands", bay.token);
    await call(`/outposts/releases/${release.id}/status`, bay.token, {
      status: "serving",
    });

    // A machine killed mid-deploy can come back and report something stale.
    // The client has already concluded; the row must not move.
    const res = await call(
      `/outposts/releases/${release.id}/status`,
      bay.token,
      { status: "failed", failureReason: "late news" },
    );

    expect(res.status).toBe(409);
  });

  it("refuses artifact bytes to a machine that did not claim the release", async () => {
    const { bay, other, call, addRelease } = await setup();
    const release = await addRelease("2026-08-03-120000");
    await call("/outposts/commands", bay.token);

    const res = await call(
      `/outposts/artifacts/${release.id}`,
      other.token,
      undefined,
      "GET",
    );

    expect(res.status).toBe(404);
  });
});
