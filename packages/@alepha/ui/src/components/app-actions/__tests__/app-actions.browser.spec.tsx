import { render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/react/testing";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { ButtonUser } from "../../button-user/button-user.tsx";
import { DropdownMenu, DropdownMenuContent } from "../../ui/dropdown-menu.tsx";

/**
 * What this pins is the bug that prompted the shared cluster: `apps/lore`'s
 * header pushed a route called `me`, which stopped existing when the profile
 * pages moved to `/account`. It kept compiling — `router.push` falls back to a
 * plain `string` overload — and threw only when somebody clicked it.
 *
 * `AccountMenuItem` owns its destination so no caller can pass a dead name,
 * and hides itself when the account area is not mounted so an application
 * without one gets no entry rather than a broken one.
 */
describe("ButtonUser.AccountMenuItem", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (options: { withAccountRoute: boolean }) => {
    alepha = Alepha.create().with(AlephaReactRouter);

    if (options.withAccountRoute) {
      class AccountLike {
        account = $page({
          name: "account",
          path: "/account",
          component: () => "account",
        });
      }
      alepha.with(AccountLike);
    }

    // A signed-in viewer; the item is account-holder-only.
    alepha.store.set("alepha.security.user", {
      id: "u-1",
      email: "ada@example.com",
    } as never);
    await alepha.start();

    // `DropdownMenuItem` needs a menu ancestor (Base UI throws without one),
    // and the menu must be open for its content to mount.
    return render(
      <AlephaContext.Provider value={alepha}>
        <DropdownMenu open>
          <DropdownMenuContent>
            <ButtonUser.AccountMenuItem />
          </DropdownMenuContent>
        </DropdownMenu>
      </AlephaContext.Provider>,
    );
  };

  it("renders nothing when no account route is mounted", async () => {
    // An application that never mounts AccountRouter must get no entry — a
    // visible one would throw on click, which is exactly the old failure.
    await mount({ withAccountRoute: false });

    expect(screen.queryByText("User Account")).toBeNull();
  });

  it("labels itself 'User Account' when the area exists", async () => {
    await mount({ withAccountRoute: true });

    expect(screen.getByText("User Account")).toBeTruthy();
  });
});
