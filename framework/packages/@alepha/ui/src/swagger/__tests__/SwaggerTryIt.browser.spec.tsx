import { act, fireEvent, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import type { OpenApiDocument } from "alepha/server/swagger";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { OpenApiSpec } from "../OpenApiSpec.ts";
import { SwaggerTryIt } from "../SwaggerTryIt.tsx";

const document: OpenApiDocument = {
  openapi: "3.0.0",
  info: { title: "Shop", version: "1.0.0" },
  paths: {
    "/api/ping": {
      get: { operationId: "ping", responses: { "200": { description: "OK" } } },
    },
    "/api/upload": {
      post: {
        operationId: "upload",
        requestBody: {
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                properties: {
                  label: { type: "string" },
                  file: { type: "string", format: "binary" },
                },
              },
            },
          },
        },
        responses: { "200": { description: "OK" } },
      },
    },
    "/api/orders": {
      post: {
        operationId: "create",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { note: { type: "string" } },
              },
            },
          },
        },
        responses: { "200": { description: "OK" } },
      },
    },
  },
};

describe("SwaggerTryIt", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await alepha?.stop();
    alepha = undefined;
  });

  const spec = new OpenApiSpec(document);

  const mount = async (id: string) => {
    alepha = Alepha.create().with(AlephaReactI18n);
    await alepha.start();
    const errors: Array<{ error: Error; handled?: boolean }> = [];
    alepha.events.on("react:action:error", (event) => {
      errors.push(event);
    });
    const view = render(
      <AlephaContext.Provider value={alepha}>
        <SwaggerTryIt spec={spec} entry={spec.find(id)!} />
      </AlephaContext.Provider>,
    );
    return { view, errors };
  };

  const send = async () => {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });
  };

  it("offers no Form/JSON switch for a multipart body", async () => {
    await mount("upload");
    expect(screen.queryByText("JSON")).toBeNull();
  });

  it("still offers the switch for a JSON object body", async () => {
    await mount("create");
    expect(screen.getByText("JSON")).toBeTruthy();
  });

  it("reports no error for a request it aborted itself", async () => {
    vi.stubGlobal(
      "fetch",
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted", "AbortError")),
          );
        }),
    );
    const { view, errors } = await mount("ping");
    await send();
    await act(async () => {
      view.unmount();
    });
    // The handler settles after the unmount: give its rejection a turn.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(errors).toEqual([]);
  });

  it("clears the previous response when a new send starts", async () => {
    vi.stubGlobal("fetch", async () => new Response("first", { status: 200 }));
    const { view } = await mount("ping");
    await send();
    await vi.waitFor(() =>
      expect(view.container.textContent).toContain("first"),
    );

    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    await send();
    await vi.waitFor(() =>
      expect(view.container.textContent).not.toContain("first"),
    );
  });
});
