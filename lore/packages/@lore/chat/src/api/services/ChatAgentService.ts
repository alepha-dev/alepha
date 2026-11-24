import { ProjectRoster } from "@lore/core/api";
import { $inject } from "alepha";
import { FileService } from "alepha/api/files";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { BadRequestError, NotFoundError, ValidationError } from "alepha/server";

import { type ChatAgent, chatAgents } from "../entities/chatAgents.ts";
import { chatLoreEngines } from "../entities/chatLoreEngines.ts";
import type {
  ChatAgentBody,
  ChatAgentResource,
} from "../schemas/chatAgentResourceSchema.ts";
import { ChatBuckets } from "./ChatBuckets.ts";
import { ChatResponderRegistry } from "./ChatResponderRegistry.ts";

/**
 * A project's chat agents (#E170, #Q4196): create, read, edit and delete,
 * and the handle rules.
 *
 * A handle is what a message mentions: lowercase letters, digits and `-`, 2
 * to 32 characters, unique among the project's live agents, never a
 * built-in's (`lore`), never a member's mention handle. A member who takes
 * an agent's handle later loses to the agent, as with `@lore`.
 *
 * Who may call what is the controller's (`chat:agent` for writes); this
 * checks what a row may hold.
 */
export class ChatAgentService {
  public static readonly HANDLE = /^[a-z0-9-]{2,32}$/;

  /**
   * Handles no project agent takes, whether or not AI is on: `lore` is the
   * built-in's even while it is not registered, so switching AI on never
   * finds a project agent in its place.
   */
  public static readonly RESERVED = ["lore"];

  protected readonly agents = $repository(chatAgents);
  protected readonly loreEngines = $repository(chatLoreEngines);
  protected readonly registry = $inject(ChatResponderRegistry);
  protected readonly roster = $inject(ProjectRoster);
  protected readonly files = $inject(FileService);
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * Whether any agent answers: AI is on, so the engine is registered.
   */
  public enabled(): boolean {
    return !!this.registry.engine();
  }

  /**
   * `lore` (when AI is on) then the project's live agents: the one list,
   * read by the composer and the settings page alike.
   */
  public async list(projectId: number): Promise<ChatAgentResource[]> {
    // `@lore`'s engine in this project (#Q4250); a host engine makes it
    // answer with AI off too.
    const lore = await this.loreEngines.findOne({
      where: { projectId: { eq: projectId } },
    });
    const loreEngine = lore ? this.engineOf(lore) : {};
    const builtins = this.registry
      .builtins()
      .map((responder): ChatAgentResource => ({
        id: responder.name,
        handle: responder.name,
        name: responder.label,
        builtin: true,
        ...(responder.name === "lore" ? loreEngine : {}),
      }));
    if (lore?.engine === "host" && !builtins.some((it) => it.id === "lore")) {
      builtins.unshift({
        id: "lore",
        handle: "lore",
        name: "Lore",
        builtin: true,
        ...loreEngine,
      });
    }
    const own = await this.agents.findMany({
      where: { projectId: { eq: projectId }, deletedAt: { isNull: true } },
      orderBy: [{ column: "createdAt", direction: "asc" }],
    });
    return [...builtins, ...own.map((agent) => this.toResource(agent))];
  }

  /**
   * One live agent, its pre-prompt included: a playbook is no secret to the
   * members who read chat.
   */
  public async get(
    projectId: number,
    agentId: string,
  ): Promise<ChatAgentResource> {
    return this.toResource(await this.live(projectId, agentId), true);
  }

  public async create(
    projectId: number,
    user: UserAccountToken,
    body: ChatAgentBody,
  ): Promise<ChatAgentResource> {
    const handle = await this.assertHandle(projectId, body.handle);
    if (body.avatar) await this.assertAvatar(body.avatar, user);
    const agent = await this.agents.create({
      projectId,
      handle,
      name: body.name.trim(),
      prePrompt: body.prePrompt ?? "",
      ...(body.avatar ? { avatar: body.avatar } : {}),
      ...(body.model?.trim() ? { model: body.model.trim() } : {}),
      ...this.enginePatch(body),
      createdBy: user.id,
    });
    return this.toResource(agent, true);
  }

  /**
   * Only the fields given change; `avatar` and `model` set to `null` are
   * removed.
   */
  public async update(
    projectId: number,
    agentId: string,
    user: UserAccountToken,
    body: Partial<ChatAgentBody>,
  ): Promise<ChatAgentResource> {
    if (agentId === "lore") return this.updateLore(projectId, body);
    const agent = await this.live(projectId, agentId);
    const patch: Record<string, unknown> = {};
    if (body.handle !== undefined && body.handle !== agent.handle) {
      patch.handle = await this.assertHandle(projectId, body.handle, agent.id);
    }
    if (body.name !== undefined) patch.name = body.name.trim();
    if (body.prePrompt !== undefined) patch.prePrompt = body.prePrompt;
    if (body.model !== undefined) {
      patch.model = body.model?.trim() ? body.model.trim() : null;
    }
    Object.assign(patch, this.enginePatch(body));
    let replaced: string | undefined;
    if (body.avatar !== undefined && body.avatar !== (agent.avatar ?? null)) {
      if (body.avatar) await this.assertAvatar(body.avatar, user);
      patch.avatar = body.avatar ?? null;
      replaced = agent.avatar;
    }
    const updated = Object.keys(patch).length
      ? await this.agents.updateById(agent.id, patch as never)
      : agent;
    // The old picture is nobody's any more: no answer points at a file,
    // they read the agent's current one.
    if (replaced) {
      await this.files.deleteFiles([replaced], {
        bucket: ChatBuckets.AGENT_AVATAR_BUCKET,
      });
    }
    return this.toResource(updated, true);
  }

