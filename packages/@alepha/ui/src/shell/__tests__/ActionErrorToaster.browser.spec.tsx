import { render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { setupJsdomMocks } from "alepha/react/testing";
import { HttpError } from "alepha/server";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { Toaster } from "../../ui/sonner.tsx";
import { ActionErrorToaster } from "../action-error-toaster.tsx";

/**
 * `ActionErrorToaster` is the single owner of the error toast: `AppShell`
 * mounts it, and it turns every `react:action:error` into one toast reading
 * `error.message`.
 *
 * That ownership is the whole point of the component, and it is what a call
 * site quietly takes back by catching its own failure, calling `toast.error`
 * and rethrowing - the rethrow still arrives here, so the same sentence lands
 * twice as two identical stacked toasts. `apps/lore/e2e/admin-user-detail`
 * caught exactly that on the admin profile form, where a refused duplicate
 * email matched two elements instead of one. A page that wants different
 * wording has `format`; a page that wants no toast at all has `filter`.
 *
 * Every test uses its own message text: sonner's toast store is module-level,
 * so what one test raises is still there for the next one to find.
 */
describe("ActionErrorToaster", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (ui: ReactNode) => {
    alepha = Alepha.create().with(AlephaReactI18n);
    await alepha.start();
    render(
      <AlephaContext.Provider value={alepha}>
        {/* Well above sonner's default of 3, so an earlier test's leftovers
            can never evict the toast under assertion. */}
        <Toaster visibleToasts={20} />
        {ui}
      </AlephaContext.Provider>,
    );
    return alepha;
  };

  const fail = (app: Alepha, status: number, message: string) =>
    app.events.emit(
      "react:action:error",
      {
        type: "custom",
        id: "action",
        error: new HttpError({ status, message }),
      },
      { catch: true },
    );

  it("shows one toast, and only one, for a failed action", async () => {
    const app = await mount(<ActionErrorToaster />);

    await fail(app, 409, "Email already exists");

    await waitFor(() => {
      expect(screen.getAllByText("Email already exists")).toHaveLength(1);
    });
  });

  it("toasts each failure once", async () => {
    const app = await mount(<ActionErrorToaster />);

    await fail(app, 409, "Username already exists");
    await fail(app, 401, "Session expired");

    await waitFor(() => {
      expect(screen.getAllByText("Session expired")).toHaveLength(1);
    });
    expect(screen.getAllByText("Username already exists")).toHaveLength(1);
  });

  it("stays silent when disabled", async () => {
    const app = await mount(<ActionErrorToaster enabled={false} />);

    await fail(app, 500, "Disabled failure");

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText("Disabled failure")).toBeNull();
  });

  it("lets a caller drop one error instead of adding a toast beside it", async () => {
    const app = await mount(
      <ActionErrorToaster
        filter={(error) =>
          !(error instanceof HttpError && error.status === 409)
        }
      />,
    );

    await fail(app, 409, "Filtered conflict");
    await fail(app, 500, "Unfiltered failure");

    await waitFor(() => {
      expect(screen.getAllByText("Unfiltered failure")).toHaveLength(1);
    });
    expect(screen.queryByText("Filtered conflict")).toBeNull();
  });
});
