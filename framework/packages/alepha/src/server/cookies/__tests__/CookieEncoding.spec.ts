import { createCipheriv, randomBytes } from "node:crypto";
import { deflateRawSync } from "node:zlib";

import { Alepha, z } from "alepha";
import { $action, AlephaServer, ServerProvider } from "alepha/server";
import { describe, it } from "vitest";

import { $cookie, AlephaServerCookies } from "../index.ts";
import { ServerCookiesProvider } from "../providers/ServerCookiesProvider.ts";

/**
 * Writes what the provider wrote before #Q2950: standard base64 for the deflate
 * output and for the AES-GCM payload.
 */
class LegacyCookiesProvider extends ServerCookiesProvider {
  public legacyValue(data: { data: string }): string {
    const compressed = deflateRawSync(JSON.stringify(data)).toString("base64");
    const iv = randomBytes(this.IV_LENGTH);
    const cipher = createCipheriv(this.ALGORITHM, this.deriveKey(), iv);
    const encrypted = Buffer.concat([
      cipher.update(compressed, "utf8"),
      cipher.final(),
    ]);
    return encodeURIComponent(
      Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64"),
    );
  }
}

class EncodingApp {
  sealed = $cookie({
    name: "sealed",
    schema: z.object({ data: z.text({ size: "rich" }) }),
    compress: true,
    encrypt: true,
  });

  write = $action({
    path: "/write",
    method: "POST",
    schema: { body: z.object({ data: z.text({ size: "rich" }) }) },
    handler: ({ body }) => {
      this.sealed.set(body);
    },
  });

  read = $action({
    path: "/read",
    method: "GET",
    schema: {
      response: z.object({ data: z.text({ size: "rich" }).optional() }),
    },
    handler: ({ cookies }) => ({ data: this.sealed.get({ cookies })?.data }),
  });
}

const boot = async () => {
  const alepha = Alepha.create()
    .with({ provide: ServerCookiesProvider, use: LegacyCookiesProvider })
    .with(AlephaServer)
    .with(AlephaServerCookies)
    .with(EncodingApp);
  await alepha.start();

  const hostname = alepha.inject(ServerProvider).hostname;

  const write = async (data: string, cookie = "") => {
    const response = await fetch(`${hostname}/api/write`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ data }),
    });
    return response.headers.getSetCookie();
  };

  const read = async (cookie: string) => {
    const response = await fetch(`${hostname}/api/read`, {
      headers: { cookie },
    });
    return {
      data: ((await response.json()) as { data?: string }).data,
      setCookie: response.headers.getSetCookie(),
    };
  };

  return {
    legacy: alepha.inject(LegacyCookiesProvider),
    read,
    write,
  };
};

describe("server cookie encoding", () => {
  it("round-trips a compressed, encrypted value with no percent-encoded base64", async ({
    expect,
  }) => {
    const { read, write } = await boot();
    const data = randomBytes(600).toString("hex");

    const [header] = await write(data);

    // Base64 would leave `+`, `/` and `=` for encodeURIComponent to triple.
    const value = header.split(";")[0].slice("app.sealed=".length);
    expect(value).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(header).not.toMatch(/%2B|%2F|%3D/i);
    expect((await read(`app.sealed=${value}`)).data).toBe(data);
  });

  /**
   * `Buffer` decodes both alphabets whichever one it is told (Node, Bun and
   * workerd alike), so #Q2950's expected one-time logout does not happen: a
   * cookie from before the switch stays readable, and the next write replaces it.
   */
  it("still reads a cookie written as base64", async ({ expect }) => {
    const { legacy, read, write } = await boot();
    const data = randomBytes(300).toString("hex");
    const legacyValue = legacy.legacyValue({ data });
    expect(legacyValue).toMatch(/%2B|%2F|%3D/i);

    const cookie = `app.sealed=${legacyValue}`;
    const seen = await read(cookie);

    expect(seen.data).toBe(data);
    expect(seen.setCookie).toEqual([]);

    const [rewritten] = await write(data, cookie);
    expect(rewritten).not.toMatch(/%2B|%2F|%3D/i);
  });
});
