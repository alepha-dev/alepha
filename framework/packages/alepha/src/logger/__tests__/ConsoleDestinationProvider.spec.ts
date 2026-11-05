import { Alepha } from "alepha";
import {
  $logger,
  ConsoleDestinationProvider,
  LogDestinationProvider,
} from "alepha/logger";
import { describe, it } from "vitest";

/**
 * The console destination, with every write recorded instead of printed.
 */
class RecordingConsoleDestination extends ConsoleDestinationProvider {
  public readonly writes: string[] = [];

  protected override writeStdout(message: string): void {
    this.writes.push(`out:${message}`);
  }

  protected override writeStderr(message: string): void {
    this.writes.push(`err:${message}`);
  }
}

class App {
  log = $logger();
}

const boot = async (env: Record<string, string>) => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "alepha.core:warn,info", LOG_FORMAT: "raw", ...env },
  })
    .with({ provide: LogDestinationProvider, use: RecordingConsoleDestination })
    .with(App);
  await alepha.start();
  const output = alepha.inject(RecordingConsoleDestination);
  // Start-up lines, held or written, are not what these tests look at.
  output.flush();
  output.writes.length = 0;
  return { alepha, app: alepha.inject(App), output };
};

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

/**
 * A production server joins the stdout lines of one event-loop turn into one
 * write: a write per line was the largest cost of a small request.
 */
describe("ConsoleDestinationProvider", () => {
  it("writes the lines of one turn as one write, in order, in production", async ({
    expect,
  }) => {
    const { alepha, app, output } = await boot({ NODE_ENV: "production" });

    app.log.info("first");
    app.log.info("second");
    expect(output.writes).toEqual([]);

    await nextTurn();
    expect(output.writes).toEqual(["out:first\nsecond"]);

    await alepha.stop();
  });

  it("flushes what it holds when the app stops", async ({ expect }) => {
    const { alepha, app, output } = await boot({ NODE_ENV: "production" });

    app.log.info("last words");
    await alepha.stop();

    expect(output.writes.join("\n")).toContain("last words");
  });

  it("writes stdout's held lines before a stderr line", async ({ expect }) => {
    const { alepha, app, output } = await boot({ NODE_ENV: "production" });

    app.log.info("before");
    alepha.store.set("alepha.logger.stream", "stderr");
    app.log.info("diagnostic");

    expect(output.writes).toEqual(["out:before", "err:diagnostic"]);
    alepha.store.set("alepha.logger.stream", "stdout");
    await alepha.stop();
  });

  it("writes each line at once outside production", async ({ expect }) => {
    const { alepha, app, output } = await boot({ NODE_ENV: "test" });

    app.log.info("now");
    expect(output.writes).toEqual(["out:now"]);

    await alepha.stop();
  });

  it("writes each line at once on a serverless runtime", async ({ expect }) => {
    const { alepha, app, output } = await boot({
      NODE_ENV: "production",
      ALEPHA_SERVERLESS: "true",
    });

    app.log.info("one record");
    expect(output.writes).toEqual(["out:one record"]);

    await alepha.stop();
  });
});
