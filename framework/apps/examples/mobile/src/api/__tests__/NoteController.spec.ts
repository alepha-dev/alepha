import { Alepha } from "alepha";
import { UserService } from "alepha/api/users";
import { describe, it } from "vitest";

import { NoteController } from "../controllers/NoteController.ts";
import { ApiModule } from "../index.ts";

const setup = async () => {
  const alepha = Alepha.create({
    env: {
      // The repo's vitest config points DATABASE_URL at postgres for every
      // suite; this app runs on sqlite, so it says so.
      DATABASE_URL: ":memory:",
    },
  }).with(ApiModule);

  const notes = alepha.inject(NoteController);
  const users = alepha.inject(UserService);

  await alepha.start();

  const owner = await users.createUser({ email: "owner@mobile.test" });
  const other = await users.createUser({ email: "other@mobile.test" });

  return {
    alepha,
    notes,
    users,
    owner: { id: owner.id, roles: ["user"] },
    other: { id: other.id, roles: ["user"] },
  };
};

describe("mobile: NoteController", () => {
  it("lists only the caller's notes, newest first", async ({ expect }) => {
    const { notes, owner, other } = await setup();

    await notes.createNote.run({ body: { title: "first" } }, { user: owner });
    await notes.createNote.run({ body: { title: "second" } }, { user: owner });
    await notes.createNote.run({ body: { title: "theirs" } }, { user: other });

    const mine = await notes.listNotes.run({}, { user: owner });

    expect(mine.map((note) => note.title).sort()).toEqual(["first", "second"]);
  });

  it("refuses to delete another user's note as if it did not exist", async ({
    expect,
  }) => {
    const { notes, owner, other } = await setup();

    const note = await notes.createNote.run(
      { body: { title: "mine" } },
      { user: owner },
    );

    await expect(
      notes.deleteNote.run({ params: { id: note.id } }, { user: other }),
    ).rejects.toThrow("Note not found");

    const result = await notes.deleteNote.run(
      { params: { id: note.id } },
      { user: owner },
    );
    expect(result.ok).toBe(true);
    expect(await notes.listNotes.run({}, { user: owner })).toEqual([]);
  });
});

describe("mobile: TestUserSeed", () => {
  it("creates the test account once", async ({ expect }) => {
    const { users } = await setup();

    const { content } = await users.findUsers({
      emails: ["test@mobile.test"],
    });

    expect(content).toHaveLength(1);
  });
});
