import { AlephaApiUsers, UserService } from "alepha/api/users";
import { afterEach, describe, it } from "vitest";

import { NotesApp, startFixture } from "./fixtures/mcpFixtureApp.ts";

describe("alepha mcp: action_call", () => {
  const stops: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const stop of stops.splice(0)) await stop();
  });

  const fixture = async () => {
    const f = await startFixture();
    stops.push(f.stop);
    return f;
  };

  it("runs an allowed call as a synthetic user with the action's roles", async ({
    expect,
  }) => {
    const { call, app } = await fixture();
    const note = await app.inject(NotesApp).repo.create({ title: "hello" });

    const text = await call("action_call", {
      action: "NotesApp.getNote",
      params: { id: note.id },
      as: { roles: ["admin"] },
    });
    expect(text).toMatch(/^200 in \d+ ms/);
    expect(text).toContain('"title": "hello"');
  });

  it("answers a $secure refusal with the status that user would get", async ({
    expect,
  }) => {
    const { call } = await fixture();

    expect(
      await call("action_call", {
        action: "getNote",
        params: { id: 1 },
        as: "anonymous",
      }),
    ).toMatch(/^401 in/);
    expect(
      await call("action_call", {
        action: "getNote",
        params: { id: 1 },
        as: { roles: ["reader"] },
      }),
    ).toMatch(/^403 in/);
  });

  it("returns a declared error and a validation 400 as answers", async ({
    expect,
  }) => {
    const { call } = await fixture();

    const missing = await call("action_call", {
      action: "getNote",
      params: { id: 999 },
      as: { roles: ["admin"] },
    });
    expect(missing).toMatch(/^404 in/);
    expect(missing).toContain('"name": "NOTE_MISSING"');

    const invalid = await call("action_call", {
      action: "getNote",
      params: { id: "not-a-number" },
      as: { roles: ["admin"] },
    });
    expect(invalid).toMatch(/^400 in/);
  });

  it("runs as an existing user of alepha/api/users, with that user's roles", async ({
    expect,
  }) => {
    const f = await startFixture([NotesApp, AlephaApiUsers]);
    stops.push(f.stop);
    const users = f.app.inject(UserService);
    const admin = await users.createUser(
      { email: "admin@example.app", roles: ["admin"] },
      "users",
    );
    await users.createUser(
      { email: "plain@example.app", roles: ["user"] },
      "users",
    );
    const note = await f.app.inject(NotesApp).repo.create({ title: "mine" });

    expect(
      await f.call("action_call", {
        action: "getNote",
        params: { id: note.id },
        as: { id: admin.id },
      }),
    ).toMatch(/^200 in/);
    expect(
      await f.call("action_call", {
        action: "getNote",
        params: { id: note.id },
        as: { email: "plain@example.app" },
      }),
    ).toMatch(/^403 in/);
    expect(
      await f.call("action_call", {
        action: "getNote",
        params: { id: note.id },
        as: { email: "nobody@example.app" },
      }),
    ).toBe("Not called: No user with email nobody@example.app");
  });

  it("says why it did not call: an unknown action, or an existing user without alepha/api/users", async ({
    expect,
  }) => {
    const { call } = await fixture();

    expect(await call("action_call", { action: "nope", as: "anonymous" })).toBe(
      'Not called: No action named "nope"',
    );
    expect(
      await call("action_call", {
        action: "getNote",
        params: { id: 1 },
        as: { email: "ada@example.app" },
      }),
    ).toMatch(
      /^Not called: Calling as an existing user needs alepha\/api\/users/,
    );
  });
});
