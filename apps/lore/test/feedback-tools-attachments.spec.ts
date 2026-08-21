import { Alepha } from "alepha";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake } from "alepha/fake";
import { AlephaMcp } from "alepha/mcp";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity, currentUserAtom } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { describe, expect, it } from "vitest";

import { FeedbackController } from "../src/api/controllers/FeedbackController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { LoreApi } from "../src/api/index.ts";
import { LoreMcp } from "../src/mcp/index.ts";
import { FeedbackTools } from "../src/mcp/tools/FeedbackTools.ts";

/**
 * `attachmentCount` on `feedback_list`: triage should not need a
 * `feedback_get` per row to discover which reports came with a screenshot.
 *
 * Same identity-injection shim as `quest-tools-comments.spec.ts`.
 */

// 1x1 transparent PNG.
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

const setup = async () => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
  });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with(AlephaMcp);
  alepha.with(LoreApi);
  alepha.with(LoreMcp);

  const feedbackTools = alepha.inject(FeedbackTools);
  const feedbackApi = alepha.inject(FeedbackController);
  const projectApi = alepha.inject(ProjectController);
  const users = alepha.inject(UserService);
  await alepha.start();

  const owner = await users.createUser({ username: "owner" });
  const OWNER = owner.id;

  const asUser = <R>(userId: string, fn: () => R): R =>
    alepha.context.run(() => {
      alepha.store.set(currentUserAtom, { id: userId, roles: ["user"] } as any);
      return fn();
    });

  // mirrors quest-tools-comments.spec.ts's own tool-execute helper
  const call = (tool: any, params: Record<string, unknown>, userId = OWNER) =>
    asUser(userId, () => tool.execute(params));

  const project = await asUser(OWNER, () =>
    projectApi.createProject({ body: { title: "Test" } } as any),
  );

  /** Submit a report, optionally carrying `count` screenshots. */
  const report = async (title: string, count: number) => {
    const attachments: string[] = [];
    for (let i = 0; i < count; i++) {
      const uploaded = await asUser(OWNER, () =>
        feedbackApi.uploadFeedbackAttachment({
          params: { projectId: project.id },
          body: {
            file: new File([new Uint8Array(PNG_BYTES)], `shot-${i}.png`, {
              type: "image/png",
            }),
          },
        } as any),
      );
      attachments.push(uploaded.id);
    }
    return await asUser(OWNER, () =>
      feedbackApi.submitFeedback({
        params: { projectId: project.id },
        body: { title, description: "x", attachments },
      } as any),
    );
  };

  return { feedbackTools, project, call, report };
};

describe("Lore MCP: feedback_list attachmentCount", () => {
  it("counts the files on each row without a per-row fetch", async () => {
    const { feedbackTools, project, call, report } = await setup();
    await report("Bare report", 0);
    await report("Report with two screenshots", 2);

    const res = await call(feedbackTools.feedback_list, {
      project: project.id,
      status: "all",
    });

    const byTitle = new Map<string, any>(
      res.feedback.map((f: any) => [f.title, f]),
    );
    expect(byTitle.get("Report with two screenshots").attachmentCount).toBe(2);
    expect(byTitle.get("Bare report").attachmentCount).toBe(0);
  });
});
