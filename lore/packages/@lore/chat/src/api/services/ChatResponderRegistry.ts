import { AlephaError } from "alepha";
import { $repository } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";

import { type ChatAgent, chatAgents } from "../entities/chatAgents.ts";

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

  /**
   * The tool names a project's agent may declare (#Q4430): the engine's
   * whole toolset. The tools are the app's, so the app sets this, with AI on
   * or off: an agent is written either way. None until it does.
   */
  public toolNames: () => string[] = () => [];

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
    if (engine) {
      const agent = await this.agents.findOne({
        where: {
          projectId: { eq: projectId },
          handle: { eq: handle.toLowerCase() },
          deletedAt: { isNull: true },
        },
      });
      if (agent) return { handle: agent.handle!, responder: engine, agent };
    }
    const responder = this.responders.get(handle.toLowerCase());
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
    const matches: ChatAgentMatch[] = this.builtins().map((responder) => ({
      handle: responder.name,
      responder,
    }));
    const engine = this.engine();
    if (!engine) return matches;
    const own = await this.agents.findMany({
      where: { projectId: { eq: projectId }, deletedAt: { isNull: true } },
      orderBy: [{ column: "createdAt", direction: "asc" }],
    });
    const taken = new Set(own.map((agent) => agent.handle!));
    return [
      ...matches.filter((it) => !taken.has(it.handle)),
      ...own.map((agent) => ({
        handle: agent.handle!,
        responder: engine,
        agent,
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
 * which model, and which tools it is shown. Never what it may do: its tools
 * only narrow what the mentioner is offered.
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
  /**
   * The tools it declares (#Q4430), none for every tool the mentioner may
   * be offered. As saved: the responder drops what the mentioner may not
   * use.
   */
  tools?: string[];
}

export interface ChatAgentDecision {
  projectId: number;
  user: UserAccountToken;
  conversationId: string;
  callId: string;
  decision: "approve" | "deny";
  /**
   * The agent the paused run is: its resume keeps its playbook, model and
   * tools.
   */
  agent?: ChatAgentPersona;
}

export type ChatAgentEvent =
  | { type: "conversation"; conversationId: string }
  | { type: "text"; text: string }
  | {
      type: "tool";
      name: string;
      state: "running" | "done" | "failed";
      /**
       * A failed call's error, short (#Q4302): what the runner says when the
       * answer ends on it.
       */
      error?: string;
      /**
       * The call failed because the mentioner declined it on its card.
       */
      declined?: boolean;
    }
  | { type: "confirm"; callId: string; name: string; input: unknown }
  | { type: "error"; message: string }
  | {
      type: "end";
      /**
       * Why the turn ended (#Q4302): `length` is a reply cut by its token or
       * step bound, which may have said nothing.
       */
      reason?: "stop" | "length" | "paused";
    };

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
