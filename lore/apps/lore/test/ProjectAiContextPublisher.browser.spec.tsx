import { aiContextAtom } from "@alepha/ui/ai";
import { projectFixture } from "@lore/core/testing";
import {
  currentProjectAtom,
  I18n,
  ProjectAiContextPublisher,
  useProjectAiContext,
} from "@lore/core/web";
import { render, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { describe, it } from "vitest";

/**
 * What an assistant turn sent from a project page carries (#Q3208): the
 * project's id, slug and title, the interface language, and the language
 * stored content is written in; and a narrower page what it shows, marked as
 * written by members, each text cut (#Q3972).
 */
const UseCaseProbe = () => {
  useProjectAiContext("useCase", {
    kind: "useCase",
    number: 7,
    steps: ["Opens the basket", "x".repeat(4000)],
  });
  return null;
};

describe("ProjectAiContextPublisher", () => {
  const mount = async (
    lang: "en" | "fr",
    preferredLanguage?: string,
    node: React.ReactNode = <ProjectAiContextPublisher />,
  ) => {
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with(AlephaReact)
      .with(AlephaReactRouter)
      .with(AlephaReactI18n);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang(lang);
    alepha.store.set(currentProjectAtom, {
      ...projectFixture({ id: 7 }),
      slug: "acme",
      title: "Acme",
      preferredLanguage,
    } as never);
    const view = render(
      <AlephaContext.Provider value={alepha}>{node}</AlephaContext.Provider>,
    );
    return { alepha, view };
  };

  it("pushes the project and the interface language", async ({ expect }) => {
    const { alepha } = await mount("fr", "ja");
    await waitFor(() =>
      expect(alepha.store.get(aiContextAtom)?.at(-1)).toMatchObject({
        page: "project",
        data: {
          projectId: 7,
          projectSlug: "acme",
          projectTitle: "Acme",
          language: "fr",
          contentLanguage: "ja",
        },
      }),
    );
  });

  it("writes stored content in English when the project sets no language, and leaves on unmount", async ({
    expect,
  }) => {
    const { alepha, view } = await mount("en");
    await waitFor(() =>
      expect(alepha.store.get(aiContextAtom)?.at(-1)?.data).toMatchObject({
        contentLanguage: "en",
      }),
    );
    view.unmount();
    expect(alepha.store.get(aiContextAtom) ?? []).toEqual([]);
  });

  it("carries what a narrower page shows, marked as members' text and cut", async ({
    expect,
  }) => {
    const { alepha } = await mount("en", undefined, <UseCaseProbe />);
    await waitFor(() =>
      expect(alepha.store.get(aiContextAtom)?.at(-1)).toMatchObject({
        page: "useCase",
        data: {
          projectId: 7,
          shown: { writtenBy: "project members", kind: "useCase", number: 7 },
        },
      }),
    );
    const data = alepha.store.get(aiContextAtom)?.at(-1)?.data as {
      shown: { steps: string[] };
    };
    const steps = data.shown.steps;
    expect(steps[0]).toBe("Opens the basket");
    expect(steps[1]).toHaveLength(1500 + "...[cut]".length);
  });
});
