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

import { projectFixture } from "../../../../testing/projectFixture.ts";
import { virtualClientFake } from "../../../../testing/virtualClientFake.ts";
import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import { useProjectUsers } from "./useProjectUsers.ts";

/**
 * Answers `getProjectUsers` with whatever the test sets.
 */
class FakeLinkProvider extends LinkProvider {
  usersError?: Error;

  // matches the real client's own loose virtual-action shape
  override client(): any {
    return virtualClientFake({
      getProjectUsers: async () => {
        if (this.usersError) throw this.usersError;
        return [{ id: "u1", username: "ada" }];
      },
    });
  }
}

/**
 * The shared users read, on a keyed `useQuery` (#Q2323), with the root
 * `ActionErrorToaster` mounted as Lore mounts it.
 *
 * `useProjectUsers` resolves names, which are chrome: its failures are quiet
 * and read as an empty list.
 */
describe("useProjectUsers", () => {
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
