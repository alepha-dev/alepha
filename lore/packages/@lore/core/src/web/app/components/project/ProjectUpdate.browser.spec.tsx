import { DialogProvider } from "@alepha/ui";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact, useStore } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, it } from "vitest";

import { projectFixture } from "../../../../testing/projectFixture.ts";
import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import { I18n } from "../../services/I18n.ts";
import ProjectUpdate from "./ProjectUpdate.tsx";
import ProjectSettingsGitHubSection from "./settings/ProjectSettingsGitHubSection.tsx";

const CONNECTION = {
  repositoryId: 42,
  installationId: 7,
  owner: "acme",
  name: "shop",
  defaultBranch: "main",
  connectedAt: "2026-11-01T10:00:00.000Z",
  fullName: "acme/shop",
  url: "https://github.com/acme/shop",
  connected: true,
};

class GitHubLinks extends LinkProvider {
  /**
   * The project's connection, or undefined when it has none.
   */
  connection: object | undefined = CONNECTION;
  /**
   * The bodies `updateProjectById` received.
   */
  updates: Array<Record<string, unknown>> = [];

  override client(): any {
    return new Proxy(
      {},
      {
        get: (_target, action: string) =>
          Object.assign(
            async (request: any) => {
              if (action === "getProjectGitHub") {
                return {
                  available: true,
                  ...(this.connection ? { connection: this.connection } : {}),
                };
              }
              if (action === "disconnectProjectGitHub") {
                this.connection = {
                  ...CONNECTION,
                  connected: false,
                  disconnectedAt: "2026-11-02T10:00:00.000Z",
                  disconnectReason: "member",
                };
                return { available: true, connection: this.connection };
              }
              if (action === "updateProjectById") {
                this.updates.push(request.body);
                return projectFixture({ id: 7, title: request.body.title });
              }
              return {};
            },
            { can: () => true },
          ),
      },
    );
  }
}

/**
 * The General page's two cards, the form fed from the atom as the page
 * feeds it.
 */
const Page = () => {
  const [project] = useStore(currentProjectAtom);
  if (!project) return null;
  return (
    <>
      <ProjectUpdate project={project} />
      <ProjectSettingsGitHubSection />
    </>
  );
};

class Routes {
  banner = $page({
    name: "projectSettingsBanner",
    path: "/:projectSlug/settings",
    component: () => null,
  });
}

/**
 * Settings > General's Repository field while the project is connected to
 * GitHub (#Q4560): the connection owns the URL, so the field is read-only,
 * says why, and a save leaves it out of the request the server would refuse.
 */
describe("ProjectUpdate", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    cleanup();
    await alepha?.stop();
    alepha = undefined;
  });

  const boot = async (connection: object | undefined) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: GitHubLinks })
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactRouter);
    alepha.inject(Routes);
    alepha.inject(I18n);
    const links = alepha.inject(LinkProvider) as GitHubLinks;
    links.connection = connection;
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    // The atom's URL predates the connection, as after the redirect from
    // `/github/connect`.
    const project = {
      ...projectFixture({ id: 7, title: "Acme", slug: "acme" }),
      repositoryUrl: "https://github.com/acme/old",
    };
    alepha.store.set(currentProjectAtom, project);
    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <Page />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    return links;
  };

  const repositoryField = () =>
    screen.getByLabelText("Repository") as HTMLInputElement;

  it("is editable, with its usual helper, while the project is not connected", async ({
    expect,
  }) => {
    const links = await boot(undefined);
    await screen.findByTestId("project-settings-github-connect");

    expect(repositoryField().disabled).toBe(false);
    expect(repositoryField().value).toBe("https://github.com/acme/old");
    expect(
      screen.getByText(/The repository this project's commits live in/),
    ).toBeTruthy();
    expect(screen.queryByText(/Set by the GitHub connection/)).toBeNull();

    // An edit of it is saved.
    fireEvent.change(repositoryField(), {
      target: { value: "https://github.com/acme/new" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    await waitFor(() => expect(links.updates).toHaveLength(1));
    expect(links.updates[0].repositoryUrl).toBe("https://github.com/acme/new");
  });

  it("is read-only, shows the connected repository and saves without it", async ({
    expect,
  }) => {
    const links = await boot(CONNECTION);

    await waitFor(() => expect(repositoryField().disabled).toBe(true));
    expect(repositoryField().value).toBe("https://github.com/acme/shop");
    expect(screen.getByText(/Set by the GitHub connection/)).toBeTruthy();
    // Disabled, so no clear (x) button either.
    expect(document.querySelector('[data-slot="control-clear"]')).toBeNull();

    // Another field's edit saves (a new case keeps the slug, so no rename
    // to confirm), and the URL is not in the request.
    const name = screen.getByLabelText("Name") as HTMLInputElement;
    fireEvent.change(name, { target: { value: "ACME" } });
    const save = await screen.findByRole("button", { name: "Save" });
    await waitFor(() =>
      expect((save as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(save);
    await waitFor(() => expect(links.updates).toHaveLength(1));
    expect(links.updates[0].title).toBe("ACME");
    expect("repositoryUrl" in links.updates[0]).toBe(false);
  });

  it("becomes editable again once GitHub is disconnected, without a reload", async ({
    expect,
  }) => {
    await boot(CONNECTION);
    await waitFor(() => expect(repositoryField().disabled).toBe(true));

    fireEvent.click(screen.getByTestId("project-settings-github-disconnect"));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Disconnect" }));

    await waitFor(() => expect(repositoryField().disabled).toBe(false));
    expect(screen.queryByText(/Set by the GitHub connection/)).toBeNull();
    // The server's URL, the connected repository's, not the one the atom
    // held before the connection.
    expect(repositoryField().value).toBe("https://github.com/acme/shop");
  });
});
