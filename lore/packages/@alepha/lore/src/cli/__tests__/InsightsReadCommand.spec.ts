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

import { ErrorCommand } from "../commands/ErrorCommand.ts";
import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";

const SIGIL = "01900000-0000-7000-8000-0000000000aa";

/**
 * `lore insights read` against recorded answers: what the flags ask the API
 * for, and what of the answer is printed.
 */
describe("lore insights read", () => {
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
    const sent: Array<[string, any]> = [];
    Object.assign(
      alepha.inject(LoreProjectResolver) as unknown as Record<string, unknown>,
      {
        projects: {
          getProjectBySlug: async () => ({ id: 7 }),
          getProjectById: async () => ({ id: 7 }),
        },
      },
    );
    const metric = {
      samples: 0,
      buckets: [],
      boundaries: [],
      p75Bucket: null,
      p75Lower: null,
      p75Upper: null,
    };
    const command = alepha.inject(ErrorCommand);
    Object.assign(command as unknown as Record<string, unknown>, {
      appApi: {
        getApp: async (request: any) => {
          sent.push(["getApp", request]);
          return { sigil: { id: SIGIL } };
        },
      },
      insightsApi: {
        getInsights: async (request: any) => {
          sent.push(["getInsights", request]);
          return {
            range: "custom",
            traffic: "all",
            from: "2026-11-01T00:00:00.000Z",
            to: "2026-11-08T00:00:00.000Z",
            grain: "day",
            since: "2026-11-01",
            until: "2026-11-07",
            totals: {
              visitors: 12,
              visits: 20,
              views: 55,
              bounceRate: 0.4,
              engagedRate: 0.5,
              avgVisitSeconds: 95,
              pagesPerVisit: 2.75,
            },
            timeline: [
              { bucket: "2026-11-01", visitors: 3, visits: 4, views: 9 },
            ],
            visitorsSpanPeriods: true,
            visitorsSpanApps: false,
            visitorsFrom: null,
            peopleOnly: true,
            leaderboards: {
              path: [{ value: "/docs", visitors: 9, views: 30 }],
            },
            vitals: {
              lcp: metric,
              cls: metric,
              inp: metric,
              fcp: metric,
              ttfb: metric,
            },
            errorGroups: [],
            errorSeries: [],
            estimated: false,
          };
        },
      },
    });
    const run = (argv: string) =>
      alepha.inject(CliProvider).run(command.read, { argv });
    return { alepha, printed, sent, run };
  };

  it("asks for one copy over a custom window and grain, and prints the v2 fields", async ({
    expect,
  }) => {
    const { sent, printed, run } = create();
    await run(
      "--app docs --env staging --from 2026-11-01 --to 2026-11-07 --grain day --segment analytics",
    );

    expect(sent[0]).toEqual([
      "getApp",
      { params: { projectId: 7, app: "docs", env: "staging" } },
    ]);
    expect(sent[1][1].query).toMatchObject({
      from: "2026-11-01",
      to: "2026-11-07",
      grain: "day",
      sigilId: SIGIL,
    });
    const text = printed.join("\n");
    expect(text).toContain("12 visitors, 20 visits, 55 views");
    expect(text).toContain(
      "bounce 40%, engaged 50%, 95 s a visit, 2.8 pages a visit",
    );
    expect(text).toContain("visitors are a sum: the window crosses a period");
    expect(text).toContain("/docs  9 visitors  30 views");
  });

  it("defaults the copy's environment to production, and reads the project without --app", async ({
    expect,
  }) => {
    const { sent, run } = create();
    await run("--app docs --segment analytics");
    expect(sent[0][1].params.env).toBe("production");

    const second = create();
    await second.run("--range 90d --segment analytics");
    expect(second.sent.map(([name]) => name)).toEqual(["getInsights"]);
    expect(second.sent[0][1].query).toMatchObject({ range: "90d" });
    expect(second.sent[0][1].query.sigilId).toBeUndefined();
  });
});
