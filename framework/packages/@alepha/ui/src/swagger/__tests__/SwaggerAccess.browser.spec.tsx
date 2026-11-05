import { render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { currentUserAtom } from "alepha/security";
import { LinkProvider } from "alepha/server/links";
import type { OpenApiDocument } from "alepha/server/swagger";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { OpenApiSpec } from "../OpenApiSpec.ts";
import { SwaggerAccessBadge } from "../SwaggerAccessBadge.tsx";
import { useSwaggerAccess } from "../useSwaggerAccess.ts";

const operation = (name: string, secured: boolean) => ({
  operationId: name,
  tags: ["orders"],
  responses: { "200": { description: "OK" } },
  "x-alepha-action": { name, group: "orders" },
  ...(secured
    ? {
        security: [{ bearerAuth: [] }],
        "x-alepha-security": { permissions: [`orders:${name}`] },
      }
    : {}),
});

const document: OpenApiDocument = {
  openapi: "3.0.0",
  info: { title: "Shop", version: "1.0.0" },
  paths: {
    "/api/orders": { get: operation("list", false) },
    "/api/orders/{id}": {
      put: operation("update", true),
      delete: operation("remove", true),
    },
  },
};

const spec = new OpenApiSpec(document);

/**
 * Renders each operation's access, the way the explorer's header does.
 */
const Probe = () => {
  const access = useSwaggerAccess(spec);
  return (
    <ul>
      {spec.entries.map((entry) => (
        <li key={entry.id} data-op={entry.id}>
          {access(entry)}
          <SwaggerAccessBadge access={access(entry)} signIn="/auth/login" />
        </li>
      ))}
    </ul>
  );
};

describe("useSwaggerAccess", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (options: { user?: boolean; links?: string[] }) => {
    alepha = Alepha.create().with(AlephaReactI18n);
    if (options.links) {
      alepha.with(LinkProvider);
    }
    await alepha.start();
    if (options.user) {
      alepha.store.set(currentUserAtom, {
        id: "u1",
        roles: ["user"],
      } as never);
    }
    if (options.links) {
      alepha.store.set("alepha.server.request.apiLinks", {
        actions: Object.fromEntries(
          options.links.map((name) => [name, { path: `/${name}` }]),
        ),
      } as never);
    }
    const view = render(
      <AlephaContext.Provider value={alepha}>
        <Probe />
      </AlephaContext.Provider>,
    );
    const of = (id: string) =>
      view.container.querySelector(`[data-op="${id}"]`)?.textContent ?? "";
    return { view, of };
  };

  it("says nothing about an open operation", async () => {
    const { of } = await mount({});
    expect(of("list")).toBe("open");
  });

  it("asks an anonymous viewer to sign in, with a link", async () => {
    const { of } = await mount({});
    expect(of("update")).toContain("anonymous");
    const link = screen.getAllByText("Sign in to call this")[0].closest("a");
    expect(link?.getAttribute("href")).toBe("/auth/login");
  });

  it("cannot tell without an action registry", async () => {
    const { of } = await mount({ user: true });
    expect(of("update")).toContain("unknown");
  });

  it("answers from the user's action registry", async () => {
    const { of } = await mount({ user: true, links: ["update"] });
    expect(of("update")).toContain("allowed");
    expect(of("update")).toContain("You can call this");
    expect(of("remove")).toContain("denied");
    expect(of("list")).toBe("open");
  });
});
