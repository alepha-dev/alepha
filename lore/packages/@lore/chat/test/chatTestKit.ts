import {
  ProjectCapabilityController,
  ProjectController,
  ResourceRegistry,
} from "@lore/core/api";
import { createTestMemberByProjectId } from "@lore/core/testing";
import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaFake, FakeProvider } from "alepha/testing/faker";

import {
  ChatLive,
  chatAgents,
  chatMentions,
  chatMessages,
  chatRoomMembers,
  chatRooms,
  LoreChatApi,
} from "../src/api/index.ts";
import type { ChatServerFrame } from "../src/api/schemas/chatServerFrameSchema.ts";

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

export interface ChatTestUser {
  id: string;
  roles: string[];
  username: string;
}

/**
 * The socket's sender, recording each frame and who it was addressed to
 * instead of sending it: that list is the privacy rule, and the same on Node
 * and on Workers, since both deliver exactly to the members named.
 */
export class RecordingChatLive extends ChatLive {
  public readonly frames: Array<{
    roomIds: string[];
    message: ChatServerFrame;
  }> = [];

  /**
   * Set by a spec to hold every send until it resolves, as a slow fan-out
   * over Durable Objects does on Workers.
   */
  public gate?: Promise<void>;

  public override async send(
    userIds: string[],
    frame: ChatServerFrame,
  ): Promise<void> {
    await this.gate;
    this.frames.push({ roomIds: [...new Set(userIds)], message: frame });
    for (const waiter of this.waiters) waiter();
  }

  protected readonly waiters = new Set<() => void>();

  /**
   * Resolves once the `message.created` frame of `messageId` was sent: a
   * send answers before its frames go (#Q4112).
   */
  public created(messageId: string): Promise<void> {
    const sent = () =>
      this.frames.some(
        (it) =>
          it.message.type === "message.created" &&
          it.message.message.id === messageId,
      );
    if (sent()) return Promise.resolve();
    return new Promise((resolve) => {
      const waiter = () => {
        if (!sent()) return;
        this.waiters.delete(waiter);
        resolve();
      };
      this.waiters.add(waiter);
    });
  }
}

/**
 * Every chat row, read straight from the tables, so a spec sees what a page
 * would not: an orphan.
 */
export class ChatRows {
  public readonly rooms = $repository(chatRooms);
  public readonly members = $repository(chatRoomMembers);
  public readonly messages = $repository(chatMessages);
  public readonly mentions = $repository(chatMentions);
  public readonly agents = $repository(chatAgents);
}

/**
 * One booted Lore with `@lore/chat`, and a project with chat on whose cast
 * covers every rank the room rules distinguish: its owner, a member, a
 * viewer, and a stranger who is not in the project.
 */
export class ChatTestKit {
  public static async boot(
    before: (alepha: Alepha) => void = () => {},
  ): Promise<ChatTestKit> {
    const alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
    });
    // A spec's own substitutions, before anything resolves them.
    before(alepha);
    alepha.with(AlephaOrm);
    alepha.with(AlephaServer);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaEmail);
    alepha.with(AlephaApiUsers);
    alepha.with(AlephaFake);
    // Before the module that resolves it.
    alepha.with({ provide: ChatLive, use: RecordingChatLive });
    alepha.with(LoreChatApi);
    // Plan and Remember own `#Q` and `#F`; chat depends on core only, so
    // the kit stands in for the two kinds a message may reference.
    const resources = alepha.inject(ResourceRegistry);
    resources.register({
      kind: "quest",
      letter: "Q",
      order: 0,
      permission: "quest:read",
    });
    resources.register({
      kind: "folio",
      letter: "F",
      order: 1,
      permission: "folio:read",
    });
    alepha.inject(ChatRows);
    await alepha.start();
    const kit = new ChatTestKit(alepha);
    await kit.cast();
    return kit;
  }

  public readonly alepha: Alepha;
  public owner!: ChatTestUser;
  public member!: ChatTestUser;
  public viewer!: ChatTestUser;
  public stranger!: ChatTestUser;
  public projectId!: number;

  constructor(alepha: Alepha) {
    this.alepha = alepha;
  }

  public get projects(): ProjectController {
    return this.alepha.inject(ProjectController);
  }

  public get capabilities(): ProjectCapabilityController {
    return this.alepha.inject(ProjectCapabilityController);
  }

  public async user(): Promise<ChatTestUser> {
    const fake = this.alepha.inject(FakeProvider).generate(userDataSchema);
    const response = await this.alepha
      .inject(AdminUserController)
      .createUser.fetch(
        { body: { ...fake, roles: ["user"] } },
        { user: adminUser },
      );
    return {
      id: response.data.id,
      roles: response.data.roles,
      username: fake.username,
    };
  }

  public async stop(): Promise<void> {
    await this.alepha.stop();
  }

  protected async cast(): Promise<void> {
    this.owner = await this.user();
    this.member = await this.user();
    this.viewer = await this.user();
    this.stranger = await this.user();
    const created = await this.projects.createProject.fetch(
      {
        body: {
          title: "Acme",
          capabilities: [{ key: "plan" }, { key: "chat" }],
        },
      },
      { user: this.owner },
    );
    this.projectId = created.data.id;
    await createTestMemberByProjectId(
      this.alepha,
      this.projectId,
      this.member.id,
    );
    await createTestMemberByProjectId(
      this.alepha,
      this.projectId,
      this.viewer.id,
      { rank: "viewer" },
    );
  }
}
