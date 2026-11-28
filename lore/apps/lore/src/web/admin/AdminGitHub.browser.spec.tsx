import { DialogProvider } from "@alepha/ui";
import {
  act,
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
import { AlephaReactI18n } from "alepha/react/i18n";
import { $page, AlephaReactRouter, ReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, it } from "vitest";

import AdminGitHub from "./AdminGitHub.tsx";

const STORED = {
  configured: true,
  source: "stored",
  appId: "424242",
  slug: "lore-acme",
  name: "Lore acme",
  ownerLogin: "acme",
  htmlUrl: "https://github.com/apps/lore-acme",
  installUrl: "https://github.com/apps/lore-acme/installations/new",
  webhookUrl: "https://lore.example.app/api/github/webhook",
  webhookPingAt: "2026-11-28T10:00:00.000Z",
  settingsUrl: "https://github.com/organizations/acme/settings/apps/lore-acme",
};

/**
 * Answers the admin GitHub actions from a script, and records each call.
 * Substitution rather than `vi.mock`, per `AGENTS.md`.
 */
class GitHubLinkProvider extends LinkProvider {
  public static status: Record<string, unknown> = { configured: false };
  public calls: Array<{ name: string; request: unknown }> = [];

  override client(): any {
    return new Proxy(
      {},
      {
        get: (_target, name: string) =>
          Object.assign(
            async (request?: unknown) => {
              this.calls.push({ name, request });
              if (name === "completeGitHubAppManifest") {
                GitHubLinkProvider.status = STORED;
                return STORED;
              }
              return GitHubLinkProvider.status;
            },
            { can: () => true },
          ),
      },
    );
  }
}

class AdminRoutes {
  github = $page({ path: "/admin/github", component: () => null });
}

/**
 * Admin > GitHub (#Q4360): the configured App, the create form, and the
 * one-time code GitHub sends back.
 */
describe("AdminGitHub", () => {
  beforeAll(() => {
    setupJsdomMocks();
  });

  let alepha: Alepha | undefined;

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
    window.history.replaceState({}, "", "/");
  });

  const show = async (url = "/admin/github") => {
    cleanup();
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: GitHubLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactRouter);
    alepha.with(AdminRoutes);
    await alepha.start();
    await act(async () => {
      await alepha!.inject(ReactRouter).push(url as `/${string}`);
    });
    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <AdminGitHub />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    return alepha.inject(LinkProvider) as GitHubLinkProvider;
  };

  it("shows the App's slug, install link and that GitHub reached the webhook", async ({
    expect,
  }) => {
    GitHubLinkProvider.status = STORED;
    await show();

    await waitFor(() => expect(screen.getByText("lore-acme")).toBeTruthy());
    expect(
      screen.getByTestId("admin-github-install").getAttribute("href"),
    ).toBe("https://github.com/apps/lore-acme/installations/new");
    expect(screen.getByTestId("admin-github-webhook").textContent).toContain(
      "Reached",
    );
    expect(screen.getByText("Forget this App")).toBeTruthy();
  });

  it("links to the App's settings on GitHub for its logo, and offers Lore's (#Q4561)", async ({
    expect,
  }) => {
    GitHubLinkProvider.status = STORED;
    await show();

    await waitFor(() =>
      expect(screen.getByTestId("admin-github-settings")).toBeTruthy(),
    );
    expect(
      screen.getByTestId("admin-github-settings").getAttribute("href"),
    ).toBe("https://github.com/organizations/acme/settings/apps/lore-acme");
    const logo = screen.getByTestId("admin-github-logo-download");
    expect(logo.getAttribute("href")).toBe("/logo-512x512.png");
    expect(logo.hasAttribute("download")).toBe(true);
  });

  it("creates the App public by default, and private once unticked (#Q4561)", async ({
    expect,
  }) => {
    GitHubLinkProvider.status = {
      configured: false,
      webhookUrl: "https://lore.example.app/api/github/webhook",
    };
    const links = await show();
    const starts = () =>
      links.calls.filter((call) => call.name === "startGitHubAppManifest");

    await waitFor(() =>
      expect(screen.getByTestId("admin-github-create")).toBeTruthy(),
    );
    const toggle = screen.getByRole("switch", {
      name: "Anyone can install it",
    });
    expect(toggle.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(screen.getByTestId("admin-github-create"));
    await waitFor(() => expect(starts()).toHaveLength(1));
    expect(starts()[0].request).toEqual({ body: { public: true } });

    fireEvent.click(toggle);
    await waitFor(() =>
      expect(toggle.getAttribute("aria-checked")).toBe("false"),
    );
    fireEvent.click(screen.getByTestId("admin-github-create"));
    await waitFor(() => expect(starts()).toHaveLength(2));
    expect(starts()[1].request).toEqual({ body: { public: false } });
  });

  it("says GitHub has not reached the webhook yet", async ({ expect }) => {
    GitHubLinkProvider.status = { ...STORED, webhookPingAt: undefined };
    await show();

    await waitFor(() =>
      expect(screen.getByTestId("admin-github-webhook").textContent).toContain(
        "Not reached yet",
      ),
    );
  });

  it("offers to create the App when the instance has none", async ({
    expect,
  }) => {
    GitHubLinkProvider.status = {
      configured: false,
      webhookUrl: "https://lore.example.app/api/github/webhook",
    };
    await show();

    await waitFor(() =>
      expect(screen.getByTestId("admin-github-create")).toBeTruthy(),
    );
    expect(
      (screen.getByTestId("admin-github-create") as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("hands GitHub's one-time code to the server once, then shows the App", async ({
    expect,
  }) => {
    GitHubLinkProvider.status = {
      configured: false,
      webhookUrl: "https://lore.example.app/api/github/webhook",
    };
    const links = await show("/admin/github?code=abc123&state=s.sig");

    await waitFor(() => expect(screen.getByText("lore-acme")).toBeTruthy());
    const completes = links.calls.filter(
      (call) => call.name === "completeGitHubAppManifest",
    );
    expect(completes).toHaveLength(1);
    expect(completes[0].request).toEqual({
      body: { code: "abc123", state: "s.sig" },
    });
    expect(window.location.search).toBe("");
  });
});
