import { renderHook } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { $page } from "alepha/react/router";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/react/testing";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { EpicResource } from "@/api/schemas/epicResourceSchema.ts";
import { projectFixture } from "@/testing/projectFixture.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";

import { useAgentPromptSubject } from "./useAgentPromptSubject.ts";

/**
 * The one route the subject builds a URL from. `router.path` resolves
 * against the real page table, so a stub is what lets this spec run without
 * booting `AppRouter`.
 */
class Routes {
  epic = $page({
    name: "projectEpic",
    path: "/epics/:epicNumber",
    component: () => null,
  });
}

/**
 * The subject is what leaves Lore through the clipboard, so what it does NOT
 * carry is the assertion worth having.
 *
 * `useAgentPrompt` composes this with `renderPromptTemplate`, whose own spec
 * covers the substitution. What is pinned here is the assembly: seven named
 * fields, copied out of the resource one at a time, and nothing else.
 */
describe("useAgentPromptSubject", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const subjectFor = async (epic: unknown, project?: unknown) => {
    alepha = Alepha.create().with(AlephaReactRouter).with(AlephaReactI18n);
    alepha.inject(Routes);
    await alepha.start();
    alepha.store.set(
      currentProjectAtom,
      (project ?? projectFixture()) as never,
    );

    const { result } = renderHook(() => useAgentPromptSubject(), {
      wrapper: ({ children }) => (
        <AlephaContext.Provider value={alepha!}>
          {children}
        </AlephaContext.Provider>
      ),
    });
    return result.current.forEpic(epic as EpicResource);
  };

  const epic = {
    id: 67,
    number: 41,
    title: "Lore Agent Prompts",
    status: "planned",
  };

  it("carries the seven fields and no eighth", async () => {
    const subject = await subjectFor(epic);
    expect(Object.keys(subject).sort()).toEqual([
      "id",
      "number",
      "project",
      "reference",
      "slug",
      "title",
      "url",
    ]);
  });

  it("takes the epic's global id and its per-project number apart", async () => {
    const subject = await subjectFor(epic);
    // `{{id}}` feeds `quest_list`'s `epic:` filter, which wants the global
    // id; `{{number}}` is the #41 a reader recognises. Swapping them reads
    // as plausible in a prompt and finds the wrong epic.
    expect(subject.id).toBe(67);
    expect(subject.number).toBe(41);
    expect(subject.reference).toBe("#E41");
  });

  /**
   * ⚠️ The one that matters. An epic resource carries columns nobody chose
   * to publish; the subject is built field by field so a column added to
   * `epics` tomorrow cannot ride into somebody's clipboard.
   */
  it("carries nothing the resource happens to hold", async () => {
    const subject = await subjectFor({
      ...epic,
      description: "internal notes",
      secretToken: "sg_alepha_supersecret",
    });

    expect(JSON.stringify(subject)).not.toContain("sg_alepha_supersecret");
    expect(JSON.stringify(subject)).not.toContain("internal notes");
  });

  it("names the project by its title and keeps the slug for the URL", async () => {
    const subject = await subjectFor(epic, {
      ...projectFixture(),
      title: "Kanban v2",
      slug: "kanban-v2",
    });

    // ⚠️ Two fields because they are two values: `project_name` matches
    // `projects.title` lowercased and never the slug.
    expect(subject.project).toBe("Kanban v2");
    expect(subject.slug).toBe("kanban-v2");
    expect(subject.url).toContain("/epics/41");
  });
});
