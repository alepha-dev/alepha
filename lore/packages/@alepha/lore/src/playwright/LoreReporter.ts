import type {
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";

/**
 * Where the reporter records, and as whom.
 */
export interface LoreReporterOptions {
  /**
   * The project, by slug or id. Defaults to `LORE_PROJECT`.
   */
  project?: string | number;
  /**
   * The app copy the suite ran against, by its `app` and `env` names.
   * Defaults to `LORE_APP` and `LORE_ENV`; neither is `local`.
   */
  app?: string;
  env?: string;
  /**
   * The origin of the Lore instance. Defaults to `LORE_URL`, then the public
   * one.
   */
  url?: string;
  /**
   * The API key. Defaults to `LORE_API_KEY`, the one every CI command reads.
   */
  apiKey?: string;
  /**
   * The name the runs carry as their client. Defaults to `playwright`.
   */
  client?: string;
}

type Outcome = "passed" | "failed" | "not_run";

/**
 * A Playwright reporter that records use case runs in Lore (#E153): a test
 * tagged `@U7` is a run of use case #U7, and a criterion key in its title or
 * in a `criterion` annotation (`C2`) maps the test's outcome to that
 * criterion. A use case's criteria no test names are recorded "not run" by
 * Lore.
 *
 * ```ts
 * // playwright.config.ts
 * reporter: [["list"], ["@alepha/lore/playwright", { project: "acme", app: "shop", env: "staging" }]],
 * ```
 *
 * It needs nothing but `fetch`: it imports `@playwright/test` for its types
 * alone.
 */
export class LoreReporter implements Reporter {
  protected readonly options: LoreReporterOptions;
  protected readonly outcomes = new Map<
    number,
    Map<string, { outcome: Outcome; note?: string }>
  >();

  constructor(options: LoreReporterOptions = {}) {
    this.options = options;
  }

  public printsToStdio(): boolean {
    return false;
  }

  public onTestEnd(test: TestCase, result: TestResult): void {
    const tags = [...(test.tags ?? []), ...(test.title.match(/@U\d+/g) ?? [])];
    const useCases = [
      ...new Set(
        tags.flatMap((tag) => {
          const match = /^@U(\d+)$/i.exec(tag);
          return match ? [Number(match[1])] : [];
        }),
      ),
    ];
    if (useCases.length === 0) return;
    const keys = [
      ...new Set([
        ...(test.title.match(/\bC\d+\b/g) ?? []),
        ...test.annotations
          .filter((it) => it.type === "criterion" && it.description)
          .map((it) => it.description!.trim().toUpperCase()),
      ]),
    ];
    if (keys.length === 0) return;
    const outcome: Outcome =
      result.status === "passed"
        ? "passed"
        : result.status === "skipped"
          ? "not_run"
          : "failed";
    const note = result.error?.message?.split("\n")[0]?.slice(0, 500);
    for (const useCase of useCases) {
      const byKey = this.outcomes.get(useCase) ?? new Map();
      for (const key of keys) {
        // A criterion several tests play fails when one of them fails.
        if (byKey.get(key)?.outcome === "failed") continue;
        byKey.set(key, {
          outcome,
          ...(outcome === "failed" && note ? { note } : {}),
        });
      }
      this.outcomes.set(useCase, byKey);
    }
  }

  public async onEnd(_result: FullResult): Promise<void> {
    if (this.outcomes.size === 0) return;
    const env = typeof process === "undefined" ? {} : process.env;
    const url = (
      this.options.url ??
      env.LORE_URL ??
      "https://lore.alepha.app"
    ).replace(/\/$/, "");
    const apiKey = this.options.apiKey ?? env.LORE_API_KEY;
    const project = this.options.project ?? env.LORE_PROJECT;
    if (!apiKey || !project) {
      console.warn(
        "[lore] LORE_API_KEY and a project are required to record runs; nothing recorded.",
      );
      return;
    }
    const headers = {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    };
    const projectId = await this.projectId(url, headers, project);
    if (projectId === undefined) {
      console.warn(
        `[lore] No project '${project}' at ${url}; nothing recorded.`,
      );
      return;
    }
    for (const [useCaseNumber, byKey] of this.outcomes) {
      const response = await fetch(`${url}/api/recordUseCaseRun/${projectId}`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          useCaseNumber,
          by: "ci",
          client: this.options.client ?? "playwright",
          app: this.options.app ?? env.LORE_APP ?? undefined,
          env: this.options.env ?? env.LORE_ENV ?? undefined,
          results: [...byKey].map(([key, value]) => ({
            key,
            result: value.outcome,
            note: value.note,
          })),
        }),
      });
      if (!response.ok) {
        console.warn(
          `[lore] Recording #U${useCaseNumber} failed: ${response.status} ${await response.text()}`,
        );
      }
    }
  }

  protected async projectId(
    url: string,
    headers: Record<string, string>,
    project: string | number,
  ): Promise<number | undefined> {
    if (typeof project === "number" || /^\d+$/.test(project))
      return Number(project);
    const response = await fetch(
      `${url}/api/projects/by-slug/${encodeURIComponent(project)}`,
      {
        headers,
      },
    );
    if (!response.ok) return undefined;
    return ((await response.json()) as { id: number }).id;
  }
}
