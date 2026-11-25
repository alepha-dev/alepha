import { HostCommandService, PromptRunService } from "@lore/core/api";
import { createTestMember } from "@lore/core/testing";
import { MemoryEmailProvider } from "alepha/email";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  type AutomationWorld,
  automationWorld,
} from "./fixtures/automationWorld.ts";

/**
 * A `member` arg emails the run's final reply (#E174, #Q4278): weekly status
 * sent to a member, the reply rendered, the job's page linked; nothing for a
 * failed run, nor for a member who left, whose job says why.
 */
describe("a run's reply by email", () => {
  let w: AutomationWorld;
  beforeEach(async () => {
    w = await automationWorld();
    await w.entities.users.updateById(w.owner.id, {
      roles: ["user"],
      enabled: true,
      email: "owner@acme.test",
    } as never);
  });
  afterEach(async () => {
    await w.stop();
  });

  const mail = () => w.alepha.inject(MemoryEmailProvider);
  const deliver = () => w.drain(["system.notifications.send"]);
  const end = async (
    jobId: string,
    status: "done" | "failed",
    extra: Record<string, unknown> = {},
  ) => {
    const row = await w.repos.jobs.getOne({ where: { id: { eq: jobId } } });
    const commands = w.alepha.inject(HostCommandService);
    await commands.ack(row.hostId, { id: row.commandId!, status: "running" });
    await commands.ack(row.hostId, {
      id: row.commandId!,
      status,
      exitCode: status === "done" ? 0 : 1,
      ...extra,
    });
  };
  const run = (args: Record<string, string> = {}) =>
    w.alepha
      .inject(PromptRunService)
      .run(w.projectId, w.owner, "weekly-status", { args });

  it("emails a succeeded run's reply to its member, the caller by default, rendered and linked", async ({
    expect,
  }) => {
    const { jobId } = await run();
    const row = await w.repos.jobs.getOne({ where: { id: { eq: jobId } } });
    expect(row.args?.[0]).toMatchObject({ type: "member", value: w.owner.id });
    await end(jobId, "done", {
      result: "## The week\n\nShipped **two** quests.",
      resultTruncated: true,
    });
    await deliver();
    const sent = mail().records.filter((it) => it.to === "owner@acme.test");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.subject).toContain("Weekly status, reply");
    expect(sent[0]?.body).toContain("<strong>two</strong>");
    expect(sent[0]?.body).toContain(`/jobs/${jobId}`);
    expect(sent[0]?.body).toContain("The reply was cut");
  });

  it("sends nothing for a failed run, and says on the job why a member who left gets nothing", async ({
    expect,
  }) => {
    const failed = await run();
    await end(failed.jobId, "failed");
    await deliver();
    expect(mail().records).toHaveLength(0);

    const project = await w.entities.projects.getOne({
      where: { id: { eq: w.projectId } },
    });
    const user = await w.entities.users.create({
      email: "gone@acme.test",
    } as never);
    const member = await createTestMember(w.alepha, project, user.id);
    const { jobId } = await run({ member: user.id });
    await w.entities.organizationMembers.deleteById(member.id);
    await end(jobId, "done", { result: "Quiet week." });
    await deliver();
    expect(mail().records).toHaveLength(0);
    const ended = await w.repos.jobs.getOne({ where: { id: { eq: jobId } } });
    expect(ended.warning).toContain("The reply was not emailed");
  });

  it("says the reply was not captured when the host returns none", async ({
    expect,
  }) => {
    const { jobId } = await run();
    await end(jobId, "done");
    await deliver();
    const [sent] = mail().records;
    expect(sent?.body).toContain("The reply was not captured");
  });
});
