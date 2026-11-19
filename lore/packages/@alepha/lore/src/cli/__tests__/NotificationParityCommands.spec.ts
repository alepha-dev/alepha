import { Alepha } from "alepha";
import {
  CliProvider,
  ConsoleOutputProvider,
  MemoryOutputProvider,
} from "alepha/command";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, it } from "vitest";

import { ChannelCommand } from "../commands/ChannelCommand.ts";
import { InboxCommand } from "../commands/InboxCommand.ts";
import { QuestCommand } from "../commands/QuestCommand.ts";
import { ThresholdCommand } from "../commands/ThresholdCommand.ts";
import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";

const HOOK = "https://hooks.example.test/secret-path";

class StdinChannelCommand extends ChannelCommand {
  public stdin = "";
  protected override async readStdin(): Promise<string> {
    return this.stdin;
  }
}

/**
 * The notification features the CLI drives since #Q3914: channels with the
 * URL from stdin, the secret printed once, thresholds, a quest's reminder,
 * the inbox and the preferences, each on the action the page calls.
 */
describe("lore channel, threshold, inbox, notifications and quest reminder", () => {
  const create = () => {
    const alepha = Alepha.create({
      env: {
        LOG_LEVEL: "error",
        LORE_API_KEY: "k",
        LORE_URL: "https://lore.test",
        LORE_PROJECT: "hello",
        HOME: "/nonexistent",
      },
    })
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider })
      .with({ provide: ConsoleOutputProvider, use: MemoryOutputProvider })
      .with({ provide: ChannelCommand, use: StdinChannelCommand });
    const printed = alepha.inject(MemoryOutputProvider).lines;
    const sent: Array<[string, unknown]> = [];
    const record =
      (
        name: string,
        answer: (request: any) => unknown = () => ({ ok: true }),
      ) =>
      async (request: unknown) => {
        sent.push([name, request]);
        return answer(request);
      };
    Object.assign(
      alepha.inject(LoreProjectResolver) as unknown as Record<string, unknown>,
      {
        projects: {
          getProjectBySlug: async () => ({ id: 7 }),
          getProjectById: async () => ({ id: 7 }),
        },
      },
    );
    const channels = alepha.inject(StdinChannelCommand);
    const thresholds = alepha.inject(ThresholdCommand);
    const inbox = alepha.inject(InboxCommand);
    const quests = alepha.inject(QuestCommand);
    const channel = {
      id: "c1",
      kind: "webhook",
      name: "ci",
      builtIn: false,
    };
    Object.assign(channels as unknown as Record<string, unknown>, {
      api: {
        listProjectChannels: record("listProjectChannels", () => ({
          items: [channel],
        })),
        createProjectChannel: record("createProjectChannel", () => ({
          ...channel,
          secret: "whsec_abc",
        })),
        updateProjectChannel: record("updateProjectChannel", () => channel),
        deleteProjectChannel: record("deleteProjectChannel"),
        rotateProjectChannelSecret: record(
          "rotateProjectChannelSecret",
          () => ({
            ...channel,
            secret: "whsec_new",
          }),
        ),
      },
    });
    Object.assign(thresholds as unknown as Record<string, unknown>, {
      api: {
        getProjectThresholds: record("getProjectThresholds", () => ({
          coverageMin: 80,
          openErrorsMax: null,
        })),
        setProjectThresholds: record("setProjectThresholds", (request) => ({
          coverageMin: null,
          openErrorsMax: null,
          ...request.body,
        })),
      },
    });
    Object.assign(inbox as unknown as Record<string, unknown>, {
      inboxApi: {
        listInbox: record("listInbox", () => ({
          items: [
            {
              id: "01900000-0000-7000-8000-000000000001",
              createdAt: "2026-11-19T10:00:00.000Z",
              scopeLabel: "Acme",
              title: "Web probe is down",
              href: "/acme/apps",
            },
          ],
          unreadCount: 1,
        })),
        markInboxRead: record("markInboxRead"),
        markAllInboxRead: record("markAllInboxRead", () => ({
          ok: true,
          count: 3,
        })),
      },
      preferenceApi: {
        getMyNotificationPreferences: record(
          "getMyNotificationPreferences",
          () => ({
            emailEnabled: false,
            mutedCategories: ["mentions"],
            categories: ["mentions", "notifications"],
          }),
        ),
        updateMyNotificationPreferences: record(
          "updateMyNotificationPreferences",
          (request) => ({
            emailEnabled: request.body.emailEnabled ?? false,
            mutedCategories: request.body.mutedCategories ?? ["mentions"],
            categories: ["mentions", "notifications"],
          }),
        ),
      },
    });
    Object.assign(quests as unknown as Record<string, unknown>, {
      questApi: {
        getQuestByShortId: record("getQuestByShortId", () => ({
          id: 41,
          shortId: 12,
          title: "Ship it",
        })),
        setQuestReminder: record("setQuestReminder", () => ({
          id: 41,
          shortId: 12,
          title: "Ship it",
        })),
      },
    });
    const run = async (command: any, argv: string) => {
      await alepha.inject(CliProvider).run(command, { argv });
    };
    return { run, printed, sent, channels, thresholds, inbox, quests };
  };

  it("adds a channel with its URL from stdin, never a flag, and prints the secret once", async ({
    expect,
  }) => {
    const { run, printed, sent, channels } = create();
    channels.stdin = `${HOOK}\n`;
    await run(channels.add, "--kind webhook --name ci --url-stdin");
    expect(sent).toEqual([
      [
        "createProjectChannel",
        {
          params: { projectId: 7 },
          body: { kind: "webhook", name: "ci", url: HOOK },
        },
      ],
    ]);
    expect(printed.join("\n")).toContain(
      "Signing secret, shown once: whsec_abc",
    );
  });

  it("refuses to add a channel without stdin, and to delete one without --yes", async ({
    expect,
  }) => {
    const { run, sent, channels } = create();
    await expect(run(channels.add, "--name ci")).rejects.toThrow(/url-stdin/);
    await expect(run(channels.delete, "c1")).rejects.toThrow(/--yes/);
    expect(sent).toEqual([]);
  });

  it("renames, replaces the URL from stdin, rotates and deletes", async ({
    expect,
  }) => {
    const { run, printed, sent, channels } = create();
    channels.stdin = HOOK;
    await run(channels.update, "c1 --name alerts --url-stdin");
    await run(channels.rotate, "c1");
    await run(channels.delete, "c1 --yes");
    expect(sent).toEqual([
      [
        "updateProjectChannel",
        {
          params: { projectId: 7, id: "c1" },
          body: { name: "alerts", url: HOOK },
        },
      ],
      ["rotateProjectChannelSecret", { params: { projectId: 7, id: "c1" } }],
      ["deleteProjectChannel", { params: { projectId: 7, id: "c1" } }],
    ]);
    expect(printed.join("\n")).toContain("whsec_new");
  });

  it("reads the thresholds, sets one and clears another with none", async ({
    expect,
  }) => {
    const { run, printed, sent, thresholds } = create();
    await run(thresholds.get, "");
    await run(thresholds.set, "--coverage-min 75 --open-errors-max none");
    expect(sent).toEqual([
      ["getProjectThresholds", { params: { projectId: 7 } }],
      [
        "setProjectThresholds",
        {
          params: { projectId: 7 },
          body: { coverageMin: 75, openErrorsMax: null },
        },
      ],
    ]);
    expect(printed.join("\n")).toContain("Coverage alert: under 80%");
    await expect(run(thresholds.set, "")).rejects.toThrow(/coverage-min/);
  });

  it("sets and clears a quest's reminder", async ({ expect }) => {
    const { run, sent, quests } = create();
    await run(quests.reminderSet, "12 --interval weekly");
    await run(quests.reminderSet, "12 --interval off");
    expect(sent.filter(([name]) => name === "setQuestReminder")).toEqual([
      [
        "setQuestReminder",
        { params: { id: 41 }, body: { interval: "weekly" } },
      ],
      ["setQuestReminder", { params: { id: 41 }, body: { interval: null } }],
    ]);
  });

  it("lists the inbox across projects unless one is named, and marks it read", async ({
    expect,
  }) => {
    const { run, printed, sent, inbox } = create();
    await run(inbox.list, "--unread");
    await run(inbox.list, "--project 7 --limit 5");
    await run(inbox.read, "01900000-0000-7000-8000-000000000001");
    await run(inbox.read, "--all --project 7");
    expect(sent).toEqual([
      ["listInbox", { query: { unreadOnly: true } }],
      ["listInbox", { query: { scope: "project:7", limit: 5 } }],
      [
        "markInboxRead",
        { params: { id: "01900000-0000-7000-8000-000000000001" } },
      ],
      ["markAllInboxRead", { query: { scope: "project:7" } }],
    ]);
    expect(printed.join("\n")).toContain("Web probe is down");
    expect(printed.join("\n")).toContain("Marked 3 read");
  });

  it("prints the caller's preferences", async ({ expect }) => {
    const { run, printed, inbox } = create();
    await run(inbox.preferencesGet, "");
    expect(printed.join("\n")).toContain("Email: off");
    expect(printed.join("\n")).toMatch(/muted\s+mentions/);
  });

  it("changes the caller's preferences, merging mutes with what is muted, and refuses an unknown kind", async ({
    expect,
  }) => {
    const { run, sent, inbox } = create();
    await run(
      inbox.preferencesSet,
      "--email on --mute notifications --unmute mentions",
    );
    expect(
      sent.filter(([name]) => name === "updateMyNotificationPreferences"),
    ).toEqual([
      [
        "updateMyNotificationPreferences",
        { body: { emailEnabled: true, mutedCategories: ["notifications"] } },
      ],
    ]);
    await expect(run(inbox.preferencesSet, "--mute nope")).rejects.toThrow(
      /Unknown kind: nope/,
    );
    await expect(run(inbox.preferencesSet, "")).rejects.toThrow(/--email/);
  });
});
