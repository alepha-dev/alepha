import { LorePermissions, ProjectRankPresets } from "@lore/core/api";
import { HttpError, ValidationError } from "alepha/server";
import { afterEach, describe, it } from "vitest";

import {
  ChatAgentController,
  ChatAgentRunner,
  ChatMessageController,
  ChatResponderRegistry,
  ChatRoomController,
} from "../src/api/index.ts";
import type { ChatAgentRequest } from "../src/api/index.ts";
import { ChatRows, ChatTestKit, RecordingChatLive } from "./chatTestKit.ts";

/**
 * A project's chat agents (#E170, #Q4196): the `chat:agent` permission, the
 * handle rules, the soft delete, and `@handle` resolved from the database to
 * the engine, never with AI off.
 */
describe("chat agents", () => {
  let kit: ChatTestKit;

  afterEach(async () => {
    await kit.stop();
  });

  /**
   * The app's `lore` stands in as the engine: what AI being on looks like
   * to chat.
   */
  const boot = async (ai = true) => {
    kit = await ChatTestKit.boot();
    const requests: ChatAgentRequest[] = [];
    if (ai) {
      kit.alepha.inject(ChatResponderRegistry).register({
        name: "lore",
        label: "Lore",
        engine: true,
        respond: async function* (request) {
          requests.push(request);
          yield { type: "text", text: "On it." };
          yield { type: "end" };
        },
        resume: async function* () {},
      });
    }
    return {
      agents: kit.alepha.inject(ChatAgentController),
      messages: kit.alepha.inject(ChatMessageController),
      rooms: kit.alepha.inject(ChatRoomController),
      runner: kit.alepha.inject(ChatAgentRunner),
      rows: kit.alepha.inject(ChatRows),
      requests,
    };
  };

  const status = async (call: Promise<unknown>): Promise<number> => {
    try {
      await call;
      return 200;
    } catch (error) {
      if (error instanceof HttpError) return error.status;
      throw error;
    }
  };

  const create = (
    agents: ChatAgentController,
    user: { id: string; roles: string[] },
    body: { handle: string; name?: string; prePrompt?: string; model?: string },
  ) =>
    agents.createChatAgent.fetch(
      {
        params: { projectId: kit.projectId },
        body: { name: "Jarvis", prePrompt: "Check things.", ...body },
      },
      { user },
    );

  it("lets chat:agent create, edit and delete, and every reader list and read", async ({
    expect,
  }) => {
    const { agents } = await boot();
    const params = { projectId: kit.projectId };

    // A Member writes chat, and does not hold chat:agent.
    expect(await status(create(agents, kit.member, { handle: "jarvis" }))).toBe(
      403,
    );
    const { data: jarvis } = await create(agents, kit.owner, {
      handle: "Jarvis",
      model: "claude-haiku-5-5",
    });
    expect(jarvis).toMatchObject({
      handle: "jarvis",
      name: "Jarvis",
      model: "claude-haiku-5-5",
      builtin: false,
      createdBy: kit.owner.id,
    });

    // A Viewer reads the list and the playbook.
    const listed = await agents.listChatAgents.fetch(
      { params },
      { user: kit.viewer },
    );
    expect(listed.data.enabled).toBe(true);
    expect(listed.data.items.map((it) => it.handle)).toEqual([
      "lore",
      "jarvis",
    ]);
    const read = await agents.getChatAgent.fetch(
      { params: { ...params, agentId: jarvis.id } },
      { user: kit.viewer },
    );
    expect(read.data.prePrompt).toBe("Check things.");
    expect(
      await status(
        agents.getChatAgent.fetch(
          { params: { ...params, agentId: jarvis.id } },
          { user: kit.stranger },
        ),
      ),
    ).not.toBe(200);

    expect(
      await status(
        agents.updateChatAgent.fetch(
          { params: { ...params, agentId: jarvis.id }, body: { name: "J" } },
          { user: kit.member },
        ),
      ),
    ).toBe(403);
    const edited = await agents.updateChatAgent.fetch(
      {
        params: { ...params, agentId: jarvis.id },
        body: { name: "J.A.R.V.I.S.", model: null },
      },
      { user: kit.owner },
    );
    expect(edited.data.name).toBe("J.A.R.V.I.S.");
    expect(edited.data.model).toBeUndefined();

    expect(
      await status(
        agents.deleteChatAgent.fetch(
          { params: { ...params, agentId: jarvis.id } },
          { user: kit.member },
        ),
      ),
    ).toBe(403);
  });

  it("gives chat:agent to the Admin by default, not a Member or a Viewer", async ({
    expect,
  }) => {
    await boot();
    const [admin, viewer] = kit.alepha
      .inject(ProjectRankPresets)
      .presetsFor(["chat"]);

    expect(admin!.permissions).toContain("chat:agent");
    expect(viewer!.permissions).not.toContain("chat:agent");
    expect(LorePermissions.MEMBER_DEFAULT).not.toContain("chat:agent");
    expect(LorePermissions.OWNER_TODAY).toContain("chat:agent");
  });

  it("refuses a handle on its field: its shape, lore, a live agent's, a member's", async ({
    expect,
  }) => {
    const { agents } = await boot();
    await create(agents, kit.owner, { handle: "jarvis" });

    const refusal = async (handle: string) => {
      const error = await create(agents, kit.owner, { handle }).catch(
        (it) => it,
      );
      expect(error).toBeInstanceOf(ValidationError);
      return (error as ValidationError).data.issues?.[0];
    };

    expect((await refusal("J"))?.path).toBe("/handle");
    expect((await refusal("no spaces"))?.path).toBe("/handle");
    // Past the schema's cap, the body itself is refused.
    await expect(
      create(agents, kit.owner, { handle: "x".repeat(33) }),
    ).rejects.toThrow("32");
    expect((await refusal("lore"))?.message).toContain("built-in");
    expect((await refusal("jarvis"))?.message).toContain("Another agent");
    expect(
      (await refusal(kit.member.username.toLowerCase()))?.message,
    ).toContain("member");
  });

  it("frees a deleted agent's handle and keeps its row for its past answers", async ({
    expect,
  }) => {
    const { agents, rows } = await boot();
    const params = { projectId: kit.projectId };
    const { data: first } = await create(agents, kit.owner, {
      handle: "jarvis",
    });

    await agents.deleteChatAgent.fetch(
      { params: { ...params, agentId: first.id } },
      { user: kit.owner },
    );

    const listed = await agents.listChatAgents.fetch(
      { params },
      { user: kit.owner },
    );
    expect(listed.data.items.map((it) => it.handle)).toEqual(["lore"]);
    expect(
      await status(
        agents.getChatAgent.fetch(
          { params: { ...params, agentId: first.id } },
          { user: kit.owner },
        ),
      ),
    ).toBe(404);
    const { data: second } = await create(agents, kit.owner, {
      handle: "jarvis",
    });
    expect(second.id).not.toBe(first.id);
    // The row stays, without its handle, for the answers that name it.
    const kept = (await rows.agents.findById(first.id))!;
    expect(kept.handle ?? undefined).toBeUndefined();
    expect(kept.deletedAt).toBeDefined();
    expect(kept.name).toBe("Jarvis");
  });

  it("resolves @handle to the project's agent and starts its run", async ({
    expect,
  }) => {
    const { agents, messages, rooms, runner, rows, requests } = await boot();
    const { data: jarvis } = await create(agents, kit.owner, {
      handle: "jarvis",
    });
    const general = (
      await rooms.listChatRooms.fetch(
        { params: { projectId: kit.projectId } },
        { user: kit.member },
      )
    ).data.items.find((it) => it.name === "general")!;

    // A Member mentions it: chat:write is enough.
    const { data: sent } = await messages.sendChatMessage.fetch(
      {
        params: { projectId: kit.projectId, roomId: general.id },
        body: { body: "@jarvis time to check" },
      },
      { user: kit.member },
    );
    await kit.alepha.inject(RecordingChatLive).created(sent.id);
    await runner.settled();

    const mentions = await rows.mentions.findMany({
      where: { messageId: { eq: sent.id } },
    });
    expect(mentions).toMatchObject([{ agent: "jarvis", agentId: jarvis.id }]);
    expect(requests).toHaveLength(1);
    const answer = (
      await rows.messages.findMany({ where: { roomId: { eq: general.id } } })
    ).find((it) => it.agent);
    expect(answer).toMatchObject({
      agent: "jarvis",
      agentId: jarvis.id,
      body: "On it.",
    });

    // Renamed, then deleted: its past answer reads with its current name.
    await agents.updateChatAgent.fetch(
      {
        params: { projectId: kit.projectId, agentId: jarvis.id },
        body: { name: "J.A.R.V.I.S." },
      },
      { user: kit.owner },
    );
    await agents.deleteChatAgent.fetch(
      { params: { projectId: kit.projectId, agentId: jarvis.id } },
      { user: kit.owner },
    );
    const page = await messages.listChatMessages.fetch(
      { params: { projectId: kit.projectId, roomId: general.id }, query: {} },
      { user: kit.member },
    );
    expect(page.data.items.find((it) => it.agent)).toMatchObject({
      agentId: jarvis.id,
      agentName: "J.A.R.V.I.S.",
    });

    // Another project's agent is plain text here.
    const elsewhere = await kit.projects.createProject.fetch(
      { body: { title: "Other", capabilities: [{ key: "chat" }] } },
      { user: kit.owner },
    );
    await agents.createChatAgent.fetch(
      {
        params: { projectId: elsewhere.data.id },
        body: { handle: "friday", name: "Friday" },
      },
      { user: kit.owner },
    );
    const { data: plain } = await messages.sendChatMessage.fetch(
      {
        params: { projectId: kit.projectId, roomId: general.id },
        body: { body: "@friday hello" },
      },
      { user: kit.member },
    );
    await kit.alepha.inject(RecordingChatLive).created(plain.id);
    await runner.settled();
    expect(requests).toHaveLength(1);
  });

  it("keeps @lore for the built-in with AI off, so switching it on finds no impostor", async ({
    expect,
  }) => {
    const { agents } = await boot(false);

    const error = await create(agents, kit.owner, { handle: "lore" }).catch(
      (it) => it,
    );
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).data.issues?.[0]?.message).toContain(
      "built-in",
    );
  });

  it("answers no agent with AI off, the project's own included", async ({
    expect,
  }) => {
    const { agents, messages, rooms, runner, rows } = await boot(false);
    // Agents are still listed and edited with AI off.
    await create(agents, kit.owner, { handle: "jarvis" });
    const listed = await agents.listChatAgents.fetch(
      { params: { projectId: kit.projectId } },
      { user: kit.owner },
    );
    expect(listed.data.enabled).toBe(false);
    expect(listed.data.items.map((it) => it.handle)).toEqual(["jarvis"]);

    const general = (
      await rooms.listChatRooms.fetch(
        { params: { projectId: kit.projectId } },
        { user: kit.member },
      )
    ).data.items.find((it) => it.name === "general")!;
    const { data: sent } = await messages.sendChatMessage.fetch(
      {
        params: { projectId: kit.projectId, roomId: general.id },
        body: { body: "@jarvis time to check" },
      },
      { user: kit.member },
    );
    await kit.alepha.inject(RecordingChatLive).created(sent.id);
    await runner.settled();

    expect(
      await rows.mentions.findMany({ where: { messageId: { eq: sent.id } } }),
    ).toEqual([]);
    expect(
      (
        await rows.messages.findMany({ where: { roomId: { eq: general.id } } })
      ).filter((it) => it.agent),
    ).toEqual([]);
  });
});
