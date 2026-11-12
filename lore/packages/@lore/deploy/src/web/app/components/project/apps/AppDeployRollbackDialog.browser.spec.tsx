import { DialogProvider, Toaster } from "@alepha/ui";
import { ActionErrorToaster } from "@alepha/ui/shell";
import { virtualClientFake } from "@lore/core/testing";
import { I18n } from "@lore/core/web";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import AppDeployRollbackDialog from "./AppDeployRollbackDialog.tsx";

/**
 * Plans what a case sets, and refuses the fast rollback that follows it.
 */
class FakeLinkProvider extends LinkProvider {
  calls: string[] = [];
  plan: Record<string, unknown> = { path: "version", migrationsSince: 0 };
  planError?: string;

  // matches the real client's own loose virtual-action shape
  override client(): any {
    return virtualClientFake({
      planDeploymentRollback: async () => {
        this.calls.push("planDeploymentRollback");
        if (this.planError) throw new Error(this.planError);
        return this.plan;
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
 * The rollback dialog reads the server's plan before it offers anything, says
 * what will happen, and sends nothing until it is confirmed.
 */
describe("AppDeployRollbackDialog", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    cleanup();
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (setup: (fake: FakeLinkProvider) => void = () => {}) => {
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
    setup(fake);
    const closed: string[] = [];
    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <Toaster visibleToasts={20} />
          <ActionErrorToaster />
          <AppDeployRollbackDialog
            run={{
              id: "d1",
              status: "succeeded",
              tag: "1.2.0",
              sha256: "a".repeat(64),
              instanceId: "i1",
              createdAt: "2026-09-14T10:00:00.000Z",
            }}
            current={{ id: "d2", status: "succeeded", tag: "1.3.0" }}
            projectId={1}
            onClose={() => closed.push("closed")}
          />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    return { fake, closed };
  };

  it("says what will happen before anything can be confirmed", async () => {
    const { fake } = await mount();

    const dialog = await screen.findByTestId("app-deploy-rollback-dialog");
    expect(dialog.textContent).toContain(
      "Lore deploys 1.2.0 (aaaaaaaaaaaa) in place of 1.3.0",
    );
    await screen.findByText(/takes seconds and uploads nothing/);
    expect(dialog.textContent).toContain("Only the code changes");
    expect(fake.calls).toEqual(["planDeploymentRollback"]);
  });

  it("sends no write when it is cancelled", async () => {
    const { fake, closed } = await mount();

    await screen.findByText(/takes seconds and uploads nothing/);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(closed).toEqual(["closed"]);
    expect(fake.calls).toEqual(["planDeploymentRollback"]);
  });

  it("names the migrations a rollback would run old code against", async () => {
    await mount((fake) => {
      fake.plan = { path: "version", migrationsSince: 2 };
    });

    await screen.findByText(/2 migration\(s\) have been applied/);
  });

  it("offers nothing to confirm when the server refuses the plan", async () => {
    const { fake } = await mount((it) => {
      it.planError = "That deployed copy is gone. (spec)";
    });

    await screen.findByText("That deployed copy is gone. (spec)");
    expect(screen.getByTestId("app-deploy-rollback-confirm")).toHaveProperty(
      "disabled",
      true,
    );
    expect(fake.calls).toEqual(["planDeploymentRollback"]);
  });

  it("toasts a refused rollback exactly once, and stays open", async () => {
    const { fake, closed } = await mount();

    await screen.findByText(/takes seconds and uploads nothing/);
    await waitFor(() =>
      expect(screen.getByTestId("app-deploy-rollback-confirm")).toHaveProperty(
        "disabled",
        false,
      ),
    );
    fireEvent.click(screen.getByTestId("app-deploy-rollback-confirm"));

    const message = "Cloudflare no longer holds that version (spec)";
    await waitFor(() => expect(screen.getAllByText(message)).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.getAllByText(message)).toHaveLength(1);
    expect(fake.calls).toEqual([
      "planDeploymentRollback",
      "rollbackDeployment",
    ]);
    // Refused, so nothing says it started and the dialog is still there.
    expect(screen.queryByText("Rolling back")).toBeNull();
    expect(closed).toEqual([]);
  });
});
