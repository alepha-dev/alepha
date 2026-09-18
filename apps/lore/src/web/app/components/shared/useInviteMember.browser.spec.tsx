import { Toaster } from "@alepha/ui";
import { ActionErrorToaster } from "@alepha/ui/shell";
import { renderHook, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import type { ReactNode } from "react";
import { beforeAll, describe, it } from "vitest";

import { virtualClientFake } from "@/testing/virtualClientFake.ts";

import { useInviteMember } from "./useInviteMember.ts";

/**
 * Stands in for the HTTP-backed `useClient<InvitationController>()`. Same
 * substitution seam as `QuestDependencyPicker.browser.spec.tsx`
 * (`CLAUDE.md`: never `vi.mock` / `vi.spyOn`).
 */
class FakeLinkProvider extends LinkProvider {
  calls: Array<{
    params: { organizationId: string };
    body: { email: string; rank?: string };
  }> = [];
  refuse?: string;

  // matches the real client's own loose virtual-action shape
  override client(): any {
    return virtualClientFake({
      createOrganizationInvitation: async (config: {
        params: { organizationId: string };
        body: { email: string; rank?: string };
      }) => {
        this.calls.push(config);
        if (this.refuse) throw new Error(this.refuse);
        return { id: "inv-1" };
      },
    });
  }
}

/**
 * The header's create menu and the members settings card had a copy each of
 * this mutation, its blank-email guard and three hardcoded English toasts -
 * which is why the strings were never translated. One hook owns it now, and
 * reports back whether the invite went through so each caller can decide
 * what that means for its own form.
 *
 * Since #E59 the verb is a `useAction` run: a refusal is toasted by the root
 * `ActionErrorToaster`, not by the hook, and `invite` resolves `undefined`
 * for it.
 */
describe("useInviteMember", () => {
  const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000002";

  beforeAll(() => {
    setupJsdomMocks();
  });

  const mount = async () => {
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      // Before the modules that reach for it - a substitution after
      // `LinkProvider` has been instantiated is a `TooLateSubstitutionError`.
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n);
    await alepha.start();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AlephaContext.Provider value={alepha}>
        <Toaster visibleToasts={20} />
        <ActionErrorToaster />
        {children}
      </AlephaContext.Provider>
    );
    return {
      alepha,
      fake: alepha.inject(FakeLinkProvider),
      ...renderHook(() => useInviteMember(), { wrapper }),
    };
  };

  it("sends the invitation and reports success", async ({ expect }) => {
    const { fake, result } = await mount();

    const sent = await result.current.invite(
      ORGANIZATION_ID,
      "  guest@example.com  ",
      undefined,
    );

    expect(sent).toBe(true);
    // Trimmed, with the organization identity in the route parameters.
    expect(fake.calls).toEqual([
      {
        params: { organizationId: ORGANIZATION_ID },
        body: { email: "guest@example.com" },
      },
    ]);
  });

  it("refuses a blank email without asking the server", async ({ expect }) => {
    const { fake, result } = await mount();

    expect(await result.current.invite(ORGANIZATION_ID, "   ", undefined)).toBe(
      false,
    );
    expect(fake.calls).toEqual([]);
  });

  it("reports a refusal rather than throwing at the caller", async ({
    expect,
  }) => {
    const { fake, result } = await mount();
    fake.refuse = "User is already a member of this resource";

    // The caller's `if (!sent) return` is the whole error handling it needs:
    // an invite refused for a real reason must leave the dialog open with
    // the address still in it, not tear down the component tree. `undefined`,
    // not `false`: `false` is the blank email, a refusal the hook made itself.
    expect(
      await result.current.invite(
        ORGANIZATION_ID,
        "guest@example.com",
        undefined,
      ),
    ).toBeUndefined();
    expect(fake.calls.length).toBe(1);
  });

  it("toasts a refusal once, through the root listener, with the server's message", async ({
    expect,
  }) => {
    const { fake, result } = await mount();
    fake.refuse = "Invitation already pending (hook spec)";

    await result.current.invite(
      ORGANIZATION_ID,
      "pending@example.com",
      undefined,
    );

    await waitFor(() =>
      expect(
        screen.getAllByText("Invitation already pending (hook spec)"),
      ).toHaveLength(1),
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(
      screen.getAllByText("Invitation already pending (hook spec)"),
    ).toHaveLength(1);
  });

  it("sends the rank it is given, and none of `useAction`'s context", async ({
    expect,
  }) => {
    const { fake, result } = await mount();

    await result.current.invite(
      ORGANIZATION_ID,
      "ranked@example.com",
      "contributor",
    );
    await result.current.invite(
      ORGANIZATION_ID,
      "plain@example.com",
      undefined,
    );

    expect(fake.calls).toEqual([
      {
        params: { organizationId: ORGANIZATION_ID },
        body: { email: "ranked@example.com", rank: "contributor" },
      },
      {
        params: { organizationId: ORGANIZATION_ID },
        body: { email: "plain@example.com" },
      },
    ]);
  });

  it("clears `loading` once the call settles", async ({ expect }) => {
    const { result } = await mount();

    await result.current.invite(
      ORGANIZATION_ID,
      "guest@example.com",
      undefined,
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
  });
});
