import {
  HostCommandTransport,
  HostJobController,
  ProjectHostController,
  ProjectSecurityService,
} from "@lore/core/api";
import { type Host, hostJobs, projects } from "@lore/core/schemas";
import {
  createTestMemberByProjectId,
  createTestProject,
} from "@lore/core/testing";
import { createTestHost } from "@lore/core/testing/hosts";
import { LorePromptsApi } from "@lore/prompts/api";
import { LoreShipApi } from "@lore/ship/api";
import { DeployTestEntities } from "@lore/ship/testing";
import { Alepha } from "alepha";
import { RankService } from "alepha/api/organizations";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, ForbiddenError, NotFoundError } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

class ConnectedTransport extends HostCommandTransport {
  override async push(_host: Host, _frame: unknown): Promise<boolean> {
    return true;
  }
}

class Repos {
  jobs = $repository(hostJobs);
  projects = $repository(projects);
}

const SECRET = "Rewrite the billing module of the borrower";

/**
 * A host of project Home, lent to project Borrower:
 *
 * - `lin` owns both, and lends it;
 * - `ada` operates the machine in Home (`host:read`, `host:update`) and is
 *   no member of Borrower;
 * - `bob` reads the hosts of Home (`host:read`) and nothing more;
 * - `grace` is a member of Borrower alone.
 *
 * Two jobs ran on it: Home's capability check, then Borrower's agent job.
 */
const setup = async () => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
  });
  alepha.with({ provide: HostCommandTransport, use: ConnectedTransport });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(LoreShipApi);
  alepha.with(LorePromptsApi);
  const entities = alepha.inject(DeployTestEntities);
  const repos = alepha.inject(Repos);
  await alepha.start();

  const person = async (username: string): Promise<UserAccountToken> => {
    const user = await entities.users.create({ username });
    return { id: user.id, roles: ["user"] };
  };
  const lin = await person("lin");
  const ada = await person("ada");
  const bob = await person("bob");
  const grace = await person("grace");

  const host = await createTestHost(alepha, lin, { slug: "box-1" });
  const homeId = host.projectId;
  const borrower = await createTestProject(alepha, { createdBy: lin.id });
  await alepha
    .inject(ProjectHostController)
    .attachHost(
      { params: { projectId: borrower.id }, body: { hostId: host.id } },
      { user: lin },
    );

  const organizationId = await alepha
    .inject(ProjectSecurityService)
    .organizationIdOf(homeId);
  const ranks = alepha.inject(RankService);
  await ranks.save(
    organizationId,
    {
      key: "operator",
      name: "Operator",
      permissions: ["project:read", "host:read", "host:update"],
    },
    lin,
  );
  await ranks.save(
    organizationId,
    {
      key: "reader",
      name: "Reader",
      permissions: ["project:read", "host:read"],
    },
    lin,
  );
  await createTestMemberByProjectId(alepha, homeId, ada.id, {
    rank: "operator",
  });
  await createTestMemberByProjectId(alepha, homeId, bob.id, {
    rank: "reader",
  });
  await createTestMemberByProjectId(alepha, borrower.id, grace.id);

  const check = await repos.jobs.create({
    projectId: homeId,
    hostId: host.id,
    kind: "check",
    status: "succeeded",
    input: { timeoutSeconds: 120 },
    subjectType: "host",
    subjectId: host.id,
    queuedAt: "2026-11-26T10:00:00.000Z",
    startedAt: "2026-11-26T10:00:01.000Z",
    endedAt: "2026-11-26T10:00:09.000Z",
  });
  const theirs = await repos.jobs.create({
    projectId: borrower.id,
    hostId: host.id,
    kind: "agent",
    status: "queued",
    input: { prompt: SECRET, timeoutSeconds: 600, workspace: "q12" },
    startedBy: grace.id,
    subjectType: "quest",
    subjectId: "12",
    prompt: "work-quest",
    args: [
      {
        name: "quest",
        type: "quest",
        value: "12",
        reference: "#Q12",
        title: "Billing rewrite",
      },
    ],
    cause: { kind: "hand" },
    reason: "Waiting on the billing workspace",
    queuedAt: "2026-11-26T11:00:00.000Z",
    turns: 4,
    inputTokens: 1200,
    outputTokens: 300,
  });

  return {
    alepha,
    repos,
    controller: alepha.inject(HostJobController),
    lin,
    ada,
    bob,
    grace,
    hostId: host.id,
    homeId,
    borrower,
    check,
    theirs,
  };
};

type World = Awaited<ReturnType<typeof setup>>;

