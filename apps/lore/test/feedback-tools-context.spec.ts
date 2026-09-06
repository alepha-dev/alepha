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
 * `context` on `feedback_get`.
 *
 * The block existed on the entity and rendered in Lore's own CONTEXT panel,
 * but `feedback_get` built its result field by field and never read
 * `source`, so an agent triaging over MCP saw the prose and nothing else.
 * That is the failure this guards: a report reading "make website
 * responsive" was filed against the wrong app while `pageUrl` said
 * `https://lore.alepha.dev/` and `viewport` said `411x845`.
 *
 * Same identity-injection shim as `feedback-tools-attachments.spec.ts`.
 */

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

  const call = (tool: any, params: Record<string, unknown>, userId = OWNER) =>
    asUser(userId, () => tool.execute(params));

  const project = await asUser(OWNER, () =>
    projectApi.createProject({
      body: { title: "Test", capabilities: [{ key: "support" }] },
    } as any),
  );

  const report = async (title: string, source?: Record<string, unknown>) =>
    await asUser(OWNER, () =>
      feedbackApi.submitFeedback({
        params: { projectId: project.id },
        body: { title, description: "x", ...(source ? { source } : {}) },
      } as any),
    );

  return { feedbackTools, project, call, report };
};

describe("Lore MCP: feedback_get context", () => {
  it("returns the page, browser and viewport the report came from", async () => {
    const { feedbackTools, project, call, report } = await setup();
    const item = await report("Make website responsive", {
      hostUrl: "https://lore.alepha.dev/",
      hostPath: "/",
      title: "Alepha Lore",
      referrer: "https://google.com/",
      userAgent: "Chrome 151 on Android",
      language: "fr-FR",
      viewport: "411x845",
      screen: "412x915",
      timezone: "Europe/Paris",
      consoleTail: ["TypeError: x is undefined"],
    });

    const res = await call(feedbackTools.feedback_get, {
      project: project.id,
      id: item.id,
    });

    // Renamed on the way out: `host*` reads as a server, and a bare `title`
    // inside a feedback item is ambiguous with the item's own.
    expect(res.context).toEqual({
      pageUrl: "https://lore.alepha.dev/",
      pagePath: "/",
      pageTitle: "Alepha Lore",
      referrer: "https://google.com/",
      userAgent: "Chrome 151 on Android",
      language: "fr-FR",
      viewport: "411x845",
      screen: "412x915",
      timezone: "Europe/Paris",
      consoleTail: ["TypeError: x is undefined"],
      sigilId: undefined,
    });
  });

  it("carries the two fields that decide which app and which width", async () => {
    const { feedbackTools, project, call, report } = await setup();
    const item = await report("Make website responsive", {
      hostUrl: "https://lore.alepha.dev/",
      hostPath: "/",
      userAgent: "Chrome 151 on Android",
      viewport: "411x845",
    });

    const res = await call(feedbackTools.feedback_get, {
      project: project.id,
      id: item.id,
    });

    // The regression in one assertion: the title says "website" and nothing
    // else in the payload distinguishes the docs site from Lore.
    expect(res.context?.pageUrl).toContain("lore.alepha.dev");
    expect(res.context?.viewport).toBe("411x845");
  });

  it("omits context entirely when the submission carried none", async () => {
    const { feedbackTools, project, call, report } = await setup();
    const item = await report("Filed from Lore's own form");

    const res = await call(feedbackTools.feedback_get, {
      project: project.id,
      id: item.id,
    });

    // Absent, not an object of empty strings: a page with every field blank
    // reads as a page that was captured and came back empty.
    expect(res.context).toBeUndefined();
  });

  it("returns the discussion alongside the context", async () => {
    const { feedbackTools, project, call, report } = await setup();
    const item = await report("Has a thread", {
      hostUrl: "https://lore.alepha.dev/",
      hostPath: "/",
      userAgent: "Chrome 151 on Android",
    });

    await call(feedbackTools.feedback_comment_add, {
      project: project.id,
      id: item.id,
      body: "Which width did you see this at?",
      as: "claude-code",
    });

    const res = await call(feedbackTools.feedback_get, {
      project: project.id,
      id: item.id,
    });

    expect(res.context?.pageUrl).toBe("https://lore.alepha.dev/");
    expect(res.discussion).toHaveLength(1);
    expect(res.discussion[0].body).toBe("Which width did you see this at?");
    // Written over MCP, so it is an agent's line and the name says nothing
    // about who to answer.
    expect(res.discussion[0].authorKind).toBe("agent");
    expect(res.discussionTruncated).toBe(false);
  });
});
