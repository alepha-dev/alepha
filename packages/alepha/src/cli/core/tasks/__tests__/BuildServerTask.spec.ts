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
}

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
});
