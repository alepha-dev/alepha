import { Alepha, z } from "alepha";
import {
  $secure,
  AlephaSecurity,
  JwtProvider,
  SecurityProvider,
  type ServiceAccountPrimitive,
} from "alepha/security";
import { $action, ServerProvider } from "alepha/server";
import { describe, it } from "vitest";

import { $client, $remote, AlephaServerLinks, LinkProvider } from "../index.ts";

/**
 * A service whose one action is behind `$secure` and answers with the
 * subject it authenticated.
 */
class Vault {
  sealed = $action({
    path: "/sealed",
    method: "GET",
    use: [$secure()],
    schema: { response: z.text() },
    handler: ({ user }) => `opened by ${user.id}`,
  });
}

const env = { LOG_LEVEL: "error" as const };

/**
 * The vault, and a way to mint the access tokens it accepts.
 */
const serveVault = async () => {
  const alepha = Alepha.create({ env })
    .with(AlephaServerLinks)
    .with(AlephaSecurity)
    .with(Vault);
  await alepha.start();

  const jwt = alepha.inject(JwtProvider);
  const realm = alepha.inject(SecurityProvider).getRealms()[0]?.name;
  const tokenFor = (sub: string) =>
    jwt.create({ sub, roles: [] }, realm, {
      header: { typ: jwt.accessTokenTyp },
    });

  return { url: alepha.inject(ServerProvider).hostname, tokenFor };
};

/**
 * A service account as `$serviceAccount` builds one: `token()` answers the
 * bare access token.
 */
const accountOf = (token: string) => {
  const account: ServiceAccountPrimitive & { calls: number } = {
    calls: 0,
    token: async () => {
      account.calls++;
      return token;
    },
  };
  return account;
};

const serveFront = async (front: new () => object) => {
  const alepha = Alepha.create({ env }).with(AlephaServerLinks).with(front);
  await alepha.start();
  return alepha;
};

describe("$remote serviceAccount", () => {
  it("is the identity of a call server code makes with no incoming request", async ({
    expect,
  }) => {
    const vault = await serveVault();
    const account = accountOf(await vault.tokenFor("service"));
    class Front {
      vault = $remote({ url: vault.url, serviceAccount: account });
      api = $client<Vault>();
    }
    const front = await serveFront(Front);

    const answer = await front.context.run(() =>
      front.inject(Front).api.sealed(),
    );

    expect(answer).toBe("opened by service");
    // Once for the registry at start, once for the call.
    expect(account.calls).toBe(2);
  });

  it("is never used inside an incoming request: the call forwards what the caller has, even nothing", async ({
    expect,
  }) => {
    const vault = await serveVault();
    const account = accountOf(await vault.tokenFor("service"));
    class Front {
      vault = $remote({ url: vault.url, serviceAccount: account });
      api = $client<Vault>();
      // Public: anyone may call it.
      relay = $action({
        path: "/relay",
        method: "GET",
        schema: { response: z.text() },
        handler: () => this.api.sealed(),
      });
    }
    const front = await serveFront(Front);
    const relay = `${front.inject(ServerProvider).hostname}/api/relay`;
    const callsAtStart = account.calls;

    const anonymous = await fetch(relay);
    // Authenticated some other way than an `Authorization` header: still
    // not this server's identity to lend.
    const otherwise = await fetch(`${relay}?api_key=narrow-key`, {
      headers: { cookie: "session=someone" },
    });
    const caller = await fetch(relay, {
      headers: { authorization: `Bearer ${await vault.tokenFor("caller")}` },
    });

    expect(anonymous.status).toBe(401);
    expect(otherwise.status).toBe(401);
    expect(await caller.text()).toBe("opened by caller");
    expect(account.calls).toBe(callsAtStart);
  });

  it("sends a token that names its scheme as it is, and a bare one as a bearer", async ({
    expect,
  }) => {
    const links = Alepha.create().inject(LinkProvider);
    const sent = (token: string) =>
      links.serviceAuthorization({ token: async () => token });

    expect(await sent("abc.def.ghi")).toBe("Bearer abc.def.ghi");
    expect(await sent("Bearer abc.def.ghi")).toBe("Bearer abc.def.ghi");
    expect(await sent("Basic dXNlcjpwYXNz")).toBe("Basic dXNlcjpwYXNz");
    expect(await sent("DPoP abc.def.ghi")).toBe("DPoP abc.def.ghi");
  });

  // A guard, not a regression test: it passes before this account was ever
  // attached to a call.
  it("never travels with a call made on behalf of this server's caller", async ({
    expect,
  }) => {
    const vault = await serveVault();
    const account = accountOf(await vault.tokenFor("service"));
    class Front {
      vault = $remote({
        url: vault.url,
        proxy: true,
        serviceAccount: account,
      });
    }
    const front = await serveFront(Front);
    const host = front.inject(ServerProvider).hostname;

    const proxied = await fetch(`${host}/api/vault/sealed`);
    const batched = await fetch(`${host}/api/_batch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify([{ action: "sealed" }]),
    }).then((it) => it.json());

    expect(proxied.status).toBe(401);
    expect(batched[0].status).toBe(401);
    expect(batched[0].data).toBeUndefined();
  });
});
