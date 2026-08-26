import { renderHook, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { LinkProvider } from "alepha/server/links";
import type { ReactNode } from "react";
import { describe, it } from "vitest";

import { useInviteMember } from "./useInviteMember.ts";

/**
 * Stands in for the HTTP-backed `useClient<InvitationController>()`. Same
 * substitution seam as `QuestDependencyPicker.browser.spec.tsx`
 * (`CLAUDE.md`: never `vi.mock` / `vi.spyOn`).
 */
class FakeLinkProvider extends LinkProvider {
  calls: Array<{ email: string; resourceId: string }> = [];
  refuse?: string;

  // matches the real client's own loose virtual-action shape
  override client(): any {
    return {
      createInvitation: async (config: {
        body: { email: string; resourceId: string };
      }) => {
        this.calls.push(config.body);
        if (this.refuse) throw new Error(this.refuse);
        return { id: "inv-1" };
      },
    };
  }
}

/**
 * The header's create menu and the members settings card had a copy each of
 * this mutation, its blank-email guard and three hardcoded English toasts —
 * which is why the strings were never translated. One hook owns it now, and
 * reports back whether the invite went through so each caller can decide
 * what that means for its own form.
 */
describe("useInviteMember", () => {
  const mount = async () => {
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      // Before the modules that reach for it — a substitution after
      // `LinkProvider` has been instantiated is a `TooLateSubstitutionError`.
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n);
    await alepha.start();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );
    return {
      alepha,
      fake: alepha.inject(FakeLinkProvider),
      ...renderHook(() => useInviteMember(), { wrapper }),
    };
  };

  it("sends the invitation and reports success", async ({ expect }) => {
    const { fake, result } = await mount();

    const sent = await result.current.invite(7, "  guest@example.com  ");

    expect(sent).toBe(true);
    // Trimmed, and the project id crosses as the string the API wants.
    expect(fake.calls).toEqual([
      {
        email: "guest@example.com",
        resourceType: "project",
        resourceId: "7",
      },
    ]);
  });

  it("refuses a blank email without asking the server", async ({ expect }) => {
    const { fake, result } = await mount();

    expect(await result.current.invite(7, "   ")).toBe(false);
    expect(fake.calls).toEqual([]);
  });

  it("reports a refusal rather than throwing at the caller", async ({
    expect,
  }) => {
    const { fake, result } = await mount();
    fake.refuse = "User is already a member of this resource";

    // The caller's `if (!sent) return` is the whole error handling it needs:
    // an invite refused for a real reason must leave the dialog open with
    // the address still in it, not tear down the component tree.
    expect(await result.current.invite(7, "guest@example.com")).toBe(false);
    expect(fake.calls.length).toBe(1);
  });

  it("clears `loading` once the call settles", async ({ expect }) => {
    const { result } = await mount();

    await result.current.invite(7, "guest@example.com");
    await waitFor(() => expect(result.current.loading).toBe(false));
  });
});
