import { projectFixture } from "@lore/core/testing";
import { currentProjectAtom, I18n } from "@lore/core/web";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { LinkProvider } from "alepha/server/links";
import { describe, it } from "vitest";

import type { ArtifactDetail } from "../../../../../api/schemas/artifactDetailSchema.ts";
import type { ArtifactResource } from "../../../../../api/schemas/artifactResourceSchema.ts";
import { currentInstancesAtom } from "../../../atoms/currentInstancesAtom.ts";
import ArtifactNewCopyDialog from "./ArtifactNewCopyDialog.tsx";

const aProject = projectFixture({ title: "Alepha", slug: "alepha" });

const INSTANCE_ID = "00000000-0000-4000-8000-000000000001";
const ESTATE_ID = "00000000-0000-4000-8000-000000000002";

const variant: ArtifactResource = {
  id: "00000000-0000-4000-8000-000000000003",
  projectId: 1,
  app: "docs",
  tag: "1.0.0",
  runtime: "workerd",
  runtimes: ["workerd"],
  format: "archive",
  sha256: "a".repeat(64),
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
};

const detail: ArtifactDetail = {
  app: "docs",
  tag: "1.0.0",
  pushedAt: variant.updatedAt,
  variants: [variant],
  copies: [],
  deployments: [],
};

const estate = (id: string, slug: string, accepted: string) => ({
  id,
  slug,
  type: accepted === "workerd" ? "cloudflare" : "bay",
  online: true,
  deployAllowed: true,
  acceptedRuntimes: [accepted],
  owner: { id: ESTATE_ID, name: "owner" },
});

/**
 * Same substitution seam as `AppCreateDialog`'s spec.
 */
class RecordingLinkProvider extends LinkProvider {
  public calls: string[] = [];
  public bodies: Record<string, any> = {};
  public responses: Record<string, unknown> = {};

  override client(): any {
    return new Proxy(
      {},
      {
        get: (_target, action: string) => {
          const fn = async (config: { body?: unknown } = {}) => {
            this.calls.push(action);
            this.bodies[action] = config.body;
            const answer = this.responses[action];
            if (answer instanceof Error) throw answer;
            return answer ?? {};
          };
          fn.can = () => true;
          return fn;
        },
      },
    );
  }
}

describe("ArtifactNewCopyDialog", () => {
  const mount = async (responses: Record<string, unknown> = {}) => {
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: RecordingLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(I18n);
    await alepha.start();
    alepha.store.set(currentProjectAtom, aProject);
    alepha.store.set(currentInstancesAtom, []);

    const links = alepha.inject(LinkProvider) as RecordingLinkProvider;
    links.responses = {
      listProjectEstates: {
        items: [
          estate(ESTATE_ID, "cf-feunard", "workerd"),
          estate("00000000-0000-4000-8000-000000000004", "ovh", "node"),
        ],
      },
      createApp: {
        id: INSTANCE_ID,
        projectId: 1,
        ephemeral: false,
        app: "docs",
        env: "staging",
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z",
      },
      ...responses,
    };

    const created: Array<[string, boolean]> = [];
    render(
      <AlephaContext.Provider value={alepha}>
        <ArtifactNewCopyDialog
          open
          onOpenChange={() => {}}
          detail={detail}
          variant={variant}
          onCreated={(env, deployed) => created.push([env, deployed])}
        />
      </AlephaContext.Provider>,
    );

    return { links, created };
  };

  const openEstates = async () => {
    await waitFor(() => {
      const trigger = document.querySelector("button[role=combobox]");
      if (!trigger) throw new Error("no estate picker yet");
      fireEvent.click(trigger);
      if (!document.querySelector("[role=option]")) {
        throw new Error("the estate list did not open");
      }
    });
  };

  const fill = async () => {
    const env = document.querySelector<HTMLInputElement>(
      "[data-testid=artifact-new-copy] input[type=text], [data-testid=artifact-new-copy] input:not([type])",
    );
    fireEvent.change(env as HTMLInputElement, { target: { value: "Staging" } });
    await openEstates();
    fireEvent.click(
      [...document.querySelectorAll("[role=option]")].find((it) =>
        it.textContent?.includes("cf-feunard"),
      ) as Element,
    );
  };

  const submit = () =>
    fireEvent.submit(
      document.querySelector("[data-testid=artifact-new-copy]") as Element,
    );

  it("offers only the estates that can run this build", async ({ expect }) => {
    await mount();

    await openEstates();

    const options = [...document.querySelectorAll("[role=option]")].map(
      (it) => it.textContent,
    );
    expect(options).toContain("cf-feunard");
    expect(options).not.toContain("ovh");
  });

  it("creates the copy under the build's app, then its estate, then deploys", async ({
    expect,
  }) => {
    const { links, created } = await mount();
    await fill();

    submit();

    await waitFor(() => expect(created).toEqual([["staging", true]]));
    expect(links.calls.filter((it) => it !== "listProjectEstates")).toEqual([
      "createApp",
      "updateApp",
      "startDeploy",
    ]);
    expect(links.bodies.createApp).toMatchObject({
      app: "docs",
      env: "staging",
    });
    expect(links.bodies.updateApp).toEqual({ estateId: ESTATE_ID });
    expect(links.bodies.startDeploy).toEqual({ tag: "1.0.0" });
  });

  it("stops at a refused create, with the reason in the dialog", async ({
    expect,
  }) => {
    const { links, created } = await mount({
      createApp: new Error("That copy already exists."),
    });
    await fill();

    submit();

    await waitFor(() =>
      expect(document.body.textContent).toContain("already exists"),
    );
    expect(links.calls).not.toContain("startDeploy");
    expect(created).toEqual([]);
  });

  it("still lands on the copy when its first deploy is refused", async ({
    expect,
  }) => {
    const { created } = await mount({
      startDeploy: new Error("A secret is missing."),
    });
    await fill();

    submit();

    await waitFor(() => expect(created).toEqual([["staging", true]]));
  });
});
