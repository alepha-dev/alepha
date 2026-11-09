import { createTestProject } from "@lore/core/testing";
import { DateTimeProvider } from "alepha/datetime";
import { describe, it } from "vitest";

import { LoreAiPrompt } from "@/assistant/index.ts";

import { bootAssistant } from "./fixtures/bootAssistant.ts";

/**
 * The assistant knows the project, the page and who is asking (#Q3208).
 *
 * What a scripted model can prove: what the prompt says and what each turn
 * carries and offers. Whether a real model obeys "never another project" is
 * the cross-project prompt of the model check (#Q3213).
 */
describe("the assistant's context", () => {
  it("writes the rules, the user and today in the system prompt", async ({
    expect,
  }) => {
    const { alepha } = await bootAssistant({ enabled: "1" });
    const today = alepha.inject(DateTimeProvider).now().format("YYYY-MM-DD");
    const system = alepha.inject(LoreAiPrompt).system({
      id: "u1",
      name: "Ada Lovelace",
      email: "ada@example.app",
      roles: ["user"],
    });
    expect(system).toContain("Ada Lovelace <ada@example.app>");
    expect(system).toContain('"Me", "my" and "I" mean them');
    expect(system).toContain(`Today is ${today}.`);
    expect(system).toContain("pass that id as `project` to every tool");
    expect(system).toContain("say it is not in this project and stop");
    expect(system).toContain("`contentLanguage`, English when it is absent");
    expect(system).toContain("ask which project they mean");
    await alepha.stop();
  });

  it("names project A in the context block of a turn sent from project A", async ({
    expect,
  }) => {
    const { alepha, controller, signIn, read, ai } = await bootAssistant({
      enabled: "1",
    });
    const project = await createTestProject(alepha, { title: "Alpha Works" });
    const { headers } = await signIn(project.createdBy);
    ai.script([{ type: "text", text: "Hello." }]);

    await read(
      await controller.chat.fetch({
        headers,
        body: {
          message: "what is open?",
          context: {
            route: `/${project.slug}/quests`,
            page: "project",
            data: {
              projectId: project.id,
              projectSlug: project.slug,
              projectTitle: project.title,
              language: "en",
              contentLanguage: "en",
            },
          },
        },
      }),
    );

    const sent = ai.last!.messages.at(-1)!;
    expect(sent.role).toBe("user");
    expect(sent.content).toContain("<page-context>");
    expect(sent.content).toContain(`"projectId":${project.id}`);
    expect(sent.content).toContain('"projectTitle":"Alpha Works"');
    expect(ai.last!.system).toContain("pass that id as `project`");
    expect((ai.last!.tools ?? []).map((t) => t.name)).not.toContain(
      "project_list",
    );
    await alepha.stop();
  });

  it("offers project_list alone off a project page", async ({ expect }) => {
    const { alepha, controller, signIn, read, ai } = await bootAssistant({
      enabled: "1",
    });
    const { headers } = await signIn();
    ai.script([{ type: "text", text: "Which project?" }]);

    await read(
      await controller.chat.fetch({
        headers,
        body: {
          message: "what is open?",
          context: { route: "/", page: "home" },
        },
      }),
    );
    expect(ai.last!.tools?.map((t) => t.name)).toEqual(["project_list"]);

    ai.script([{ type: "text", text: "Which project?" }]);
    await read(
      await controller.chat.fetch({ headers, body: { message: "hello" } }),
    );
    expect(ai.last!.tools?.map((t) => t.name)).toEqual(["project_list"]);
    await alepha.stop();
  });
});
