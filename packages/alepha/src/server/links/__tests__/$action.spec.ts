import { Alepha } from "alepha";
import { ServerProvider } from "alepha/server";
import { afterEach, describe, expect, it } from "vitest";

import {
  $client,
  $remote,
  AlephaServerLinks,
  type HttpVirtualClient,
} from "../index.ts";
import { CrudApp } from "./fixtures/CrudApp.ts";

const ctx = Alepha.create({
  env: {},
}).with(AlephaServerLinks);

const app = ctx.inject(CrudApp);
const linkLocal = ctx.inject(
  class Client {
    client = $client<CrudApp>();
  },
).client;

const linkRemote = Alepha.create()
  .with(AlephaServerLinks)
  .inject(
    class Client {
      client = $client<CrudApp>();
      app = $remote({
        url: () => ctx.inject(ServerProvider).hostname,
      });
    },
  ).client;

afterEach(() => {
  app.clear();
});

describe("$action", () => {
  const testActionBasicCrud = async (
    app: CrudApp | HttpVirtualClient<CrudApp>,
  ) => {
    expect(await app.findAll.run({})).toEqual([]);
    expect(await app.findAll.run({})).toEqual([]);

    expect(await app.create.run({ body: { name: "John" } })).toEqual({
      id: 1,
      name: "John",
    });

    expect(await app.create.run({ body: { name: "Jean" } })).toEqual({
      id: 2,
      name: "Jean",
    });

    expect(await app.findAll.run({})).toEqual([
      {
        id: 1,
        name: "John",
      },
      {
        id: 2,
        name: "Jean",
      },
    ]);

    expect(
      await app.findAll.run({
        query: { name: "John" },
      }),
    ).toEqual([
      {
        id: 1,
        name: "John",
      },
    ]);

    expect(
      await app.findAll.run({
        query: { name: "J" },
      }),
    ).toEqual([
      {
        id: 1,
        name: "John",
      },
      {
        id: 2,
        name: "Jean",
      },
    ]);

    expect(await app.findAll.run({})).toEqual([
      {
        id: 1,
        name: "John",
      },
      {
        id: 2,
        name: "Jean",
      },
    ]);

    expect(await app.findById.run({ params: { id: 1 } })).toEqual({
      id: 1,
      name: "John",
    });

    expect(await app.findById.run({ params: { id: 2 } })).toEqual({
      id: 2,
      name: "Jean",
    });

    expect(
      await app.update.run({ params: { id: 1 }, body: { name: "John Doe" } }),
    ).toEqual({
      id: 1,
      name: "John Doe",
    });

    expect(await app.findById.run({ params: { id: 1 } })).toEqual({
      id: 1,
      name: "John Doe",
    });

    expect(
      await app.update.run({ params: { id: 1 }, body: { name: "Rasmus" } }),
    ).toEqual({
      id: 1,
      name: "Rasmus",
    });

    expect(await app.findById.run({ params: { id: 1 } })).toEqual({
      id: 1,
      name: "Rasmus",
    });

    expect(await app.delete.run({ params: { id: 1 } })).toEqual(undefined);

    expect(await app.findAll.run({})).toEqual([
      {
        id: 2,
        name: "Jean",
      },
    ]);
  };

  it("should handle basic crud operations (app)", async () => {
    await testActionBasicCrud(app);
  });

  it("should handle basic crud operations (linkLocal)", async () => {
    await testActionBasicCrud(linkLocal);
  });

  it("should handle basic crud operations (linkRemote)", async () => {
    await testActionBasicCrud(linkRemote);
  });

  const testActionHeader = async (
    app: CrudApp | HttpVirtualClient<CrudApp>,
  ) => {
    expect(await app.findAll.run({})).toEqual([]);
    expect(await app.create.run({ body: { name: "Jean" } })).toEqual({
      id: 1,
      name: "Jean",
    });

    expect(
      await app.findById.run({
        params: { id: 1 },
        headers: { uppercase: true },
      }),
    ).toEqual({
      id: 1,
      name: "JEAN",
    });

    expect(
      await app.findById.run({
        params: { id: 1 },
        headers: { uppercase: true },
      }),
    ).toEqual({
      id: 1,
      name: "JEAN",
    });

    expect(
      await app.findById.run({
        params: { id: 1 },
        headers: { uppercase: true },
      }),
    ).toEqual({
      id: 1,
      name: "JEAN",
    });
  };

  it("should handle headers transformation (app)", async () => {
    await testActionHeader(app);
  });

  it("should handle headers transformation (linkLocal)", async () => {
    await testActionHeader(linkLocal);
  });

  it("should handle headers transformation (linkRemote)", async () => {
    await testActionHeader(linkRemote);
  });

  const testActionErrors = async (
    app: CrudApp | HttpVirtualClient<CrudApp>,
  ) => {
    await expect(app.findById.run({ params: { id: 2 } })).rejects.toThrowError(
      "User not found",
    );

    // as local function, we go the real error
    // as remove function, we go the http error wrapper
    await expect(app.internalError.run({})).rejects.toThrowError("Oops");
  };

  it("should handle errors properly (app)", async () => {
    await testActionErrors(app);
  });

  it("should handle errors properly (linkLocal)", async () => {
    await testActionErrors(linkLocal);
  });

  it("should handle errors properly (linkRemote)", async () => {
    await testActionErrors(linkRemote);
  });

  // TODO - with security (on/off) + forward

  // TODO - body parser (multipart)
});
