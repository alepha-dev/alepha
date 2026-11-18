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

import { EventCommand } from "../commands/EventCommand.ts";
import { SubscriptionCommand } from "../commands/SubscriptionCommand.ts";
import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";

const SUB = "01900000-0000-7000-8000-000000000003";
const ROW = {
  id: SUB,
  projectId: 7,
  event: "host.offline",
  memberId: "01900000-0000-7000-8000-000000000004",
  channels: ["inapp"],
  createdAt: "2026-11-18T10:00:00.000Z",
};

/**
 * `lore event` and `lore subscription` (#Q3895): what each verb sends, on
 * the same actions the Notifications page uses.
 */
describe("lore event and lore subscription", () => {
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
      .with({ provide: ConsoleOutputProvider, use: MemoryOutputProvider });
    const printed = alepha.inject(MemoryOutputProvider).lines;
    const sent: Array<[string, unknown]> = [];
    const events = alepha.inject(EventCommand);
    const subscriptions = alepha.inject(SubscriptionCommand);
    Object.assign(
      alepha.inject(LoreProjectResolver) as unknown as Record<string, unknown>,
      { projects: { getProjectBySlug: async () => ({ id: 7 }) } },
    );
    const record =
      (name: string, answer: (request: any) => unknown) =>
      async (request: unknown) => {
        sent.push([name, request]);
        return answer(request);
      };
    Object.assign(events as unknown as Record<string, unknown>, {
      api: {
        getProjectEventCatalog: record("getProjectEventCatalog", () => ({
          items: [
            {
              name: "host.offline",
              label: "Host offline",
              resource: "hosts",
              fields: { host: "text" },
              permission: "host:read",
              needs: { capability: "ship" },
              filter: { field: "host_id", resource: "host" },
              available: true,
            },
          ],
        })),
        listProjectEvents: record("listProjectEvents", () => ({
          items: [
            {
              id: "01900000-0000-7000-8000-000000000005",
              name: "host.offline",
              subjectKind: "host",
              fields: { title: "ci-box" },
              occurredAt: "2026-11-18T10:00:00.000Z",
            },
          ],
          hasMore: false,
        })),
      },
    });
    Object.assign(subscriptions as unknown as Record<string, unknown>, {
      api: {
        listSubscriptions: record("listSubscriptions", () => ({
          items: [ROW],
        })),
        setSubscription: record("setSubscription", () => ROW),
        muteSubscription: record("muteSubscription", () => ROW),
        deleteSubscription: record("deleteSubscription", () => ({ ok: true })),
      },
      channelApi: {
        listProjectChannels: record("listProjectChannels", () => ({
          items: [
            {
              id: "webhook-1",
              kind: "webhook",
              name: "ci",
              builtIn: false,
              url: "https://hooks.example.test/secret-path",
            },
          ],
        })),
      },
    });
    const run = async (command: any, argv: string) => {
      await alepha.inject(CliProvider).run(command, { argv });
    };
    return { run, printed, sent, events, subscriptions };
  };

  it("lists the catalog with availability and the filter field", async ({
    expect,
  }) => {
    const { run, printed, sent, events } = create();
    await run(events.catalog, "");
    expect(sent).toEqual([
      ["getProjectEventCatalog", { params: { projectId: 7 } }],
    ]);
    expect(printed.join("\n")).toMatch(/host\.offline.*Host offline/);
    expect(printed.join("\n")).toContain("filter: host_id");
  });

  it("lists recent events, narrowed and paginated", async ({ expect }) => {
    const { run, sent, events } = create();
    await run(events.list, "--name host.offline --limit 5 --offset 10");
    expect(sent).toEqual([
      [
        "listProjectEvents",
        {
          params: { projectId: 7 },
          query: { name: "host.offline", limit: 5, offset: 10 },
        },
      ],
    ]);
  });

  it("lists who is notified, and never a channel's URL", async ({ expect }) => {
    const { run, printed, subscriptions } = create();
    await run(subscriptions.list, "--output json");
    expect(printed.join("\n")).toContain(SUB);
    expect(printed.join("\n")).not.toContain("secret-path");
  });

  it("subscribes a member, a channel, and mutes and removes by id", async ({
    expect,
  }) => {
    const { run, sent, subscriptions } = create();
    await run(
      subscriptions.set,
      "--event host.offline --filter h1 --member 01900000-0000-7000-8000-000000000004 --channels inapp,email",
    );
    await run(subscriptions.set, "--event deploy.failed --channel webhook-1");
    await run(subscriptions.set, `${SUB} --verb mute`);
    await run(subscriptions.set, `${SUB} --verb remove`);
    expect(sent).toEqual([
      [
        "setSubscription",
        {
          params: { projectId: 7 },
          body: {
            event: "host.offline",
            filter: "h1",
            memberId: "01900000-0000-7000-8000-000000000004",
            channels: ["inapp", "email"],
          },
        },
      ],
      [
        "setSubscription",
        {
          params: { projectId: 7 },
          body: { event: "deploy.failed", channelId: "webhook-1" },
        },
      ],
      [
        "muteSubscription",
        { params: { projectId: 7, id: SUB }, body: { muted: true } },
      ],
      ["deleteSubscription", { params: { projectId: 7, id: SUB } }],
    ]);
  });
});
