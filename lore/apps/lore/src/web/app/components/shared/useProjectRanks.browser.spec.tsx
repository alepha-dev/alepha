import { Toaster } from "@alepha/ui";
import { ActionErrorToaster } from "@alepha/ui/shell";
import { renderHook, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { HttpError } from "alepha/server";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import type { ReactNode } from "react";
import { beforeAll, describe, it } from "vitest";

import { projectFixture } from "@/testing/projectFixture.ts";
import { virtualClientFake } from "@/testing/virtualClientFake.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";

import { useProjectRanks } from "./useProjectRanks.ts";
import { useProjectUsers } from "./useProjectUsers.ts";

/**
 * Answers `getOrganizationRanks` and `getProjectUsers` with whatever the test sets.
 */
class FakeLinkProvider extends LinkProvider {
  ranksError?: Error;
  usersError?: Error;

  // matches the real client's own loose virtual-action shape
  override client(): any {
    return virtualClientFake({
      getOrganizationRanks: async () => {
        if (this.ranksError) throw this.ranksError;
        return { items: [{ key: "member" }] };
      },
      getProjectUsers: async () => {
        if (this.usersError) throw this.usersError;
        return [{ id: "u1", username: "ada" }];
      },
    });
  }
}

/**
 * The two shared reads, on keyed `useQuery`s (#Q2323), with the root
 * `ActionErrorToaster` mounted as Lore mounts it.
 *
 * `useProjectRanks` answers a reader who may not manage ranks with a 403 on
 * every project page that shows a picker, so that one is quiet, while any
 * other failure is worth a toast. `useProjectUsers` resolves names, which are
 * chrome: its failures are quiet and read as an empty list.
 */
describe("useProjectRanks and useProjectUsers", () => {
  beforeAll(() => {
    setupJsdomMocks();
  });

  const mount = async <T,>(
    hook: () => T,
    configure: (fake: FakeLinkProvider) => void,
  ) => {
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n);
    configure(alepha.inject(FakeLinkProvider));
    await alepha.start();
    alepha.store.set(currentProjectAtom, projectFixture() as never);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AlephaContext.Provider value={alepha}>
        <Toaster visibleToasts={20} />
        <ActionErrorToaster />
        {children}
      </AlephaContext.Provider>
    );
    return renderHook(hook, { wrapper });
  };

  const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

  it("reads the ranks", async ({ expect }) => {
    const { result } = await mount(useProjectRanks, () => {});

    await waitFor(() => expect(result.current.ranks).toHaveLength(1));
    expect(result.current.loading).toBe(false);
  });

  it("answers a 403 with no ranks and no toast", async ({ expect }) => {
    const { result } = await mount(useProjectRanks, (fake) => {
      fake.ranksError = new HttpError({
        status: 403,
        message: "Ranks are not yours to read (spec)",
      });
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    await settle();
    expect(result.current.ranks).toEqual([]);
    expect(screen.queryByText("Ranks are not yours to read (spec)")).toBeNull();
  });

  it("toasts any other ranks failure exactly once", async ({ expect }) => {
    await mount(useProjectRanks, (fake) => {
      fake.ranksError = new HttpError({
        status: 500,
        message: "Ranks store unavailable (spec)",
      });
    });

    await waitFor(() =>
      expect(
        screen.getAllByText("Ranks store unavailable (spec)"),
      ).toHaveLength(1),
    );
    await settle();
    expect(screen.getAllByText("Ranks store unavailable (spec)")).toHaveLength(
      1,
    );
  });

  it("reads the users, and a failure is an empty list with no toast", async ({
    expect,
  }) => {
    const ok = await mount(
      () => useProjectUsers(),
      () => {},
    );
    await waitFor(() => expect(ok.result.current).toHaveLength(1));

    const failing = await mount(
      () => useProjectUsers(),
      (fake) => {
        fake.usersError = new HttpError({
          status: 500,
          message: "Users store unavailable (spec)",
        });
      },
    );
    await settle();
    expect(failing.result.current).toEqual([]);
    expect(screen.queryByText("Users store unavailable (spec)")).toBeNull();
  });
});