  /**
   * A soft delete: the handle is freed and the row and its avatar kept, so
   * past answers still show the agent's name and picture.
   */
  public async remove(projectId: number, agentId: string): Promise<void> {
    const agent = await this.live(projectId, agentId);
    await this.agents.updateById(agent.id, {
      handle: null,
      deletedAt: this.dateTime.nowISOString(),
    } as never);
  }

  public toResource(agent: ChatAgent, full = false): ChatAgentResource {
    return {
      id: agent.id,
      handle: agent.handle ?? "",
      name: agent.name,
      builtin: false,
      ...(agent.avatar
        ? { avatarId: agent.avatar, avatarUrl: `/api/files/${agent.avatar}` }
        : {}),
      ...(agent.model ? { model: agent.model } : {}),
      ...this.engineOf(agent),
      ...(agent.createdBy ? { createdBy: agent.createdBy } : {}),
      createdAt: agent.createdAt,
      ...(agent.deletedAt ? { deletedAt: agent.deletedAt } : {}),
      ...(full ? { prePrompt: agent.prePrompt } : {}),
    };
  }

  /**
   * `@lore`'s engine in the project (#Q4250): the only thing about the
   * built-in a project changes. Its name, handle and playbook are Lore's.
   */
  protected async updateLore(
    projectId: number,
    body: Partial<ChatAgentBody>,
  ): Promise<ChatAgentResource> {
    if (
      body.handle !== undefined ||
      body.name !== undefined ||
      body.prePrompt !== undefined ||
      body.model !== undefined ||
      body.avatar !== undefined
    ) {
      throw new BadRequestError(
        "@lore is the built-in agent: only its engine changes in a project",
      );
    }
    const patch = this.enginePatch(body);
    const existing = await this.loreEngines.findOne({
      where: { projectId: { eq: projectId } },
    });
    const row = existing
      ? await this.loreEngines.updateById(existing.id, patch as never)
      : await this.loreEngines.create({ projectId, ...(patch as object) });
    return {
      id: "lore",
      handle: "lore",
      name: "Lore",
      builtin: true,
      ...this.engineOf(row),
    };
  }

  /**
   * The engine fields a body sets: `null` clears a host field.
   */
  protected enginePatch(body: Partial<ChatAgentBody>): Record<string, unknown> {
    const patch: Record<string, unknown> = {};
    if (body.engine !== undefined) patch.engine = body.engine;
    for (const key of ["engineHost", "engineAgent", "engineModel"] as const) {
      if (body[key] !== undefined) {
        patch[key] = body[key]?.trim() ? body[key]?.trim() : null;
      }
    }
    return patch;
  }

  /**
   * A row's engine, as the resource says it.
   */
  protected engineOf(row: {
    engine?: "api" | "host";
    engineHost?: string | null;
    engineAgent?: string | null;
    engineModel?: string | null;
  }): Partial<ChatAgentResource> {
    return {
      engine: row.engine ?? "api",
      ...(row.engineHost ? { engineHost: row.engineHost } : {}),
      ...(row.engineAgent ? { engineAgent: row.engineAgent } : {}),
      ...(row.engineModel ? { engineModel: row.engineModel } : {}),
    };
  }

  protected async live(projectId: number, agentId: string): Promise<ChatAgent> {
    const agent = await this.agents.findOne({
      where: {
        id: { eq: agentId },
        projectId: { eq: projectId },
        deletedAt: { isNull: true },
      },
    });
    if (!agent) throw new NotFoundError("Agent not found");
    return agent;
  }

  /**
   * The handle, normalised, or a refusal on the `handle` field saying why.
   */
  protected async assertHandle(
    projectId: number,
    raw: string,
    selfId?: string,
  ): Promise<string> {
    const handle = raw.trim().toLowerCase();
    const refuse = (message: string) =>
      new ValidationError(
        { part: "body", issues: [{ path: "/handle", message }] },
        { message },
      );
    if (!ChatAgentService.HANDLE.test(handle)) {
      throw refuse(
        "A handle is 2 to 32 lowercase letters, digits or dashes, like jarvis",
      );
    }
    if (
      ChatAgentService.RESERVED.includes(handle) ||
      this.registry.builtins().some((it) => it.name === handle)
    ) {
      throw refuse(`@${handle} is the built-in agent`);
    }
    const taken = await this.agents.findOne({
      where: {
        projectId: { eq: projectId },
        handle: { eq: handle },
        deletedAt: { isNull: true },
      },
    });
    if (taken && taken.id !== selfId) {
      throw refuse(`Another agent here is already @${handle}`);
    }
    const members = await this.roster.of(projectId);
    if (members.some((it) => it.name.toLowerCase() === handle)) {
      throw refuse(`A member of the project is already @${handle}`);
    }
    return handle;
  }

  /**
   * An avatar is an image its setter uploaded to the agent avatar bucket.
   */
  protected async assertAvatar(
    fileId: string,
    user: UserAccountToken,
  ): Promise<void> {
    const found = await this.files.fileRepository.findOne({
      where: {
        id: { eq: fileId },
        creator: { eq: user.id },
        bucket: { eq: ChatBuckets.AGENT_AVATAR_BUCKET },
      },
    });
    if (!found) {
      const message = "Upload the avatar to chat-agent-avatars first";
      throw new ValidationError(
        { part: "body", issues: [{ path: "/avatar", message }] },
        { message },
      );
    }
  }
}
