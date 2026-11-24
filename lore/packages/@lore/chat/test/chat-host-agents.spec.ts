import {
  AgentHostService,
  HostCommandService,
  HostCommandTransport,
  HostJobService,
} from "@lore/core/api";
import { hostJobs, hosts } from "@lore/core/schemas";
import { createTestHost } from "@lore/core/testing/hosts";
import { $repository } from "alepha/orm";
import { afterEach, describe, it } from "vitest";

import {
  ChatAgentController,
  ChatAgentRunner,
  ChatHostTurns,
  ChatMessageController,
  ChatResponderRegistry,
  ChatRoomController,
} from "../src/api/index.ts";
import { ChatRows, ChatTestKit, RecordingChatLive } from "./chatTestKit.ts";

class ConnectedTransport extends HostCommandTransport {
  override async push(): Promise<boolean> {
    return true;
  }
}

class HostRows {
  jobs = $repository(hostJobs);
  hosts = $repository(hosts);
}

/**
 * A chat agent answering from an Agent host (#Q4250): the turn is a host
 * job, its answer the CLI's JSON result read when the job ends, and the
 * room sees an agent message like any other.
 */
describe("chat agents on an Agent host", () => {
  let kit: ChatTestKit;

  afterEach(async () => {
    await kit.stop();
  });

  const boot = async () => {
    kit = await ChatTestKit.boot((alepha) => {
      alepha.with({ provide: HostCommandTransport, use: ConnectedTransport });
      alepha.inject(HostRows);
    });
    const host = await createTestHost(
      kit.alepha,
      kit.owner,
      { slug: "agent-1" },
      { projectId: kit.projectId },
    );
    const rows = kit.alepha.inject(HostRows);
    await rows.hosts.updateById(host.id, { jobsAllowed: true });
    await kit.alepha
      .inject(AgentHostService)
      .setAgentHost(
        await rows.hosts.getOne({ where: { id: { eq: host.id } } }),
        true,
      );
    const commands = kit.alepha.inject(HostCommandService);
    const [check] = await rows.jobs.findMany({
      where: { kind: { eq: "check" } },
    });
    if (check?.commandId) {
      await commands.ack(host.id, { id: check.commandId, status: "done" });
    }
    const general = (
      await kit.alepha
        .inject(ChatRoomController)
        .listChatRooms.fetch(
          { params: { projectId: kit.projectId } },
          { user: kit.member },
        )
    ).data.items.find((it) => it.name === "general")!;
    return {
      host,
      rows,
      commands,
      general,
      agents: kit.alepha.inject(ChatAgentController),
      messages: kit.alepha.inject(ChatMessageController),
      runner: kit.alepha.inject(ChatAgentRunner),
      chat: kit.alepha.inject(ChatRows),
      jobs: kit.alepha.inject(HostJobService),
    };
  };

  /**
   * The job answering a mention, its stdout, then its end.
   */
  const finish = async (
    w: Awaited<ReturnType<typeof boot>>,
    jobId: string,
    stdout: string,
    status: "done" | "failed" = "done",
  ) => {
    const job = await w.rows.jobs.getOne({ where: { id: { eq: jobId } } });
    const hostRow = await w.rows.hosts.getOne({
      where: { id: { eq: w.host.id } },
    });
    await w.jobs.appendLog(hostRow, {
      type: "log",
      id: job.commandId as string,
      stream: "stdout",
      offset: 0,
      data: stdout,
    });
    await w.commands.ack(w.host.id, {
      id: job.commandId as string,
      status,
      exitCode: status === "done" ? 0 : 1,
    });
  };

  const mention = async (w: Awaited<ReturnType<typeof boot>>, body: string) => {
    const { data: sent } = await w.messages.sendChatMessage.fetch(
      {
        params: { projectId: kit.projectId, roomId: w.general.id },
        body: { body },
      },
      { user: kit.member },
    );
    await kit.alepha.inject(RecordingChatLive).created(sent.id);
    await w.runner.settled();
    return sent;
  };

  it("answers a project agent's mention from a host job, with AI off, and a mention in the answer starts nothing", async ({
    expect,
  }) => {
    const w = await boot();
    const { data: jarvis } = await w.agents.createChatAgent.fetch(
      {
        params: { projectId: kit.projectId },
        body: {
          handle: "jarvis",
          name: "Jarvis",
          prePrompt: "Answer about the code.",
          engine: "host",
        },
      },
      { user: kit.owner },
    );
    // No API engine is registered: the host answers all the same.
    expect(kit.alepha.inject(ChatResponderRegistry).engine()).toBeUndefined();
    await mention(w, "@jarvis where is the router?");

    const [job] = await w.rows.jobs.findMany({
      where: { subjectType: { eq: ChatHostTurns.SUBJECT } },
    });
    expect(job).toBeDefined();
    expect(job!.input).toMatchObject({
      workspace: `agent-${jarvis.id}`,
      output: "json",
      session: { resume: false },
    });
    expect(job!.input.prompt).toContain("You are Jarvis");
    expect(job!.input.prompt).toContain("Answer about the code.");
    expect(job!.input.prompt).toContain("@jarvis where is the router?");
    const answer = await w.chat.messages.getOne({
      where: { id: { eq: job!.subjectId as string } },
    });
    expect(answer).toMatchObject({
      agent: "jarvis",
      agentId: jarvis.id,
      agentRun: { status: "running", jobId: job!.id },
    });

    await finish(
      w,
      job!.id,
      `${JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "In src/router.ts. @lore could say more." })}\n`,
    );
    await w.runner.settled();
    const written = await w.chat.messages.getOne({
      where: { id: { eq: answer.id } },
    });
    expect(written.body).toBe("In src/router.ts. @lore could say more.");
    expect(written.agentRun?.status).toBe("done");
    // Its mention of @lore started no run: no other agent message.
    const agentMessages = await w.chat.messages.findMany({
      where: { roomId: { eq: w.general.id }, agent: { isNotNull: true } },
    });
    expect(agentMessages).toHaveLength(1);

    // The next turn resumes the session the done job used.
    await mention(w, "@jarvis and the API?");
    const second = (
      await w.rows.jobs.findMany({
        where: { subjectType: { eq: ChatHostTurns.SUBJECT } },
        orderBy: [{ column: "queuedAt", direction: "desc" }],
      })
    )[0]!;
    expect(second.id).not.toBe(job!.id);
    expect(second.input.session).toEqual({
      id: job!.input.session!.id,
      resume: true,
    });

    // A changed playbook starts a new conversation.
    await finish(w, second.id, `${JSON.stringify({ result: "src/api." })}\n`);
    await w.agents.updateChatAgent.fetch(
      {
        params: { projectId: kit.projectId, agentId: jarvis.id },
        body: { prePrompt: "Answer about the docs." },
      },
      { user: kit.owner },
    );
    await mention(w, "@jarvis and the docs?");
    const third = (
      await w.rows.jobs.findMany({
        where: { subjectType: { eq: ChatHostTurns.SUBJECT } },
        orderBy: [{ column: "queuedAt", direction: "desc" }],
      })
    )[0]!;
    expect(third.input.session?.resume).toBe(false);
    expect(third.input.session?.id).not.toBe(job!.input.session!.id);
  });

  it("writes the failure of a job that failed, and @lore answers from a host once the project sets its engine", async ({
    expect,
  }) => {
    const w = await boot();
    const { data: lore } = await w.agents.updateChatAgent.fetch(
      {
        params: { projectId: kit.projectId, agentId: "lore" },
        body: { engine: "host", engineHost: "agent-1" },
      },
      { user: kit.owner },
    );
    expect(lore).toMatchObject({
      id: "lore",
      engine: "host",
      engineHost: "agent-1",
    });
    await mention(w, "@lore what changed?");
    const [job] = await w.rows.jobs.findMany({
      where: { subjectType: { eq: ChatHostTurns.SUBJECT } },
    });
    expect(job!.input.workspace).toBe("agent-lore");
    await finish(w, job!.id, "", "failed");
    await w.runner.settled();
    const answer = await w.chat.messages.getOne({
      where: { id: { eq: job!.subjectId as string } },
    });
    expect(answer.agent).toBe("lore");
    expect(answer.agentRun?.status).toBe("failed");
    expect(answer.body).toContain("The answer failed");
  });

  it("reads Claude Code's and Gemini CLI's JSON results", ({ expect }) => {
    expect(
      ChatHostTurns.resultOf(
        '{"type":"result","is_error":false,"result":"Hello"}',
      ),
    ).toEqual({ text: "Hello" });
    expect(
      ChatHostTurns.resultOf(
        '{"type":"result","is_error":true,"result":"Usage limit"}',
      ),
    ).toEqual({ error: "Usage limit" });
    expect(
      ChatHostTurns.resultOf('noise\n{"response":"From Gemini"}\n'),
    ).toEqual({ text: "From Gemini" });
    expect(ChatHostTurns.resultOf("not json")).toBeUndefined();
  });
});
