import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { ServerProvider } from "alepha/server";
import { describe, expect, it } from "vitest";

import { sigilNormalizeIp } from "../../shared/sigilNormalizeIp.ts";
import {
  sigilVisitorPeriod,
  sigilVisitorPeriodRotation,
} from "../../shared/sigilVisitorPeriod.ts";
import { SigilProxyController } from "../SigilProxyController.ts";
import { SigilSinkProvider } from "../SigilSinkProvider.ts";

class FakeSink extends SigilSinkProvider {
  public ingested: Array<{ env: any; stamp: any }> = [];

  override async ingest(env: any, stamp: any = {}) {
    this.ingested.push({ env, stamp });
  }
}

const boot = async (env: Record<string, any> = {}) => {
  const alepha = Alepha.create({
    env: {
      NODE_ENV: "production",
      APP_SECRET: "test-secret",
      SERVER_PORT: 0,
      SIGIL_SALT: "salt",
      ...env,
    },
  }).with({ provide: SigilSinkProvider, use: FakeSink });
  const ctrl = alepha.inject(SigilProxyController);
  const sink = alepha.inject(SigilSinkProvider) as FakeSink;
  const dateTime = alepha.inject(DateTimeProvider);
  await alepha.start();
  return { alepha, ctrl, sink, dateTime };
};

/**
 * The stamp of one request whose resolved address is `ip`, at `iso`.
 * Called through the handler with `request.ip` set, which is what the
 * framework hands it after resolving the proxy headers.
 */
const stampAt = async (
  iso: string,
  ip: string,
  env: Record<string, any> = {},
) => {
  const { ctrl, sink, dateTime } = await boot(env);
  await dateTime.travel(Date.parse(iso) - dateTime.nowMillis());
  await ctrl.ingest.options.handler({
    body: { views: [{ path: "/" }] },
    ip,
    headers: { host: "app.example.com", "user-agent": "UA" },
  } as any);
  return sink.ingested[0].stamp;
};

describe("sigilVisitorPeriod", () => {
  it("names the UTC month, ISO week or UTC day", () => {
    const at = Date.parse("2026-11-25T23:30:00Z");
    expect(sigilVisitorPeriod(at)).toBe("2026-11");
    expect(sigilVisitorPeriod(at, "month")).toBe("2026-11");
    expect(sigilVisitorPeriod(at, "week")).toBe("2026-W48");
    expect(sigilVisitorPeriod(at, "day")).toBe("2026-11-25");
  });

  it("gives an ISO week the year of its Thursday", () => {
    // Friday 2027-01-01 is in the last week of 2026; Monday 2024-12-30 in
    // the first of 2025.
    expect(sigilVisitorPeriod(Date.parse("2027-01-01T12:00:00Z"), "week")).toBe(
      "2026-W53",
    );
    expect(sigilVisitorPeriod(Date.parse("2024-12-30T12:00:00Z"), "week")).toBe(
      "2025-W01",
    );
  });

  it("recognises each shape and nothing else", () => {
    expect(sigilVisitorPeriodRotation("2026-11")).toBe("month");
    expect(sigilVisitorPeriodRotation("2026-W48")).toBe("week");
    expect(sigilVisitorPeriodRotation("2026-11-25")).toBe("day");
    expect(sigilVisitorPeriodRotation("2026-13")).toBeUndefined();
    expect(sigilVisitorPeriodRotation("2026-W60")).toBeUndefined();
    expect(sigilVisitorPeriodRotation("anything")).toBeUndefined();
  });
});

describe("sigilNormalizeIp", () => {
  it("keeps IPv4, reads a mapped IPv6 as IPv4, and cuts IPv6 to its /64", () => {
    expect(sigilNormalizeIp("1.2.3.4")).toBe("1.2.3.4");
    expect(sigilNormalizeIp("::ffff:1.2.3.4")).toBe("1.2.3.4");
    expect(sigilNormalizeIp("::FFFF:0102:0304")).toBe("1.2.3.4");
    expect(sigilNormalizeIp("2001:db8:0:1:aaaa:bbbb:cccc:dddd")).toBe(
      "2001:db8:0:1::/64",
    );
    expect(sigilNormalizeIp("[2001:0db8::1%eth0]")).toBe("2001:db8:0:0::/64");
  });
});

