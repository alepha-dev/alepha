import { $hook, $inject, Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";

type TimingMap = Record<string, [number, number]>;

export class ServerTimingProvider {
  protected readonly log = $logger();
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly alepha = $inject(Alepha);

  public options = {
    prefix: this.alepha.env.APP_NAME
      ? `${this.alepha.env.APP_NAME.toLowerCase()}-`
      : "",
    disabled: this.alepha.isProduction(),
  };

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

        let timingHeader = "";

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
            this.options.prefix + name.replace(/[^a-zA-Z0-9-]/g, "-");
          timingHeader += `${formattedName};dur=${duration}, `;
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

    const request = this.alepha.store.get("alepha.http.request");
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

    const request = this.alepha.store.get("alepha.http.request");
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
