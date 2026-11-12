import { describe, it } from "vitest";

import { CloudflareProvisionClient } from "../services/CloudflareProvisionClient.ts";

/**
 * Hyperdrive on every deploy (#Q3510): created and updated with caching
 * off, its origin PATCHed every time (Cloudflare never returns the password,
 * so a rotation cannot be detected), and a same-named config this copy never
 * recorded refused on a lent account.
 */
describe("CloudflareProvisionClient Hyperdrive", () => {
  const capture = (configs: Array<{ id: string; name: string }> = []) => {
    const calls: Array<{ method: string; path: string; body?: any }> = [];
    const original = globalThis.fetch;
    const ok = (result: unknown) =>
      new Response(JSON.stringify({ success: true, result, errors: [] }));
    const missing = () =>
      new Response(
        JSON.stringify({
          success: false,
          result: null,
          errors: [{ message: "not found" }],
        }),
        { status: 404 },
      );

    globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      const path = new URL(String(url)).pathname.replace(
        /^.*\/accounts\/acct-1/,
        "",
      );
      const body =
        typeof init.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ method, path, body });
      const one = /^\/hyperdrive\/configs\/([^/]+)$/.exec(path);
      if (one && method === "GET") {
        const found = configs.find((it) => it.id === one[1]);
        return found ? ok({ ...found, origin: { host: "h" } }) : missing();
      }
      if (one && method === "PATCH") {
        const found = configs.find((it) => it.id === one[1])!;
        return ok({ ...found, origin: { host: body.origin.host } });
      }
      if (path === "/hyperdrive/configs" && method === "GET") {
        return ok(configs.map((it) => ({ ...it, origin: { host: "h" } })));
      }
      if (path === "/hyperdrive/configs" && method === "POST") {
        return ok({ id: "created", name: body.name, origin: body.origin });
      }
      return missing();
    }) as typeof globalThis.fetch;

    const api = new CloudflareProvisionClient({
      apiToken: "test-token",
      accountId: "acct-1",
    });
    return { api, calls, restore: () => (globalThis.fetch = original) };
  };

  it("creates a config with caching off and the URL's sslmode", async ({
    expect,
  }) => {
    const { api, calls, restore } = capture();
    try {
      await api.ensureHyperdrive(
        "acme-app-production",
        "postgresql://app:pw%40one@db.example.app:6543/app?sslmode=verify-full",
      );
      const create = calls.find((it) => it.method === "POST")!;
      expect(create.body).toEqual({
        name: "acme-app-production",
        origin: {
          scheme: "postgres",
          host: "db.example.app",
          port: 6543,
          database: "app",
          user: "app",
          password: "pw@one",
        },
        caching: { disabled: true },
        mtls: { sslmode: "verify-full" },
      });
    } finally {
      restore();
    }
  });

  it("PATCHes the recorded config on every deploy, so a rotated password reaches Cloudflare", async ({
    expect,
  }) => {
    const { api, calls, restore } = capture([
      { id: "hd-1", name: "acme-app-production" },
    ]);
    try {
      const config = await api.ensureHyperdrive(
        "acme-app-production",
        "postgres://app:rotated@db.example.app/app",
        { knownId: "hd-1", adoptByName: false },
      );
      expect(config.id).toBe("hd-1");
      expect(calls.map((it) => `${it.method} ${it.path}`)).toEqual([
        "GET /hyperdrive/configs/hd-1",
        "PATCH /hyperdrive/configs/hd-1",
      ]);
      expect(calls[1]!.body.origin.password).toBe("rotated");
      expect(calls[1]!.body.caching).toEqual({ disabled: true });
      expect(calls[1]!.body.mtls).toBeUndefined();
    } finally {
      restore();
    }
  });

  it("refuses a same-named config it never recorded, on a lent account", async ({
    expect,
  }) => {
    const { api, calls, restore } = capture([
      { id: "someone-elses", name: "acme-app-production" },
    ]);
    try {
      await expect(
        api.ensureHyperdrive(
          "acme-app-production",
          "postgres://app:pw@db.example.app/app",
          { adoptByName: false },
        ),
      ).rejects.toThrow(/never recorded it: refusing to take it over/);
      expect(calls.some((it) => it.method === "PATCH")).toBe(false);
      expect(calls.some((it) => it.method === "POST")).toBe(false);
    } finally {
      restore();
    }
  });

  it("adopts and updates a same-named config on the CLI, the operator's own account", async ({
    expect,
  }) => {
    const { api, calls, restore } = capture([
      { id: "hd-cli", name: "acme-app-production" },
    ]);
    try {
      const config = await api.ensureHyperdrive(
        "acme-app-production",
        "postgres://app:new@db.example.app/app",
      );
      expect(config.id).toBe("hd-cli");
      expect(
        calls.find((it) => it.method === "PATCH")?.body.origin.password,
      ).toBe("new");
    } finally {
      restore();
    }
  });
});