describe("the visitor hash per period", () => {
  it("defaults to a month: two days of one month give one hash, the next month another", async () => {
    const first = await stampAt("2026-11-02T10:00:00Z", "1.2.3.4");
    const later = await stampAt("2026-11-28T10:00:00Z", "1.2.3.4");
    const next = await stampAt("2026-12-01T10:00:00Z", "1.2.3.4");

    expect(first.visitorPeriod).toBe("2026-11");
    expect(next.visitorPeriod).toBe("2026-12");
    expect(first.visitor).toBe(later.visitor);
    expect(next.visitor).not.toBe(first.visitor);
  });

  it("rotates daily or weekly when SIGIL_SALT_ROTATION says so", async () => {
    const day = { SIGIL_SALT_ROTATION: "day" };
    const a = await stampAt("2026-11-02T10:00:00Z", "1.2.3.4", day);
    const b = await stampAt("2026-11-03T10:00:00Z", "1.2.3.4", day);
    expect(a.visitorPeriod).toBe("2026-11-02");
    expect(a.visitor).not.toBe(b.visitor);

    const week = { SIGIL_SALT_ROTATION: "week" };
    const monday = await stampAt("2026-11-23T10:00:00Z", "1.2.3.4", week);
    const sunday = await stampAt("2026-11-29T10:00:00Z", "1.2.3.4", week);
    expect(monday.visitorPeriod).toBe("2026-W48");
    expect(monday.visitor).toBe(sunday.visitor);
  });

  it("gives two IPv6 addresses of one /64 one hash", async () => {
    const a = await stampAt("2026-11-02T10:00:00Z", "2001:db8:0:1::aaaa");
    const b = await stampAt("2026-11-02T10:00:00Z", "2001:db8:0:1::bbbb");
    const other = await stampAt("2026-11-02T10:00:00Z", "2001:db8:0:2::aaaa");
    expect(a.visitor).toBe(b.visitor);
    expect(other.visitor).not.toBe(a.visitor);
  });

  it("hashes request.ip over HTTP: a hop the client types into x-forwarded-for changes nothing", async () => {
    const { alepha, sink } = await boot();
    const hostname = alepha.inject(ServerProvider).hostname;
    // The proxy in front appends the address it saw (1.2.3.4); whatever the
    // client put on the left is not the visitor.
    for (const spoofed of ["6.6.6.6", "7.7.7.7", "8.8.8.8, 9.9.9.9"]) {
      const response = await fetch(`${hostname}/api/sigil/ingest`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "UA",
          "x-forwarded-for": `${spoofed}, 1.2.3.4`,
        },
        body: JSON.stringify({ views: [{ path: "/" }] }),
      });
      expect(response.status).toBe(200);
    }
    const visitors = new Set(sink.ingested.map((it) => it.stamp.visitor));
    expect(sink.ingested).toHaveLength(3);
    expect(visitors.size).toBe(1);
    await alepha.stop();
  });
});

describe("the visitor's network", () => {
  const stampWith = async (geo: unknown) => {
    const { ctrl, sink } = await boot();
    await ctrl.ingest.options.handler({
      body: { views: [{ path: "/" }] },
      ip: "1.2.3.4",
      geo,
      headers: { host: "app.example.com", "user-agent": "UA" },
    } as any);
    return sink.ingested[0].stamp;
  };

  it("is stamped from request.geo.network when the platform gives it", async () => {
    const stamp = await stampWith({
      network: { number: 13335, name: "  Cloudflare, Inc.\u0007 " },
    });
    expect(stamp.network).toEqual({ number: 13335, name: "Cloudflare, Inc." });
  });

  it("is omitted elsewhere, and when the value is not a network", async () => {
    expect((await stampWith({})).network).toBeUndefined();
    expect(
      (await stampWith({ network: { number: -1, name: "x" } })).network,
    ).toBeUndefined();
  });
});
