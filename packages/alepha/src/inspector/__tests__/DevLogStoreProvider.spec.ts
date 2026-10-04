import { Alepha, type Infer } from "alepha";
import { $logger, type logEntrySchema } from "alepha/logger";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, expect, it } from "vitest";

import { DevLogStoreProvider } from "../providers/DevLogStoreProvider.ts";
import { DEV_LOG_RESTART_TYPE } from "../schemas/DevLogMarker.ts";

type LogEntry = Infer<typeof logEntrySchema>;

const LOG_FILE = "node_modules/.alepha/devtools/logs.jsonl";

/**
 * Exposes the bounding logic, which is the part worth testing directly: a
 * container round-trip would only ever show the happy path of it.
 */
class TestDevLogStore extends DevLogStoreProvider {
  public testTail = (lines: string[]) => this.tail(lines);

  public get testFile(): string {
    return this.file;
  }
}

/**
 * Something in the container that logs. Registered before `start()` because the
 * container locks there, and the point is to exercise the real `log` hook
 * rather than to call the store's own methods.
 */
class Emitter {
  public readonly log = $logger();
}

const entry = (message: string, timestamp: number): LogEntry => ({
  level: "INFO",
  message,
  service: "App",
  module: "app",
  timestamp,
});

const asLines = (entries: LogEntry[]): string =>
  `${entries.map((e) => JSON.stringify(e)).join("\n")}\n`;

/**
 * `NODE_ENV` is the switch. Persistence is off under test so that suites do not
 * leak logs into one another through a file, so a spec ABOUT persistence has to
 * say it is not one.
 */
const create = () =>
  Alepha.create({
    env: { NODE_ENV: "development", LOG_LEVEL: "silent" },
  }).with({ provide: FileSystemProvider, use: MemoryFileSystemProvider });

const boot = async (seed?: string) => {
  const alepha = create();
  const fs = alepha.inject(MemoryFileSystemProvider);
  const store = alepha.inject(DevLogStoreProvider);
  const emitter = alepha.inject(Emitter);
  if (seed !== undefined) {
    await fs.writeFile(LOG_FILE, seed);
  }
  await alepha.start();
  return { alepha, fs, store, emitter };
};

describe("DevLogStoreProvider", () => {
  describe("restoring a previous run", () => {
    it("serves the previous run's entries before this run's", async () => {
      const { alepha, store } = await boot(
        asLines([entry("before the crash", 1), entry("the crash", 2)]),
      );

      const messages = store.entries().map((e) => e.message);

      expect(messages.slice(0, 2)).toEqual(["before the crash", "the crash"]);
      await alepha.stop();
    });

    it("separates the two runs with a structural marker", async () => {
      const { alepha, store } = await boot(asLines([entry("old", 1)]));

      const marker = store
        .entries()
        .find((e) => e.data?.type === DEV_LOG_RESTART_TYPE);

      expect(marker).toBeDefined();
      // Structural, so the UI can style a divider without matching on words the
      // inspected application could itself log.
      expect(marker?.message).toBe("App Restarted");
      expect(store.entries().indexOf(marker!)).toBe(1);
      await alepha.stop();
    });

    it("writes no marker on a first boot", async () => {
      const { alepha, store } = await boot();

      // Nothing precedes it, so a divider would separate nothing.
      expect(
        store.entries().some((e) => e.data?.type === DEV_LOG_RESTART_TYPE),
      ).toBe(false);
      await alepha.stop();
    });

    it("skips the torn last line a crash leaves behind", async () => {
      const seed = `${asLines([entry("intact", 1)])}{"level":"ERROR","mess`;
      const { alepha, store } = await boot(seed);

      const messages = store.entries().map((e) => e.message);

      expect(messages).toContain("intact");
      expect(messages.some((m) => m.includes("mess"))).toBe(false);
      await alepha.stop();
    });

    it("compacts the file back within bounds on boot", async () => {
      const many = Array.from({ length: 50 }, (_, i) => entry(`e${i}`, i + 1));
      const { alepha, fs, store } = await boot(asLines(many));

      store.options.maxEntries = 2_000;
      const written = await fs.readTextFile(LOG_FILE);

      // Rewritten, marker included, so the running process only ever appends.
      expect(written).toContain(DEV_LOG_RESTART_TYPE);
      expect(written.trimEnd().split("\n")).toHaveLength(51);
      await alepha.stop();
    });
  });

  describe("persisting this run", () => {
    it("appends what the application logs", async () => {
      const { alepha, fs, emitter } = await boot();

      emitter.log.error("something blew up");
      await alepha.stop();

      // ERROR does not wait for the coalescing timer: it is often the last
      // thing a dying process says.
      expect(fs.wasAppended(LOG_FILE)).toBe(true);
      expect(await fs.readTextFile(LOG_FILE)).toContain("something blew up");
    });

    it("survives a restart, marker and all", async () => {
      const first = await boot();
      first.emitter.log.error("the reason you restarted");
      await first.alepha.stop();

      const persisted = await first.fs.readTextFile(LOG_FILE);
      const second = await boot(persisted);

      const messages = second.store.entries().map((e) => e.message);
      expect(messages).toContain("the reason you restarted");
      expect(messages.indexOf("the reason you restarted")).toBeLessThan(
        messages.indexOf("App Restarted"),
      );
      await second.alepha.stop();
    });
  });

  describe("bounds", () => {
    it("keeps the newest entries up to the count ceiling", () => {
      const store = create().inject(TestDevLogStore);
      store.options.maxEntries = 3;

      const kept = store.testTail(
        Array.from({ length: 10 }, (_, i) => JSON.stringify(entry(`e${i}`, i))),
      );

      expect(kept.map((e) => e.message)).toEqual(["e7", "e8", "e9"]);
    });

    it("stops at the byte ceiling even when the count would allow more", () => {
      const store = create().inject(TestDevLogStore);
      store.options.maxEntries = 1_000;

      const fat = Array.from({ length: 10 }, (_, i) =>
        JSON.stringify({
          ...entry(`e${i}`, i),
          data: { blob: "x".repeat(500) },
        }),
      );
      store.options.maxBytes = 1_200;

      const kept = store.testTail(fat);

      // Two entries fit; the count ceiling would have taken all ten. This is
      // the case a count alone leaves unbounded.
      expect(kept.length).toBe(2);
      expect(kept.map((e) => e.message)).toEqual(["e8", "e9"]);
    });

    it("honours DATA_DIR so the file can live outside a read-only bundle", () => {
      const alepha = Alepha.create({
        env: { NODE_ENV: "development", DATA_DIR: "/var/lib/app" },
      }).with({ provide: FileSystemProvider, use: MemoryFileSystemProvider });

      expect(alepha.inject(TestDevLogStore).testFile).toBe(
        "/var/lib/app/devtools/logs.jsonl",
      );
    });
  });
});
