import { DialogProvider, Toaster } from "@alepha/ui";
import { ActionErrorToaster } from "@alepha/ui/shell";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { setupJsdomMocks } from "alepha/react/testing";
import { LinkProvider } from "alepha/server/links";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { virtualClientFake } from "@/testing/virtualClientFake.ts";
import { I18n } from "@/web/app/services/I18n.ts";

import AppDeployRun from "./AppDeployRun.tsx";

/**
 * Plans the fast path, and refuses the rollback that follows it.
 */
class FakeLinkProvider extends LinkProvider {
  calls: string[] = [];

  // matches the real client's own loose virtual-action shape
  override client(): any {
    return virtualClientFake({
      planDeploymentRollback: async () => {
        this.calls.push("planDeploymentRollback");
        return { path: "version", migrationsSince: 0 };
      },
      rollbackDeployment: async () => {
        this.calls.push("rollbackDeployment");
        throw new Error("Cloudflare no longer holds that version (spec)");
      },
      startDeploy: async () => {
        this.calls.push("startDeploy");
        return {};
      },
    });
  }
}

/**
 * `AppDeployRun`'s rollback is one `useAction` holding the plan, the
 * confirmation and the write (#E59, #Q2329): cancelling the dialog sends no
 * write, and a refused rollback is toasted exactly once, by the root
 * listener, with the server's message.
 */
describe("AppDeployRun", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async () => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <Toaster visibleToasts={20} />
          <ActionErrorToaster />
          <AppDeployRun
            run={{
              id: "d1",
              status: "succeeded",
              tag: "1.2.0",
              instanceId: "i1",
              createdAt: "2026-09-14T10:00:00.000Z",
            }}
            projectId={1}
            canWrite
            live={false}
            onFollow={() => {}}
          />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    return alepha.inject(FakeLinkProvider);
  };

  const askToRollBack = async () => {
    fireEvent.click(screen.getByTestId("app-deploy-rollback-d1"));
    return await screen.findByRole("alertdialog");
  };

  it("sends no write when the confirmation is cancelled", async () => {
    const fake = await mount();

    const confirm = await askToRollBack();
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await waitFor(() =>
      expect(screen.getByTestId("app-deploy-rollback-d1")).toHaveProperty(
        "disabled",
        false,
      ),
    );
    expect(fake.calls).toEqual(["planDeploymentRollback"]);
  });

  it("toasts a refused rollback exactly once", async () => {
    const fake = await mount();

    const confirm = await askToRollBack();
    fireEvent.click(within(confirm).getByRole("button", { name: "Roll back" }));

    const message = "Cloudflare no longer holds that version (spec)";
    await waitFor(() => expect(screen.getAllByText(message)).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.getAllByText(message)).toHaveLength(1);
    expect(fake.calls).toEqual([
      "planDeploymentRollback",
      "rollbackDeployment",
    ]);
    // Refused, so nothing says it started.
    expect(screen.queryByText("Rolling back")).toBeNull();
  });
});
