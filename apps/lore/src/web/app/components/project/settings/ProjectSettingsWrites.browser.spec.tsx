import { DialogProvider, Toaster } from "@alepha/ui";
import { ActionErrorToaster } from "@alepha/ui/shell";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/testing/react";
import { LinkProvider } from "alepha/server/links";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { projectFixture } from "@/testing/projectFixture.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import { I18n } from "@/web/app/services/I18n.ts";

import ProjectSettingsRanksPage from "./ProjectSettingsRanksPage.tsx";
import ProjectSettingsWorkPage from "./ProjectSettingsWorkPage.tsx";

/**
 * Answers the reads both pages make, and refuses the one write a case names.
 */
class FakeLinkProvider extends LinkProvider {
  refuse: Record<string, string> = {};
  calls: string[] = [];

  // matches the real client's own loose virtual-action shape
  override client(): any {
    const answers: Record<string, unknown> = {
      getRankCatalogue: {
        groups: [
          {
            name: "quest",
            label: "permission.group.quest",
            permissions: [{ name: "quest:create" }],
          },
        ],
      },
      getRanks: {
        items: [
          {
            key: "owner",
            name: "Owner",
            builtin: true,
            editable: false,
            permissions: ["*"],
          },
          {
            key: "member",
            name: "Member",
            builtin: true,
            editable: true,
            permissions: [],
          },
        ],
      },
      getProjectMembers: [],
      getRankPresets: { items: [] },
      listQuestTags: [],
      getProjectPrompts: [],
    };
    return new Proxy({} as Record<string, unknown>, {
      get: (_target, name: string) =>
        Object.assign(
          async () => {
            this.calls.push(name);
            if (this.refuse[name]) throw new Error(this.refuse[name]);
            return answers[name] ?? {};
          },
          { can: () => true },
        ),
    });
  }
}

/**
 * Two settings pages on `useAction` (#E59, #Q2324): a refused write is
 * toasted exactly once, by the root listener, with the server's message, and
 * the page does not pretend it happened.
 *
 * Every case uses its own message: sonner's toast store is module-level.
 */
describe("project settings writes", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (
    ui: ReactNode,
    refuse: Record<string, string>,
    project: unknown = projectFixture(),
  ) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactRouter)
      .with(AlephaReactI18n);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    const fake = alepha.inject(FakeLinkProvider);
    fake.refuse = refuse;
    alepha.store.set(currentProjectAtom, project as never);
    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <Toaster visibleToasts={20} />
          <ActionErrorToaster />
          {ui}
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    return fake;
  };

  const expectOneToast = async (message: string) => {
    await waitFor(() => expect(screen.getAllByText(message)).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.getAllByText(message)).toHaveLength(1);
  };

  it("toasts a refused column rename on the Work page once, and keeps the column", async () => {
    const fake = await mount(
      <ProjectSettingsWorkPage />,
      { renameKanbanColumn: "A column is already called Doing (spec)" },
      { ...projectFixture(), kanbanColumns: ["In Progress", "Review"] },
    );

    const field = await screen.findByDisplayValue("Review");
    fireEvent.change(field, { target: { value: "Doing" } });
    fireEvent.blur(field);

    await expectOneToast("A column is already called Doing (spec)");
    expect(fake.calls.filter((it) => it === "renameKanbanColumn")).toHaveLength(
      1,
    );
    // Refused, so the atom still names the column it had.
    expect(alepha!.store.get(currentProjectAtom)?.kanbanColumns).toEqual([
      "In Progress",
      "Review",
    ]);
  });

  it("toasts a refused rank save once", async () => {
    const fake = await mount(<ProjectSettingsRanksPage />, {
      saveRank: "You cannot grant a permission you do not hold (spec)",
    });

    const box = await waitFor(() => {
      const editable = screen
        .getAllByRole("checkbox", { name: "quest:create" })
        .find((it) => it.getAttribute("data-disabled") === null);
      expect(editable).toBeDefined();
      return editable!;
    });
    fireEvent.click(box);
    fireEvent.click(
      await screen.findByRole("button", { name: /save the ranks/i }),
    );

    await expectOneToast(
      "You cannot grant a permission you do not hold (spec)",
    );
    expect(fake.calls.filter((it) => it === "saveRank")).toHaveLength(1);
  });
});
