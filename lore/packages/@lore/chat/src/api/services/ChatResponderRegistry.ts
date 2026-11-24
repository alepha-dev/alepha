import { AlephaError } from "alepha";
import { $repository } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";

import { type ChatAgent, chatAgents } from "../entities/chatAgents.ts";
import { chatLoreEngines } from "../entities/chatLoreEngines.ts";

/**
 * The agents a room can mention (#E161, #Q3930, #E170): a name that is not
 * a member, and what answers a message naming it.
 *
 * Two kinds:
 *
 * - **Built-in**, registered in code. `@lore/chat` imports core only and the
 *   agent's tools span every package, so `lore` is not here: the app's
 *   assistant registers it, as the **engine**, and only when AI is on.
 * - **A project's own** (#Q4196), a `chat_agents` row: a persona and a
 *   playbook answered by the engine. With no engine (AI off) none of them
 *   answers, exactly as `@lore` does not.
 *
 * A project's agent wins over a built-in of the same handle; the handle
 * rules (`ChatAgentService`) keep `lore` for the built-in, so the order only
 * decides for a responder a spec registers.
 */
export class ChatResponderRegistry {
  protected readonly responders = new Map<string, ChatResponder>();
  protected engineName?: string;
  protected readonly agents = $repository(chatAgents);
  protected readonly loreEngines = $repository(chatLoreEngines);

  /**
   * What stands for the responder of an agent whose provider is a host
   * (#Q4250): the runner starts a host job for it and never calls it, so it
   * answers with AI off too.
   */
  protected hostResponder(name: string, label: string): ChatResponder {
    const never = (): AsyncIterable<ChatAgentEvent> => {
      throw new AlephaError(`@${name} answers from an Agent host`);
    };
    return { name, label, respond: never, resume: never };
  }

  /**
   * `@lore`'s host engine in a project, when it has one (#Q4250).
   */
  public async loreHost(
    projectId: number,
  ): Promise<ChatHostEngine | undefined> {
    const row = await this.loreEngines.findOne({
      where: { projectId: { eq: projectId } },
    });
    return row?.engine === "host"
      ? ChatResponderRegistry.hostOf(row)
      : undefined;
  }

  /**
   * A row's host engine: its host, agent CLI and model.
   */
  public static hostOf(row: {
    engineHost?: string | null;
    engineAgent?: string | null;
    engineModel?: string | null;
  }): ChatHostEngine {
    return {
      ...(row.engineHost ? { host: row.engineHost } : {}),
      ...(row.engineAgent ? { agent: row.engineAgent } : {}),
      ...(row.engineModel ? { model: row.engineModel } : {}),
    };
  }

  public register(responder: ChatResponder): void {
    if (this.responders.has(responder.name)) {
      throw new AlephaError(
        `Chat responder '${responder.name}' is registered twice`,
      );
    }
    this.responders.set(responder.name, responder);
    if (responder.engine) {
      if (this.engineName) {
        throw new AlephaError(
          `Chat responders '${this.engineName}' and '${responder.name}' are both the engine`,
        );
      }
      this.engineName = responder.name;
    }
  }

  /**
   * The responder that answers a project's own agents, none with AI off.
   */
  public engine(): ChatResponder | undefined {
    return this.engineName ? this.responders.get(this.engineName) : undefined;
  }

  /**
   * The responders registered in code, in registration order.
   */
  public builtins(): ChatResponder[] {
    return [...this.responders.values()];
  }

  /**
   * What `@handle` names in the project: a live agent of the project first,
   * a built-in second, or nothing.
   */
  public async get(
    projectId: number,
    handle: string,
  ): Promise<ChatAgentMatch | undefined> {
    const engine = this.engine();
    const agent = await this.agents.findOne({
      where: {
        projectId: { eq: projectId },
        handle: { eq: handle.toLowerCase() },
        deletedAt: { isNull: true },
      },
    });
    // A host agent answers whether AI is on or not (#Q4250).
    if (agent && agent.engine === "host") {
      return {
        handle: agent.handle!,
        responder: engine ?? this.hostResponder(agent.handle!, agent.name),
        agent,
        host: ChatResponderRegistry.hostOf(agent),
      };
    }
    if (agent && engine) {
      return { handle: agent.handle!, responder: engine, agent };
    }
    const name = handle.toLowerCase();
    if (name === "lore") {
      const host = await this.loreHost(projectId);
      if (host) {
        return {
          handle: "lore",
          responder:
            this.responders.get("lore") ?? this.hostResponder("lore", "Lore"),
          host,
        };
      }
    }
    const responder = this.responders.get(name);
    return responder ? { handle: responder.name, responder } : undefined;
  }

