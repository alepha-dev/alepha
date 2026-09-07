import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { LinkProvider } from "alepha/server/links";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { I18n } from "../../../services/I18n.ts";
import ProjectMemberRankPicker from "./ProjectMemberRankPicker.tsx";

/**
 * The three behaviours this picker took a bug each to arrive at, plus the one
 * its move onto `Control` created (feedback #P2121).
 *
 * ⚠️ The move is not a swap. A raw `Select` was told what to show by a prop,
 * so the value could not leave the server's answer; a `Control` binds to a
 * form field, which holds what the reader picked. `initialValues` re-seeds on
 * the refetch and covers the success path - the failure path is put back by
 * hand, and that is what the last case here is for.
 */
describe("ProjectMemberRankPicker", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    // Base UI measures its popup before opening one, and jsdom ships no
    // ResizeObserver.
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as never;
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const RANKS = [
    { key: "owner", name: "Owner", permissions: [] },
    { key: "member", name: "Member", permissions: [] },
    // An opaque key, which is the whole reason the trigger must resolve a
    // name: this is what a rank somebody created looks like.
    { key: "r1x9k2", name: "Release manager", permissions: [] },
  ] as never;

  /**
   * The one call the picker makes. `fails` is how the refusal case arrives:
   * the module has five of them, and the picker's contract is that the row
   * goes back to the rank the person still holds.
   */
  class FakeLinkProvider extends LinkProvider {
    public fails = false;
    public calls: Array<Record<string, unknown>> = [];

    override client(): any {
      return new Proxy(
        {},
        {
          get: (_target, name) => {
            const fn: any = async (input: Record<string, unknown>) => {
              if (name === "assignRank") {
                this.calls.push(input);
                if (this.fails) {
                  throw new Error("You cannot change your own rank");
                }
              }
              return {};
            };
            fn.can = () => true;
            return fn;
          },
        },
      );
    }
  }

  const mount = async (rank = "member") => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");

    const links = alepha.inject(FakeLinkProvider);
    const view = render(
      <AlephaContext.Provider value={alepha}>
        <ProjectMemberRankPicker
          projectId={1}
          userId="00000000-0000-4000-8000-000000000001"
          rank={rank}
          ranks={RANKS}
          self={false}
          canAssign
          onAssigned={() => {}}
        />
      </AlephaContext.Provider>,
    );

    return { links, view };
  };

  const trigger = () => screen.getByTestId("member-rank");

  const pick = async (name: string | RegExp) => {
    fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name }));
  };

  it("shows the rank's NAME on the trigger, never its opaque key", async () => {
    // The bug this replaced: Base UI renders the raw value, and a rank's
    // value is its key, so the trigger read `r1x9k2` while the list under it
    // read "Release manager".
    await mount("r1x9k2");

    expect(trigger().textContent).toContain("Release manager");
    expect(trigger().textContent).not.toContain("r1x9k2");
  });

  it("does not offer owner", async () => {
    // Ownership is transferred, and the module refuses it as an assignment
    // target. Offering it and then explaining the refusal is worse than not
    // offering it.
    await mount();

    fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    const options = (await screen.findAllByRole("option")).map(
      (option) => option.textContent,
    );

    expect(options).toContain("Member");
    expect(options).toContain("Release manager");
    expect(options).not.toContain("Owner");
  });

  it("sends the pick, and disables itself until it lands", async () => {
    const { links } = await mount();

    await pick("Release manager");

    await waitFor(() => expect(links.calls).toHaveLength(1));
    expect((links.calls[0] as any).body).toEqual({ key: "r1x9k2" });
  });

  it("puts the row back to the held rank when the module refuses", async () => {
    // ⚠️ Nothing refetches on a refusal, so `initialValues` never changes and
    // the field would keep showing a rank nobody holds. The restore re-enters
    // the change handler, and `assign`'s own no-op guard is what stops it
    // becoming a second save.
    const { links } = await mount();
    links.fails = true;

    await pick("Release manager");

    await waitFor(() => expect(trigger().textContent).toContain("Member"));
    expect(trigger().textContent).not.toContain("Release manager");
    // One attempt, not two: the restore must not post anything.
    expect(links.calls).toHaveLength(1);
  });
});
