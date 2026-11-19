import { ProjectCapabilityController, ProjectController } from "@lore/core/api";
import { createTestMemberByProjectId } from "@lore/core/testing";
import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaFake, FakeProvider } from "alepha/testing/faker";

import { LoreChatApi } from "../src/api/index.ts";

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
 * One booted Lore with `@lore/chat`, and a project with chat on whose cast
 * covers every rank the room rules distinguish: its owner, a member, a
 * viewer, and a stranger who is not in the project.
 */
export class ChatTestKit {
  public static async boot(): Promise<ChatTestKit> {
    const alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
    });
    alepha.with(AlephaOrm);
    alepha.with(AlephaServer);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaEmail);
    alepha.with(AlephaApiUsers);
    alepha.with(AlephaFake);
    alepha.with(LoreChatApi);
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
