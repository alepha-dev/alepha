import { Alepha, z } from "alepha";
import { MemoryTraceProvider, Tracer } from "alepha/tracing";
import { describe, it } from "vitest";

import {
  $entity,
  $repository,
  DatabaseProvider,
  db,
  sql,
} from "../core/index.ts";
import { AlephaOrmPostgres } from "../postgres/index.ts";

/**
 * One span per statement (#E86): the statement-level repository methods,
 * relational reads and raw `execute`, named `<verb> <table>`, inside a trace
 * only, and never with a bound value.
 */
describe("ORM tracing", () => {
  const people = $entity({
    name: "tracing_people",
    schema: z.object({
      id: db.primaryKey(z.integer()),
      name: z.text(),
    }),
  });

  class App {
    people = $repository(people);
  }

  const boot = async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    const app = alepha.inject(App);
    const traces = alepha.inject(MemoryTraceProvider);
    const tracer = alepha.inject(Tracer);
    await alepha.start();
    const inTrace = <R>(fn: () => Promise<R>) =>
      alepha.context.run(() => tracer.startRoot("test", {}, fn));
    return { alepha, app, traces, tracer, inTrace };
  };

  it("gives an action calling three queries three query children", async ({
    expect,
  }) => {
    const { app, traces, inTrace } = await boot();

    await inTrace(async () => {
      const created = await app.people.create({ name: "secret-name" });
      await app.people.findMany({ where: { name: { eq: "secret-name" } } });
      await app.people.updateById(created.id, { name: "other" });
    });

    const root = traces.find("test")!;
    const children = traces.children(root);
    expect(children.map((s) => s.name)).toEqual([
      "insert tracing_people",
      "select tracing_people",
      "update tracing_people",
    ]);
    const provider = app.people.provider;
    expect(children[1].attributes).toEqual({
      "db.system.name": provider.systemName,
      "db.collection.name": "tracing_people",
      "db.operation.name": "select",
    });

    // Never a bound value, never the where object.
    const values = traces
      .spans()
      .flatMap((s) => Object.values(s.attributes).map(String))
      .join(" ");
    expect(values).not.toContain("secret-name");
  });

  it("gives getById one span and paginate two", async ({ expect }) => {
    const { app, traces, inTrace } = await boot();
    const person = await app.people.create({ name: "a" });

    await inTrace(() => app.people.getById(person.id));
    const getById = traces.find("test")!;
    expect(traces.children(getById).map((s) => s.name)).toEqual([
      "select tracing_people",
    ]);

    traces.clear();
    await inTrace(() => app.people.paginate({}, {}, { count: true }));
    const paginate = traces.find("test")!;
    expect(traces.children(paginate).map((s) => s.name)).toEqual([
      "select tracing_people",
      "select tracing_people",
    ]);
  });

  it("spans a raw execute as query, without its SQL", async ({ expect }) => {
    const { alepha, traces, inTrace } = await boot();

    await inTrace(() =>
      alepha.inject(DatabaseProvider).execute(sql`select ${"secret"} as v`),
    );

    const [query] = traces.children(traces.find("test")!);
    expect(query.name).toBe("query");
    expect(Object.values(query.attributes)).not.toContain("secret");
  });

  it("records nothing outside a trace", async ({ expect }) => {
    const { app, traces } = await boot();

    await app.people.create({ name: "a" });
    await app.people.findMany();

    expect(traces.spans()).toEqual([]);
  });

  it("makes a statement inside transaction() a child of the span that opened it", async ({
    expect,
  }) => {
    const { app, traces, tracer, inTrace } = await boot();

    await inTrace(() =>
      tracer.span("checkout", () =>
        app.people.transaction(async (tx) => {
          await app.people.create({ name: "a" }, { tx });
        }),
      ),
    );

    const checkout = traces.find("checkout")!;
    expect(traces.children(checkout).map((s) => s.name)).toContain(
      "insert tracing_people",
    );
  });
});
