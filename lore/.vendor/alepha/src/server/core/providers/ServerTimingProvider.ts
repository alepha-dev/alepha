import { $hook, $inject, Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";

type TimingMap = Record<string, [number, number]>;

export class ServerTimingProvider {
  protected readonly log = $logger();
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly alepha = $inject(Alepha);

  public options = {
    /**
     * Prefix of every metric name. Defaults to `alepha.name` lowercased, read
     * when the header is written so a Worker's `APP_NAME` binding counts.
     */
    prefix: undefined as string | undefined,
    disabled: this.alepha.isProduction(),
  };

  /**
   * {@link options.prefix}, else `<alepha.name>-` lowercased.
   */
  protected get prefix(): string {
    return this.options.prefix ?? `${this.alepha.name.toLowerCase()}-`;
  }

  public readonly onRequest = $hook({
    priority: "first",
    on: "server:onRequest",
    handler: ({ request }) => {
      if (this.options.disabled) {
        return;
      }

      request.metadata.timing = {};
      request.metadata.timing[this.handlerName] = [this.dateTime.nowMillis()];
    },
  });

  public readonly onResponse = $hook({
    priority: "last",
    on: "server:onResponse",
    handler: ({ request }) => {
      if (this.options.disabled) {
        return;
      }

      if (request.metadata.timing) {
        this.setDuration(this.handlerName, request.metadata.timing);

        const timings: string[] = [];

        for (const [name, [start, duration]] of Object.entries(
          request.metadata.timing as TimingMap,
        )) {
          if (typeof start !== "number" || typeof duration !== "number") {
            this.log.warn(
              `Invalid timing for '${name}': [${start}, ${duration}]`,
            );
            continue;
          }

          const formattedName =
            this.prefix + name.replace(/[^a-zA-Z0-9-]/g, "-");
          timings.push(`${formattedName};dur=${duration}`);
        }

        // Joined, not accumulated with a trailing separator: the header used
        // to end with a dangling ", ".
        const timingHeader = timings.join(", ");
        if (!timingHeader) {
          return;
        }
        if (request.reply.headers["Server-Timing"]) {
          request.reply.headers["Server-Timing"] += `, ${timingHeader}`;
        } else {
          request.reply.headers["Server-Timing"] = timingHeader;
        }
      }
    },
  });

  protected get handlerName() {
    return `request`;
  }

  public beginTiming(name: string): void {
    if (this.options.disabled) {
      return;
    }

    // Untracked (#E78): timing metadata never reaches a page's markup.
    const request = this.alepha.store.getUntracked("alepha.http.request");
    if (!request) {
      return;
    }

    request.metadata ??= {};
    request.metadata.timing ??= {};
    request.metadata.timing[name] = [this.dateTime.nowMillis()];
  }

  public endTiming(name: string): void {
    if (this.options.disabled) {
      return;
    }

    // Untracked (#E78): timing metadata never reaches a page's markup.
    const request = this.alepha.store.getUntracked("alepha.http.request");
    if (!request) {
      return;
    }

    if (!request.metadata?.timing || !(name in request.metadata.timing)) {
      this.log.warn(`No timing found for '${name}'.`);
      return;
    }

    const start = request.metadata.timing[name]?.[0];
    if (typeof start !== "number") {
      this.log.warn(`Invalid timing start for '${name}': ${start}`);
      return;
    }

    this.setDuration(name, request.metadata.timing);
  }

  protected setDuration(name: string, timing: TimingMap): void {
    timing[name] = [
      timing[name][0],
      this.dateTime.nowMillis() - timing[name][0],
    ];
  }
}
