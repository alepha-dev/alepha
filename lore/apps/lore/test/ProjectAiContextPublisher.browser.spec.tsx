import { aiContextAtom } from "@alepha/ui/ai";
import { I18n, ProjectAiContextPublisher } from "@lore/core/web";
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
 * stored content is written in.
 */
describe("ProjectAiContextPublisher", () => {
  const mount = async (lang: "en" | "fr", preferredLanguage?: string) => {
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with(AlephaReact)
      .with(AlephaReactRouter)
      .with(AlephaReactI18n);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang(lang);
    const view = render(
      <AlephaContext.Provider value={alepha}>
        <ProjectAiContextPublisher
          project={{ id: 7, slug: "acme", title: "Acme", preferredLanguage }}
        />
      </AlephaContext.Provider>,
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
});
