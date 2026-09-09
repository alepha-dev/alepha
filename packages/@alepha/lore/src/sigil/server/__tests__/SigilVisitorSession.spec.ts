import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import { SigilProxyController } from "../SigilProxyController.ts";
import { SigilSinkProvider } from "../SigilSinkProvider.ts";

class FakeSink extends SigilSinkProvider {
  public ingested: Array<{ env: any; stamp: any }> = [];

  override async ingest(env: any, stamp: any = {}) {
    this.ingested.push({ env, stamp });
  }
}

/**
 * One request, with control over the two things that decide the identity: who
 * is signed in, and where they are coming from.
 *
 * ⚠️ **The handler is called directly, not through `ingest.run()`.**
 * `ActionPrimitive.run` builds its own `serverActionRequest` from `body`,
 * `params`, `query` and `headers` and carries no `user` - the option it does
 * take puts one in `currentUserAtom`, not on the request. Only a real HTTP
 * request has `request.user`, set by `ServerSecurityProvider`'s
 * `server:onRequest` hook, which runs at `priority: "last"` and resolves the
 * user for EVERY route, secured or not. This endpoint is reached by an actual
 * `fetch` from the browser, so `request.user` is the right thing for it to
 * read; driving it through `run()` would test a path production never takes.
 */
const stampFor = async (request: {
  user?: { id: string };
  ip?: string;
  ua?: string;
  host?: string;
}) => {
  const alepha = Alepha.create({
    env: {
      NODE_ENV: "production",
      APP_SECRET: "test-secret",
      SERVER_PORT: 0,
      SIGIL_SALT: "salt",
    },
  }).with({ provide: SigilSinkProvider, use: FakeSink });
  const ctrl = alepha.inject(SigilProxyController);
  const sink = alepha.inject(SigilSinkProvider) as FakeSink;
  await alepha.start();

  await ctrl.ingest.options.handler({
    body: { views: [{ path: "/" }] },
    user: request.user,
    headers: {
      host: request.host ?? "app.example.com",
      "cf-connecting-ip": request.ip ?? "1.2.3.4",
      "user-agent": request.ua ?? "UA",
    },
  } as any);

  return sink.ingested[0].stamp;
};

/**
 * The visitor identity, when there is a session to read.
 *
 * The hash used to close over `host : ip : user-agent : dailySalt`, and that
 * model cannot tell twenty people in one office apart, nor recognise one
 * person whose phone changed address at lunchtime. The session can, and it is
 * already on the request: `alepha/server/auth` promotes the session cookie
 * into an `Authorization` header, and `ServerSecurityProvider` resolves the
 * user for every route.
 *
 * ⚠️ What did NOT change is as load-bearing as what did: still host-salted,
 * still daily-rotating, still one-way. Only the SUBJECT of the hash moved.
 */
describe("the visitor hash reads the session", () => {
  it("survives a change of address, which an IP hash cannot", async () => {
    // The phone that moves from wifi to cellular mid-day. Two visitors under
    // the old model; one person, which is the true answer.
    const home = await stampFor({ user: { id: "u-1" }, ip: "1.2.3.4" });
    const away = await stampFor({ user: { id: "u-1" }, ip: "9.9.9.9" });

    expect(home.visitor).toBe(away.visitor);
  });

  it("survives a change of user-agent for the same person", async () => {
    // Same account, laptop and phone, both signed in. One visitor.
    const laptop = await stampFor({ user: { id: "u-1" }, ua: "Chrome/1" });
    const phone = await stampFor({ user: { id: "u-1" }, ua: "Safari/2" });

    expect(laptop.visitor).toBe(phone.visitor);
  });

  it("tells two people behind one address and one browser apart", async () => {
    // The office, or the NAT. Identical on every input the old hash read, so
    // it counted them as one visitor.
    const ada = await stampFor({ user: { id: "u-1" }, ip: "1.2.3.4" });
    const grace = await stampFor({ user: { id: "u-2" }, ip: "1.2.3.4" });

    expect(ada.visitor).not.toBe(grace.visitor);
  });

  it("leaves the anonymous path exactly as it was", async () => {
    // No session, so the subject is still the address and the user-agent, and
    // the two properties that gave are unchanged: same inputs, same hash;
    // different address, different hash.
    const first = await stampFor({ ip: "1.2.3.4", ua: "UA" });
    const same = await stampFor({ ip: "1.2.3.4", ua: "UA" });
    const other = await stampFor({ ip: "5.6.7.8", ua: "UA" });

    expect(first.visitor).toBe(same.visitor);
    expect(first.visitor).not.toBe(other.visitor);
  });

  it("keeps two apps behind one sink uncorrelated, session or not", async () => {
    // The host salt, which the session must not have weakened: the same
    // signed-in person on two apps is two visitors to the sink, and neither
    // app can be told it is the same person.
    const here = await stampFor({ user: { id: "u-1" }, host: "a.example.com" });
    const there = await stampFor({
      user: { id: "u-1" },
      host: "b.example.com",
    });

    expect(here.visitor).not.toBe(there.visitor);
  });

  it("never puts the user id on the wire", async () => {
    const stamp = await stampFor({ user: { id: "u-secret-uuid" } });

    // The hash goes out; the identity it was built from does not, and cannot
    // be recovered from it any more than an IP could.
    expect(JSON.stringify(stamp)).not.toContain("u-secret-uuid");
    expect(stamp.visitor).not.toContain("u-secret-uuid");
  });
});

/**
 * The `auth` dimension: derived from the same session, stamped separately.
 */
describe("the auth stamp", () => {
  it("says user when a session is on the request", async () => {
    expect((await stampFor({ user: { id: "u-1" } })).auth).toBe("user");
  });

  it("says anon when there is none", async () => {
    // Which is also what an app holding its token in memory reports, on every
    // request, correctly: the browser's same-origin `fetch` carries cookies
    // and no `Authorization` header, so there is no session here to read.
    expect((await stampFor({})).auth).toBe("anon");
  });

  it("is stamped even though the visitor hash already closes over it", async () => {
    // Redundant by construction and sent anyway. A hash is opaque, so nothing
    // downstream could perform the derivation - leaving the field out because
    // something else implies it is how redundancy becomes load-bearing.
    const stamp = await stampFor({ user: { id: "u-1" } });

    expect(stamp.visitor).toBeTruthy();
    expect(stamp.auth).toBe("user");
  });
});
