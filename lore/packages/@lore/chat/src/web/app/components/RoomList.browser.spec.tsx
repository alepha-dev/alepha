import { I18n } from "@lore/core/web";
import { fireEvent, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { afterEach, describe, it } from "vitest";

import type { ChatRoomResource } from "../../../schemas/index.ts";
import RoomList from "./RoomList.tsx";

const NOW = Date.parse("2026-11-19T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

const room = (
  name: string,
  options: { private?: boolean; lastAt?: number; archived?: boolean } = {},
): ChatRoomResource => ({
  id: crypto.randomUUID(),
  projectId: 1,
  name,
  private: options.private ?? false,
  createdAt: new Date(NOW - 30 * DAY).toISOString(),
  memberCount: 2,
  joined: true,
  ...(options.archived
    ? { archivedAt: new Date(NOW - DAY).toISOString() }
    : {}),
  ...(options.lastAt !== undefined
    ? {
        lastMessage: {
          id: crypto.randomUUID(),
          createdAt: new Date(options.lastAt).toISOString(),
          preview: `last in ${name}`,
        },
      }
    : {}),
});

/**
 * The Chat page's room list (#E161, #Q3929): one flat list, what has
 * something unread first, then by last activity, and the rooms nothing has
 * happened in for a week folded behind one row.
 */
describe("RoomList", () => {
  let alepha: Alepha | undefined;

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (
    rooms: ChatRoomResource[],
    unread: Record<string, number> = {},
    selected?: string,
  ) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with(AlephaReact)
      .with(AlephaReactI18n);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    const byName = new Map(rooms.map((it) => [it.name, it]));
    const counts = new Map(
      Object.entries(unread).map(([name, count]) => [
        byName.get(name)!.id,
        { unread: count, mentions: 0 },
      ]),
    );
    return render(
      <AlephaContext.Provider value={alepha}>
        <RoomList
          rooms={rooms}
          unread={counts}
          now={NOW}
          selectedId={selected ? byName.get(selected)!.id : undefined}
          onOpen={() => {}}
        />
      </AlephaContext.Provider>,
    );
  };

  const shown = () =>
    screen
      .queryAllByTestId("chat-room-row")
      .map((row) => row.getAttribute("data-room"));

  it("puts rooms with something unread first, then the most recently active", async ({
    expect,
  }) => {
    await mount(
      [
        room("design", { lastAt: NOW - 3 * 60_000 }),
        room("general", { lastAt: NOW - 60_000 }),
        room("release", { lastAt: NOW - 2 * DAY }),
      ],
      { release: 2 },
    );

    expect(shown()).toEqual(["release", "general", "design"]);
  });

  it("folds rooms quiet for a week, and archived ones, behind one row", async ({
    expect,
  }) => {
    await mount([
      room("general", { lastAt: NOW - 60_000 }),
      room("old", { lastAt: NOW - 9 * DAY }),
      room("never"),
      room("closed", { lastAt: NOW - 60_000, archived: true }),
    ]);

    expect(shown()).toEqual(["general"]);
    fireEvent.click(screen.getByText("Show 3 quiet rooms"));
    expect(shown()).toEqual(["general", "closed", "old", "never"]);
  });

  it("never folds the room being read, nor one with something unread", async ({
    expect,
  }) => {
    await mount(
      [
        room("general", { lastAt: NOW - 60_000 }),
        room("old", { lastAt: NOW - 9 * DAY }),
        room("older", { lastAt: NOW - 20 * DAY }),
      ],
      { older: 1 },
      "old",
    );

    expect(shown()).toEqual(["older", "general", "old"]);
  });

  it("filters to the unread or the private rooms", async ({ expect }) => {
    await mount(
      [
        room("general", { lastAt: NOW - 60_000 }),
        room("secret", { lastAt: NOW - 2 * 60_000, private: true }),
      ],
      { general: 1 },
    );

    fireEvent.click(screen.getByRole("tab", { name: "Unread" }));
    expect(shown()).toEqual(["general"]);
    fireEvent.click(screen.getByRole("tab", { name: "Private" }));
    expect(shown()).toEqual(["secret"]);
  });
});
