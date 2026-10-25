import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { MemoryFileSystemProvider } from "../providers/MemoryFileSystemProvider.ts";

describe("the memory filesystem without Node globals", () => {
  it("reads, appends, copies and streams bytes without Buffer", async ({
    expect,
  }) => {
    const fs = Alepha.create().inject(MemoryFileSystemProvider);
    const previous = Object.getOwnPropertyDescriptor(globalThis, "Buffer");
    Object.defineProperty(globalThis, "Buffer", {
      value: undefined,
      writable: true,
      configurable: true,
    });
    try {
      await fs.writeFile("/source.txt", "hello");
      await fs.appendFile("/source.txt", new TextEncoder().encode(" world"));
      await fs.cp("/source.txt", "/copy.txt");
      expect(await fs.readTextFile("/copy.txt")).toBe("hello world");
      expect(fs.getFileContent("/source.txt")).toBe("hello world");
      expect(await fs.readFile("/copy.txt")).toBeInstanceOf(Uint8Array);
      const file = fs.createFile({ path: "/copy.txt" });
      expect(await file.text()).toBe("hello world");
      const chunks: Uint8Array[] = [];
      const reader = file.stream().getReader();
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        chunks.push(chunk.value);
      }
      expect(new TextDecoder().decode(chunks[0])).toBe("hello world");
      const streamed = fs.createFile({
        stream: file.stream(),
        name: "stream.txt",
      });
      expect(await streamed.text()).toBe("hello world");
      expect(new TextDecoder().decode(await streamed.arrayBuffer())).toBe(
        "hello world",
      );
      expect(await fs.createFile({ text: "text" }).text()).toBe("text");
      expect(await fs.createFile({ buffer: new Uint8Array([65]) }).text()).toBe(
        "A",
      );
      expect(
        await fs
          .createFile({ arrayBuffer: new Uint8Array([66]).buffer })
          .text(),
      ).toBe("B");
    } finally {
      if (previous) Object.defineProperty(globalThis, "Buffer", previous);
      else Reflect.deleteProperty(globalThis, "Buffer");
    }
  });
});