describe("A host's jobs, read from its console (#Q4524)", () => {
  let w: World;

  beforeEach(async () => {
    w = await setup();
  });

  afterEach(async () => {
    await w.alepha.stop();
  });

  it("lists every job of the machine to a home member, newest first, whatever its project", async ({
    expect,
  }) => {
    const { items } = await w.controller.listHostJobs(
      { params: { hostId: w.hostId }, query: {} },
      { user: w.ada },
    );
    expect(items.map((it) => it.id)).toEqual([w.theirs.id, w.check.id]);
    expect(items.map((it) => it.project.id)).toEqual([w.borrower.id, w.homeId]);
  });

  it("answers a job of a project the reader is no member of with what the machine knows, and nothing the project wrote", async ({
    expect,
  }) => {
    const { items } = await w.controller.listHostJobs(
      { params: { hostId: w.hostId }, query: {} },
      { user: w.ada },
    );
    const row = items.find((it) => it.id === w.theirs.id);
    // The whole row: a field more is a leak.
    expect(row).toEqual({
      id: w.theirs.id,
      kind: "agent",
      status: "queued",
      queuedAt: "2026-11-26T11:00:00.000Z",
      project: {
        id: w.borrower.id,
        title: w.borrower.title,
        ...(w.borrower.slug ? { slug: w.borrower.slug } : {}),
      },
      readable: false,
      turns: 4,
      inputTokens: 1200,
      outputTokens: 300,
    });
    const wire = JSON.stringify(items);
    expect(wire).not.toContain(SECRET);
    expect(wire).not.toContain("Billing rewrite");
    expect(wire).not.toContain("grace");
  });

  it("answers the same job whole to a member of both projects", async ({
    expect,
  }) => {
    const { items } = await w.controller.listHostJobs(
      { params: { hostId: w.hostId }, query: {} },
      { user: w.lin },
    );
    const row = items.find((it) => it.id === w.theirs.id);
    expect(row).toMatchObject({
      readable: true,
      prompt: "work-quest",
      args: [{ reference: "#Q12", title: "Billing rewrite" }],
      subjectType: "quest",
      subjectId: "12",
      startedByName: "grace",
      cause: { kind: "hand" },
      reason: "Waiting on the billing workspace",
    });
    // The rendered prompt is the job page's, never a list's.
    expect(JSON.stringify(items)).not.toContain(SECRET);
  });

  it("reads its own project's jobs whole, as a home member", async ({
    expect,
  }) => {
    const { items } = await w.controller.listHostJobs(
      { params: { hostId: w.hostId }, query: {} },
      { user: w.bob },
    );
    expect(items.find((it) => it.id === w.check.id)).toMatchObject({
      readable: true,
      subjectType: "host",
    });
    expect(items.find((it) => it.id === w.theirs.id)?.readable).toBe(false);
  });

  it("is refused to a member of a borrowing project alone", async ({
    expect,
  }) => {
    await expect(
      w.controller.listHostJobs(
        { params: { hostId: w.hostId }, query: {} },
        { user: w.grace },
      ),
    ).rejects.toThrow(ForbiddenError);
  });

  it("lets host:update in the home project cancel another project's job, and answers it redacted", async ({
    expect,
  }) => {
    const row = await w.controller.cancelHostJob(
      { params: { hostId: w.hostId, jobId: w.theirs.id } },
      { user: w.ada },
    );
    expect(row.status).toBe("cancelled");
    expect(row.readable).toBe(false);
    expect(row).not.toHaveProperty("prompt");
    expect(row).not.toHaveProperty("reason");
    const stored = await w.repos.jobs.getOne({
      where: { id: { eq: w.theirs.id } },
    });
    expect(stored.status).toBe("cancelled");
  });

  it("refuses the cancel to a home member who only reads hosts", async ({
    expect,
  }) => {
    await expect(
      w.controller.cancelHostJob(
        { params: { hostId: w.hostId, jobId: w.theirs.id } },
        { user: w.bob },
      ),
    ).rejects.toThrow(ForbiddenError);
  });

  it("answers 404 to the cancel of a job that ran on another host", async ({
    expect,
  }) => {
    const other = await createTestHost(w.alepha, w.lin, { slug: "box-2" });
    await createTestMemberByProjectId(w.alepha, other.projectId, w.ada.id);
    const elsewhere = await w.repos.jobs.create({
      projectId: w.borrower.id,
      hostId: other.id,
      kind: "agent",
      status: "queued",
      input: { timeoutSeconds: 600 },
      queuedAt: "2026-11-26T12:00:00.000Z",
    });
    await expect(
      w.controller.cancelHostJob(
        { params: { hostId: w.hostId, jobId: elsewhere.id } },
        { user: w.ada },
      ),
    ).rejects.toThrow(NotFoundError);
    const stored = await w.repos.jobs.getOne({
      where: { id: { eq: elsewhere.id } },
    });
    expect(stored.status).toBe("queued");
  });
});
