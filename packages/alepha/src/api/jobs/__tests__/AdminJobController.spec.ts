import { $inject, Alepha, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { $role, AlephaSecurity, type UserAccountToken } from "alepha/security";
import { ConflictError, ForbiddenError, NotFoundError } from "alepha/server";
import { describe, it } from "vitest";

import {
  $job,
  AdminJobController,
  AlephaApiJobs,
  JobService,
  jobExecutionEntity,
} from "../index.ts";

class Roles {
  reader = $role({
    name: "job-reader",
    permissions: [{ name: "admin:job:read" }],
  });

  cleaner = $role({
    name: "job-cleaner",
    permissions: [{ name: "admin:job:read" }, { name: "admin:job:delete" }],
  });
}

class OpsApp {
  executions = $repository(jobExecutionEntity);
  now = $inject(DateTimeProvider);

  work = $job({
    schema: z.object({ v: z.integer() }),
    handler: async () => {},
  });
}

const user = (role: string): UserAccountToken => ({
  id: "00000000-0000-4000-8000-00000000abcd",
  realm: "default",
  roles: [role],
});

type Status =
  | "pending"
  | "running"
  | "scheduled"
  | "ok"
  | "error"
  | "cancelled";

/**
 * Six rows of `OpsApp.work`, created an hour apart (row 0 oldest), with a
 * status, a trigger, a key and an attempt each, so every sort and filter has
 * something to separate.
 */
const FIXTURE: Array<{
  label: string;
  status: Status;
  triggeredBy?: string;
  key?: string;
  attempt: number;
  started: boolean;
}> = [
  {
    label: "a",
    status: "ok",
    triggeredBy: "system",
    attempt: 1,
    started: true,
  },
  {
    label: "b",
    status: "error",
    triggeredBy: "user-1",
    key: "invoice-42",
    attempt: 3,
    started: true,
  },
  { label: "c", status: "pending", attempt: 0, started: false },
  {
    label: "d",
    status: "running",
    triggeredBy: "system",
    attempt: 2,
    started: true,
  },
  {
    label: "e",
    status: "cancelled",
    triggeredBy: "user-2",
    key: "invoice-7",
    attempt: 1,
    started: false,
  },
  { label: "f", status: "scheduled", attempt: 0, started: false },
];

const nowIso = (app: OpsApp): string => app.now.now().toISOString();

const boot = async () => {
  const alepha = Alepha.create()
    .with(AlephaOrmPostgres)
    .with(AlephaSecurity)
    .with(AlephaApiJobs);
  alepha.inject(Roles);
  const app = alepha.inject(OpsApp);
  await alepha.start();

  // A fixed clock: the window filters compute their bounds from it again.
  const now = alepha.inject(DateTimeProvider).pause();
  const ids: Record<string, string> = {};
  for (let i = 0; i < FIXTURE.length; i++) {
    const row = FIXTURE[i];
    const created = now.subtract((FIXTURE.length - i) * 60, "minute");
    const inserted = await app.executions.create({
      jobName: "OpsApp.work",
      status: row.status,
      attempt: row.attempt,
      maxAttempts: 3,
      key: row.key,
      triggeredBy: row.triggeredBy,
      payload: { v: i },
      logs: [
        {
          level: "INFO",
          message: `row ${row.label}`,
          service: "test",
          module: "test",
          timestamp: created.valueOf(),
        } as any,
      ],
      createdAt: created.toISOString(),
      updatedAt: created.toISOString(),
      // Started rows start in the reverse order they were created, so a
      // `startedAt` sort cannot pass by echoing `createdAt`.
      startedAt: row.started
        ? now.subtract(i * 10, "minute").toISOString()
        : undefined,
      completedAt: ["ok", "error", "cancelled"].includes(row.status)
        ? created.add(1, "minute").toISOString()
        : undefined,
    });
    ids[row.label] = inserted.id;
  }

  const labelOf = (id: string) =>
    Object.entries(ids).find(([, value]) => value === id)?.[0];

  return {
    alepha,
    app,
    ids,
    labelOf,
    service: alepha.inject(JobService),
    controller: alepha.inject(AdminJobController),
  };
};

describe("AdminJobController — executions page", () => {
  it("pages newest created first by default, with a total, and without payload or logs", async ({
    expect,
  }) => {
    const { service, labelOf } = await boot();

    const page = await service.getExecutions("OpsApp.work", { size: 4 });

    expect(page.content.map((r) => labelOf(r.id))).toEqual([
      "f",
      "e",
      "d",
      "c",
    ]);
    expect(page.page.totalElements).toBe(6);
    for (const row of page.content) {
      expect(row).not.toHaveProperty("payload");
      expect(row).not.toHaveProperty("logs");
    }

    const second = await service.getExecutions("OpsApp.work", {
      size: 4,
      page: 1,
    });
    expect(second.content.map((r) => labelOf(r.id))).toEqual(["b", "a"]);
  });

  it("sorts by every whitelisted column, both ways", async ({ expect }) => {
    const { service, labelOf } = await boot();
    const order = async (sort: any) =>
      (await service.getExecutions("OpsApp.work", { sort })).content.map((r) =>
        labelOf(r.id),
      );

    expect(await order("createdAt")).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(await order("-createdAt")).toEqual(["f", "e", "d", "c", "b", "a"]);
    // Started a, b, d: a started last (i = 0 is "now"). The unstarted rows
    // sit wherever the database puts nulls; only the started order is ours.
    const started = (await order("-startedAt")).filter((l) =>
      ["a", "b", "d"].includes(l!),
    );
    expect(started).toEqual(["a", "b", "d"]);
    const completedAsc = (await order("completedAt")).filter((l) =>
      ["a", "b", "e"].includes(l!),
    );
    expect(completedAsc).toEqual(["a", "b", "e"]);
    expect(await order("-attempt")).toEqual(["b", "d", "e", "a", "f", "c"]);
    // Equal attempts fall back to newest created first.
    expect(await order("attempt")).toEqual(["f", "c", "e", "a", "d", "b"]);
    // Status orders by the database's own order of the values (declaration
    // order for a Postgres enum, the label on SQLite), so only the grouping
    // and the reversal are portable.
    const byStatus = await order("status");
    expect((await order("-status")).toReversed()).toEqual(byStatus);
  });

  it("groups a status sort and breaks ties newest created first", async ({
    expect,
  }) => {
    const { app, service, labelOf } = await boot();
    // A second finished row, so one status holds two rows to tie.
    const now = nowIso(app);
    await app.executions.create({
      jobName: "OpsApp.work",
      status: "ok",
      maxAttempts: 1,
      createdAt: now,
      updatedAt: now,
      completedAt: now,
    });

    const rows = (
      await service.getExecutions("OpsApp.work", { sort: "status" })
    ).content;
    const statuses = rows.map((r) => r.status);
    // Contiguous: a status never reappears after another one started.
    const seen = new Set<string>();
    for (let i = 0; i < statuses.length; i++) {
      if (i > 0 && statuses[i] !== statuses[i - 1]) {
        expect(seen.has(statuses[i])).toBe(false);
      }
      seen.add(statuses[i]);
    }
    const oks = rows.filter((r) => r.status === "ok").map((r) => labelOf(r.id));
    // The new row has no label and is the newest; `a` is the oldest.
    expect(oks).toEqual([undefined, "a"]);
  });

  it("refuses a sort column outside the whitelist", async ({ expect }) => {
    const { controller } = await boot();

    await expect(
      controller.listExecutions.run(
        { params: { name: "OpsApp.work" }, query: { sort: "payload" } as any },
        { user: user("job-reader") },
      ),
    ).rejects.toThrow();
  });

  it("filters by a list of statuses", async ({ expect }) => {
    const { service, labelOf } = await boot();

    const page = await service.getExecutions("OpsApp.work", {
      status: ["error", "cancelled"],
    });
    expect(page.content.map((r) => labelOf(r.id))).toEqual(["e", "b"]);
  });

  it("filters by what triggered the run", async ({ expect }) => {
    const { service, labelOf } = await boot();
    const labels = async (trigger: "scheduled" | "manual" | "code") =>
      (await service.getExecutions("OpsApp.work", { trigger })).content.map(
        (r) => labelOf(r.id),
      );

    expect(await labels("scheduled")).toEqual(["d", "a"]);
    expect(await labels("manual")).toEqual(["e", "b"]);
    expect(await labels("code")).toEqual(["f", "c"]);
  });

  it("filters by a started window, bounds inclusive", async ({ expect }) => {
    const { alepha, service, labelOf } = await boot();
    const now = alepha.inject(DateTimeProvider).now();

    const page = await service.getExecutions("OpsApp.work", {
      from: now.subtract(30, "minute").toISOString(),
      to: now.subtract(10, "minute").toISOString(),
    });
    expect(page.content.map((r) => labelOf(r.id))).toEqual(["d", "b"]);

    const fromOnly = await service.getExecutions("OpsApp.work", {
      from: now.subtract(15, "minute").toISOString(),
    });
    expect(fromOnly.content.map((r) => labelOf(r.id))).toEqual(["b", "a"]);
  });

  it("filters by a key fragment", async ({ expect }) => {
    const { service, labelOf } = await boot();

    const page = await service.getExecutions("OpsApp.work", {
      key: "invoice",
    });
    expect(page.content.map((r) => labelOf(r.id))).toEqual(["e", "b"]);
  });
});

describe("AdminJobController — deleting executions", () => {
  it("deletes one finished execution", async ({ expect }) => {
    const { service, app, ids } = await boot();

    await expect(service.deleteExecution(ids.b)).resolves.toEqual({
      ok: true,
    });
    expect(await app.executions.findById(ids.b).catch(() => null)).toBeFalsy();
  });

  it("refuses to delete a pending, scheduled or running execution, pointing at Cancel", async ({
    expect,
  }) => {
    const { service, app, ids } = await boot();

    for (const label of ["c", "d", "f"]) {
      await expect(service.deleteExecution(ids[label])).rejects.toThrow(
        ConflictError,
      );
      await expect(service.deleteExecution(ids[label])).rejects.toThrow(
        /Cancel it first/,
      );
      expect(await app.executions.findById(ids[label])).toBeTruthy();
    }
  });

  it("answers 404 for an execution that does not exist", async ({ expect }) => {
    const { service } = await boot();

    await expect(
      service.deleteExecution("00000000-0000-4000-8000-000000000999"),
    ).rejects.toThrow(NotFoundError);
  });

  it("bulk deletes the finished rows among the ids and counts the skipped ones", async ({
    expect,
  }) => {
    const { service, app, ids } = await boot();

    const result = await service.deleteExecutions([
      ids.a,
      ids.b,
      ids.c,
      ids.d,
      ids.a,
      "00000000-0000-4000-8000-000000000999",
    ]);

    // a and b are finished; c and d are live; a is repeated; the last id
    // does not exist.
    expect(result).toEqual({ deleted: 2, skipped: 3 });
    const left = await app.executions.findMany({
      where: { jobName: { eq: "OpsApp.work" } },
      columns: ["id"],
    });
    expect(left.map((r) => r.id).sort()).toEqual(
      [ids.c, ids.d, ids.e, ids.f].sort(),
    );
  });

  it("says on the resource which rows can be deleted", async ({ expect }) => {
    const { service, ids } = await boot();

    expect((await service.getExecution(ids.a)).can.delete).toBe(true);
    expect((await service.getExecution(ids.e)).can.delete).toBe(true);
    expect((await service.getExecution(ids.d)).can.delete).toBe(false);
    expect((await service.getExecution(ids.c)).can.delete).toBe(false);
  });

  it("gates both deletes on admin:job:delete", async ({ expect }) => {
    const { controller, ids } = await boot();

    await expect(
      controller.deleteExecution.run(
        { params: { id: ids.a } },
        { user: user("job-reader") },
      ),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      controller.deleteExecutions.run(
        { body: { ids: [ids.a] } },
        { user: user("job-reader") },
      ),
    ).rejects.toThrow(ForbiddenError);

    await expect(
      controller.deleteExecution.run(
        { params: { id: ids.a } },
        { user: user("job-cleaner") },
      ),
    ).resolves.toEqual({ ok: true });
    await expect(
      controller.deleteExecutions.run(
        { body: { ids: [ids.b] } },
        { user: user("job-cleaner") },
      ),
    ).resolves.toEqual({ deleted: 1, skipped: 0 });
  });
});