  /**
   * The agent an answer was written by, even a deleted one: what a paused
   * write resumes with.
   */
  public async byMessage(
    projectId: number,
    message: { agent?: string; agentId?: string },
  ): Promise<ChatAgentMatch | undefined> {
    if (message.agentId) {
      const engine = this.engine();
      const agent = await this.agents.findOne({
        where: { id: { eq: message.agentId }, projectId: { eq: projectId } },
      });
      return engine && agent
        ? {
            handle: agent.handle ?? message.agent ?? "",
            responder: engine,
            agent,
          }
        : undefined;
    }
    const responder = this.responders.get(message.agent ?? "");
    return responder ? { handle: responder.name, responder } : undefined;
  }

  /**
   * Every agent a message in the project can mention: the built-ins, then
   * the project's live agents, oldest first. Empty with AI off.
   */
  public async list(projectId: number): Promise<ChatAgentMatch[]> {
    const loreHost = await this.loreHost(projectId);
    const matches: ChatAgentMatch[] = this.builtins().map((responder) => ({
      handle: responder.name,
      responder,
      ...(responder.name === "lore" && loreHost ? { host: loreHost } : {}),
    }));
    if (loreHost && !this.responders.has("lore")) {
      matches.unshift({
        handle: "lore",
        responder: this.hostResponder("lore", "Lore"),
        host: loreHost,
      });
    }
    const engine = this.engine();
    const own = (
      await this.agents.findMany({
        where: { projectId: { eq: projectId }, deletedAt: { isNull: true } },
        orderBy: [{ column: "createdAt", direction: "asc" }],
      })
    ).filter((agent) => engine || agent.engine === "host");
    const taken = new Set(own.map((agent) => agent.handle!));
    return [
      ...matches.filter((it) => !taken.has(it.handle)),
      ...own.map((agent) => ({
        handle: agent.handle!,
        responder: engine ?? this.hostResponder(agent.handle!, agent.name),
        agent,
        ...(agent.engine === "host"
          ? { host: ChatResponderRegistry.hostOf(agent) }
          : {}),
      })),
    ];
  }

  /**
   * The handles a message in the project can mention.
   */
  public async names(projectId: number): Promise<string[]> {
    return (await this.list(projectId)).map((it) => it.handle);
  }
}

/**
 * A handle resolved: what answers it, and the project's agent row when it
 * is one.
 */
export interface ChatAgentMatch {
  handle: string;
  responder: ChatResponder;
  agent?: ChatAgent;
  /**
   * Set when the agent answers from an Agent host (#Q4250): the runner
   * starts a host job instead of calling the responder.
   */
  host?: ChatHostEngine;
}

/**
 * Where a host agent runs: an Agent host by slug, an agent CLI and its
 * model, each absent for the project's only one or the CLI's default.
 */
export interface ChatHostEngine {
  host?: string;
  agent?: string;
  model?: string;
}

/**
 * What a responder is asked: the mentioner's words and the room's recent
 * messages, which are other people's and so data, never instructions.
 */
export interface ChatAgentRequest {
  projectId: number;
  roomId: string;
  roomName: string;
  /**
   * The member who mentioned the agent: the run is theirs, with their
   * permissions and their AI budget.
   */
  user: UserAccountToken;
  /**
   * The mentioner's message, as they wrote it.
   */
  prompt: string;
  /**
   * The room's messages before it, attributed and oldest first.
   */
  history: Array<{ author: string; agent: boolean; text: string }>;
  /**
   * The run log this member, room and agent continue, if one exists.
   */
  conversationId?: string;
  /**
   * The project's agent mentioned (#E170), none for a built-in.
   */
  agent?: ChatAgentPersona;
}

/**
 * What a project's agent changes in a run: who answers, what it is told, on
 * which model. Never what it may do.
 */
export interface ChatAgentPersona {
  id: string;
  name: string;
  /**
   * Its pre-prompt: the persona and its playbook.
   */
  instructions: string;
  /**
   * Its model id, none for the instance default.
   */
  model?: string;
}

export interface ChatAgentDecision {
  projectId: number;
  user: UserAccountToken;
  conversationId: string;
  callId: string;
  decision: "approve" | "deny";
  /**
   * The agent the paused run is: its resume keeps its playbook and model.
   */
  agent?: ChatAgentPersona;
}

export type ChatAgentEvent =
  | { type: "conversation"; conversationId: string }
  | { type: "text"; text: string }
  | { type: "tool"; name: string; state: "running" | "done" | "failed" }
  | { type: "confirm"; callId: string; name: string; input: unknown }
  | { type: "error"; message: string }
  | { type: "end" };

export interface ChatResponder {
  /**
   * The handle a message mentions, `lore`.
   */
  name: string;
  /**
   * Shown in the `@` popup.
   */
  label: string;
  /**
   * The responder that answers a project's own agents too (#E170): the app's
   * `lore`. At most one.
   */
  engine?: boolean;
  respond: (request: ChatAgentRequest) => AsyncIterable<ChatAgentEvent>;
  /**
   * Continue a run paused on a write the mentioner must decide.
   */
  resume: (decision: ChatAgentDecision) => AsyncIterable<ChatAgentEvent>;
}
