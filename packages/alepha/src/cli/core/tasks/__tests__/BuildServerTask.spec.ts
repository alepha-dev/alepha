import { Alepha } from "alepha";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, it } from "vitest";
import { BuildServerTask } from "../BuildServerTask.ts";

/**
 * Test subclass exposing the protected {@link BuildServerTask.durableObjectReexport}
 * helper so the Durable Object re-export line can be unit-tested in isolation.
 */
class TestServerTask extends BuildServerTask {
  public testExportLine = (entryFile: string) =>
    this.durableObjectReexport(entryFile);

  public testUsesWebSocket = (alepha: unknown) =>
    this.usesWebSocket(alepha as any);
}

/**
 * Minimal fake of the workspace's live Alepha — only `primitives` is probed
 * by {@link BuildServerTask.usesWebSocket}.
 */
const fakeAlephaWithPrimitives = (names: string[]) =>
  ({
    primitives: (name: string) => (names.includes(name) ? [{}] : []),
  }) as any;

describe("BuildServerTask DO re-export", () => {
  it("re-exports the DO class from the hashed bundle when workerd + websocket", ({
    expect,
  }) => {
    const alepha = Alepha.create().with({
      provide: FileSystemProvider,
      use: MemoryFileSystemProvider,
    });
    const task = alepha.inject(TestServerTask) as any;
    task.exportDurableObject = true;
    expect(task.testExportLine("abc123.js")).toBe(
      'export { AlephaWebSocketDurableObject } from "./server/abc123.js";\n',
    );
  });

  it("emits nothing when not a workerd websocket build", ({ expect }) => {
    const alepha = Alepha.create().with({
      provide: FileSystemProvider,
      use: MemoryFileSystemProvider,
    });
    const task = alepha.inject(TestServerTask) as any;
    task.exportDurableObject = false;
    expect(task.testExportLine("abc123.js")).toBe("");
  });

  /**
   * The DO gate must fire for `$room`-only apps too: a rooms-only realtime
   * layer still runs inside `AlephaWebSocketDurableObject`, and without the
   * re-export in `dist/index.js` wrangler cannot resolve the migration's
   * `class_name` at deploy time.
   */
  describe("usesWebSocket", () => {
    const createTask = () => {
      const alepha = Alepha.create().with({
        provide: FileSystemProvider,
        use: MemoryFileSystemProvider,
      });
      return alepha.inject(TestServerTask);
    };

    it("is true for a $websocket app", ({ expect }) => {
      expect(
        createTask().testUsesWebSocket(
          fakeAlephaWithPrimitives(["$websocket"]),
        ),
      ).toBe(true);
    });

    it("is true for a $room-only app", ({ expect }) => {
      expect(
        createTask().testUsesWebSocket(fakeAlephaWithPrimitives(["$room"])),
      ).toBe(true);
    });

    it("is false when neither primitive is registered", ({ expect }) => {
      expect(createTask().testUsesWebSocket(fakeAlephaWithPrimitives([]))).toBe(
        false,
      );
    });
  });
});
