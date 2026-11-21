import { inspect } from "node:util";

import { Alepha, AlephaError } from "alepha";
import { describe, expect, it } from "vitest";

import {
  CliFormatterProvider,
  JsonFormatterProvider,
  LogDestinationProvider,
  LogFormatterProvider,
  MemoryDestinationProvider,
  PrettyFormatterProvider,
  RawFormatterProvider,
} from "../index.ts";
import { Logger } from "../services/Logger.ts";
import { mainBaseline } from "./redaction-differential.baseline.ts";

/**
 * What this spec holds the redaction walk to: a payload hiding a marker
 * under a secret key prints that marker in no sink where origin/main did not
 * already print it. The expectation per payload is main's own answer,
 * recorded in `redaction-differential.baseline.ts`.
 *
 * Each payload is logged as the data, under a key, in an array and under
 * `error`, through the four formatters. The three sinks read are the
 * formatted line, `entry.data` as JSON writes it, and `entry.data` as
 * `util.inspect` shows it with hidden fields.
 */
const M = "MARKER-SECRET";

class Account {
  public id = "acc-1";
  public password = M;
}
class PrimOnly {
  public id = 1;
  public apiKey = M;
}
class ErrField extends Error {
  public password = M;
}
class ErrObj extends Error {
  public request = { headers: { authorization: M } };
}
class ErrGetter extends Error {
  public meta = { a: 1 };
  get token() {
    return M;
  }
}
class ErrToJson extends Error {
  public meta = { a: 1 };
  toJSON() {
    return { fabricated: M, password: M };
  }
}
class ErrToJsonNoFields extends Error {
  toJSON() {
    return { fabricated: M, password: M };
  }
}
class ErrPrivate extends Error {
  #x = 1;
  public meta = { a: 1 };
  toJSON() {
    return { x: this.#x };
  }
}
class ErrPrivName extends Error {
  #n = "PrivName";
  public meta = { a: 1 };
  get name() {
    return this.#n;
  }
}
class DateFields extends Date {
  public password = M;
}
class DateToJson extends Date {
  toJSON() {
    return { password: M, fabricated: M } as any;
  }
}
class ProtoToJson {
  public id = 1;
  toJSON() {
    return { id: 1, password: M };
  }
}
class ToStringArr {
  public password = M;
  toJSON() {
    return ["user", this.password];
  }
}
class ToRekey {
  public password = M;
  toJSON() {
    return { pw: this.password };
  }
}

const nonEnum = (o: object, k: string, v: unknown) => {
  Object.defineProperty(o, k, { value: v, enumerable: false });
  return o;
};

const chainOf = (n: number, leaf: unknown) => {
  let d: any = leaf;
  for (let i = 0; i < n; i++) d = { next: d };
  return d;
};

const wide = (n: number, tail: Record<string, unknown>) => {
  const o: Record<string, unknown> = {};
  for (let i = 0; i < n; i++) o[`k${i}`] = i;
  o.nest = {}; // defeats the flat path
  Object.assign(o, tail);
  return o;
};

const payloads: Record<string, () => unknown> = {
  "Error enumerable secret field": () => new ErrField("m"),
  "Error object field with secret": () => new ErrObj("m"),
  "Error NON-enumerable secret field": () =>
    nonEnum(new Error("m"), "password", M),
  "Error NON-enumerable secret field + object field": () =>
    nonEnum(Object.assign(new Error("m"), { meta: { a: 1 } }), "password", M),
  "Error cause depth 3 secret": () =>
    new Error("a", {
      cause: new Error("b", {
        cause: new Error("c", { cause: new ErrField("d") }),
      }),
    }),
  "Error cause plain object secret": () =>
    new Error("a", { cause: { password: M } }),
  "AggregateError.errors secret": () =>
    new AggregateError([new ErrField("in"), { password: M }], "agg"),
  "AggregateError.errors secret + object field": () =>
    Object.assign(new AggregateError([new ErrField("in")], "agg"), {
      meta: { a: 1 },
    }),
  "Error subclass proto getter secret": () => new ErrGetter("m"),
  "Error with proto toJSON (object field)": () => new ErrToJson("m"),
  "Error with proto toJSON (no fields)": () => new ErrToJsonNoFields("m"),
  "Error with OWN toJSON": () =>
    Object.assign(new Error("m"), { toJSON: () => ({ fabricated: M }) }),
  "Error private field + toJSON": () => new ErrPrivate("m"),
  "Error private name getter": () => new ErrPrivName("m"),
  "DOMException with object cause": () =>
    new DOMException("m", {
      name: "AbortError",
      cause: { a: 1 },
      // The options form is Node's, absent from the DOM typings.
    } as unknown as string),
  "AlephaError declared-like data secret": () =>
    Object.assign(new AlephaError("m"), { data: { token: M } }),
  "Date subclass with secret field": () => new DateFields(0),
  "Date subclass toJSON fabricates": () => new DateToJson(0),
  "flat object with fickle getter": () => {
    let n = 0;
    return {
      a: 1,
      get later() {
        return n++ === 0 ? "ok" : { password: M };
      },
    };
  },
  "Proxy of flat object answering secret later": () => {
    let n = 0;
    return new Proxy({ a: 1 } as Record<string, unknown>, {
      get(t, k, r) {
        if (k === "a") return n++ === 0 ? 1 : M;
        return Reflect.get(t, k, r);
      },
    });
  },
  "Proxy with secret key": () => new Proxy({ password: M, a: 1 }, {}),
  "proto toJSON instance": () => new ProtoToJson(),
  "instance primitive fields secret-named": () => new PrimOnly(),
  "null-proto with secret": () =>
    Object.assign(Object.create(null), { password: M, a: 1 }),
  "flat with non-enumerable secret": () => nonEnum({ a: 1 }, "password", M),
  "toJSON returns [user, password]": () => new ToStringArr(),
  "toJSON rekeys password as pw": () => new ToRekey(),
  "Map object keys": () => new Map([[{ password: M }, { token: M }]]),
  "Map secret key nested value": () =>
    new Map([["authorization", { deep: [M] }]]),
  "Map keyed BY the secret": () => new Map([[M, { user: 1 }]]),
  "Map value secret under plain key": () => new Map([["k", M]]),
  "Set of instances": () => new Set([new Account(), new PrimOnly()]),
  "Set of raw secret strings": () => new Set([M]),
  "Headers mixed case": () => {
    const h = new Headers();
    h.set("Authorization", M);
    h.set("COOKIE", M);
    h.append("Set-Cookie", M);
    h.append("Set-Cookie", `${M}2`);
    h.set("X-Api-Key", M);
    h.set("X-Other", "fine");
    return h;
  },
  "Headers non-listed credential header": () =>
    new Headers({ "x-auth": M, "x-csrf": M }),
  "URLSearchParams token": () => new URLSearchParams(`token=${M}&a=1`),
  "URLSearchParams code=": () => new URLSearchParams(`code=${M}&a=1`),
  "URL with token in query": () => new URL(`https://e.test/cb?token=${M}`),
  "URL with userinfo password": () => new URL(`https://u:${M}@e.test/`),
  "FormData with File": () => {
    const f = new FormData();
    f.set("password", M);
    f.set("file", new File([M], "a.txt"));
    return f;
  },
  "Uint8Array of secret bytes under secret key": () => ({
    token: new TextEncoder().encode(M),
  }),
  "Buffer under secret key": () => ({ secret: Buffer.from(M) }),
  "top-level array": () => [{ password: M }, [new Account()]],
  "depth 99 instance": () => chainOf(98, new Account()),
  "depth 100 instance": () => chainOf(99, new Account()),
  "depth 101 instance": () => chainOf(100, new Account()),
  "depth 99 Map": () => chainOf(98, new Map([["token", M]])),
  "depth 100 Map": () => chainOf(99, new Map([["token", M]])),
  "depth 100 Error": () => chainOf(99, new ErrField("m")),
  "depth 101 Error": () => chainOf(100, new ErrField("m")),
  "depth 100 toJSON": () => chainOf(99, new ProtoToJson()),
  "depth 100 Date subclass": () => chainOf(100, new DateFields(0)),
  "cycle through Map": () => {
    const m = new Map<string, unknown>();
    const o = { m, password: M };
    m.set("o", o);
    return o;
  },
  "cycle through Error cause": () => {
    const e: any = new ErrField("m");
    e.cause = { e, token: M };
    return e;
  },
  "cycle through toJSON": () => {
    const o: any = { password: M };
    o.j = { toJSON: () => o };
    return o;
  },
};

for (const k of [9995, 9996, 9997, 9998, 9999, 10000, 10001, 10002]) {
  payloads[`budget wide ${k} then password`] = () => wide(k, { password: M });
  payloads[`budget wide ${k} then {password}`] = () =>
    wide(k, { inner: { password: M } });
  payloads[`budget wide ${k} then Error field`] = () =>
    wide(k, { err: new ErrField("m") });
  payloads[`budget wide ${k} then Error cause`] = () =>
    wide(k, { err: new Error("x", { cause: new Account() }) });
  payloads[`budget wide ${k} then Map`] = () =>
    wide(k, { map: new Map([["token", M]]) });
  payloads[`budget wide ${k} then Set`] = () =>
    wide(k, { set: new Set([new Account()]) });
  payloads[`budget wide ${k} then toJSON`] = () =>
    wide(k, { j: new ProtoToJson() });
  payloads[`budget array ${k} then account`] = () => [
    ...Array.from({ length: k }, (_, i) => i),
    new Account(),
  ];
}

const formatters = {
  json: JsonFormatterProvider,
  pretty: PrettyFormatterProvider,
  cli: CliFormatterProvider,
  raw: RawFormatterProvider,
};

const shapes: Record<string, (value: unknown) => unknown> = {
  top: (value) => value,
  nested: (value) => ({ held: value }),
  listed: (value) => ({ list: [value] }),
  underError: (value) => ({ error: value }),
};

const baselineOf = (name: string) => {
  const allowed = new Map<string, string>();
  for (const cell of (mainBaseline[name] ?? "").split(" ").filter(Boolean)) {
    const [where, sinks] = cell.split(":");
    allowed.set(where, sinks);
  }
  return allowed;
};

const holds = (read: () => string) => {
  try {
    return read().includes(M);
  } catch {
    return false;
  }
};

describe("Logger: redaction prints a secret nowhere origin/main did not", () => {
  it.each(Object.keys(payloads))("%s", (name) => {
    const build = payloads[name];
    const allowed = baselineOf(name);
    const more: string[] = [];

    for (const [format, formatter] of Object.entries(formatters)) {
      for (const [shape, wrap] of Object.entries(shapes)) {
        const alepha = Alepha.create({
          env: { LOG_LEVEL: "trace", NO_COLOR: "true" },
        })
          .with({
            provide: LogDestinationProvider,
            use: MemoryDestinationProvider,
          })
          .with({ provide: LogFormatterProvider, use: formatter });
        const logger = alepha.inject(Logger, {
          lifetime: "transient",
          args: ["TestService", "test.module"],
        });

        const where = `${format}/${shape}`;
        expect(
          () => logger.info("row", wrap(build()) as object),
          where,
        ).not.toThrow();

        const [entry] = alepha.inject(MemoryDestinationProvider).logs;
        const sinks = {
          f: holds(() => entry.formatted),
          j: holds(() => JSON.stringify(entry.data) ?? ""),
          i: holds(() =>
            inspect(entry.data, { depth: null, showHidden: true }),
          ),
        };
        for (const [sink, printed] of Object.entries(sinks)) {
          if (printed && !(allowed.get(where) ?? "").includes(sink)) {
            more.push(`${where}:${sink}`);
          }
        }
      }
    }

    expect(more).toEqual([]);
  });
});
