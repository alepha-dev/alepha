import { AlephaError } from "alepha";
import type { UserAccountToken } from "alepha/security";

/**
 * The agents a room can mention (#E161, #Q3930): a name that is not a
 * member, and what answers a message naming it.
 *
 * `@lore/chat` imports core only and the agent's tools span every package,
 * so the agent is not here: the app's assistant module registers `lore` on
 * this registry, and only when AI is on. With nothing registered, `@lore` is
 * plain text and no run starts.
 */
export class ChatResponderRegistry {
  protected readonly responders = new Map<string, ChatResponder>();

  public register(responder: ChatResponder): void {
    if (this.responders.has(responder.name)) {
      throw new AlephaError(
        `Chat responder '${responder.name}' is registered twice`,
      );
    }
    this.responders.set(responder.name, responder);
  }

  public get(name: string): ChatResponder | undefined {
    return this.responders.get(name);
  }

  /**
   * The agent a personal room talks to, if one is registered.
   */
  public personal(): ChatResponder | undefined {
    return [...this.responders.values()].find((it) => it.personal);
  }

  public names(): string[] {
    return [...this.responders.keys()];
  }
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
   * The run log this member and room continue, if one exists.
   */
  conversationId?: string;
}

export interface ChatAgentDecision {
  projectId: number;
  user: UserAccountToken;
  conversationId: string;
  callId: string;
  decision: "approve" | "deny";
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
   * The agent a member's personal room talks to (#Q3942): one at most.
   */
  personal?: boolean;
  respond: (request: ChatAgentRequest) => AsyncIterable<ChatAgentEvent>;
  /**
   * Continue a run paused on a write the mentioner must decide.
   */
  resume: (decision: ChatAgentDecision) => AsyncIterable<ChatAgentEvent>;
}
