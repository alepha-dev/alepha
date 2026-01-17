import { Alepha } from "alepha";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/file";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { SmsError } from "../errors/SmsError.ts";
import { LocalSmsProvider } from "./LocalSmsProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

describe("LocalSmsProvider", () => {
  describe("send", () => {
    test("should successfully send SMS to local file", async () => {
      const alepha = Alepha.create().with({
        provide: FileSystemProvider,
        use: MemoryFileSystemProvider,
      });

      const provider = alepha.inject(LocalSmsProvider);
      const memoryFs = alepha.inject(MemoryFileSystemProvider);
      await alepha.start();

      await provider.send({
        to: "+1234567890",
        message: "Test message",
      });

      expect(memoryFs.mkdirCalls).toHaveLength(1);
      expect(memoryFs.mkdirCalls[0].path).toBe("node_modules/.alepha/sms");
      expect(memoryFs.mkdirCalls[0].options).toEqual({ recursive: true });

      expect(memoryFs.writeFileCalls).toHaveLength(1);
      expect(memoryFs.writeFileCalls[0].path).toContain("+1234567890");
      expect(memoryFs.writeFileCalls[0].data).toContain("Test message");
    });

    test("should create proper filename with sanitized phone and timestamp", async () => {
      const alepha = Alepha.create().with({
        provide: FileSystemProvider,
        use: MemoryFileSystemProvider,
      });

      const provider = alepha.inject(LocalSmsProvider);
      const memoryFs = alepha.inject(MemoryFileSystemProvider);
      await alepha.start();

      // Mock Date to have predictable timestamp
      const mockDate = new Date("2023-01-01T12:00:00.000Z");
      vi.setSystemTime(mockDate);

      await provider.send({
        to: "+1 (234) 567-8900",
        message: "Test message",
      });

      expect(memoryFs.joinCalls).toHaveLength(1);
      expect(memoryFs.joinCalls[0]).toEqual([
        "node_modules/.alepha/sms",
        "+1__234__567_8900+2023-01-01T12-00-00-000Z.txt",
      ]);

      vi.useRealTimers();
    });

    test("should sanitize special characters in phone number", async () => {
      const alepha = Alepha.create().with({
        provide: FileSystemProvider,
        use: MemoryFileSystemProvider,
      });

      const provider = alepha.inject(LocalSmsProvider);
      const memoryFs = alepha.inject(MemoryFileSystemProvider);
      await alepha.start();

      await provider.send({
        to: "+1-234-567-8900 ext. 123",
        message: "Test message",
      });

      expect(memoryFs.joinCalls).toHaveLength(1);
      expect(memoryFs.joinCalls[0][1]).toMatch(
        /\+1_234_567_8900______123\+.+\.txt/,
      );
    });

    test("should create proper text content", async () => {
      const alepha = Alepha.create().with({
        provide: FileSystemProvider,
        use: MemoryFileSystemProvider,
      });

      const provider = alepha.inject(LocalSmsProvider);
      const memoryFs = alepha.inject(MemoryFileSystemProvider);
      await alepha.start();

      await provider.send({
        to: "+1234567890",
        message: "Test message with content",
      });

      const textContent = memoryFs.writeFileCalls[0].data;

      expect(textContent).toContain("SMS Message");
      expect(textContent).toContain("+1234567890");
      expect(textContent).toContain("Test message with content");
      expect(textContent).toContain("Sent:");
    });

    test("should throw SmsError when mkdir fails", async () => {
      const alepha = Alepha.create().with({
        provide: FileSystemProvider,
        use: MemoryFileSystemProvider,
      });

      const provider = alepha.inject(LocalSmsProvider);
      const memoryFs = alepha.inject(MemoryFileSystemProvider);
      await alepha.start();

      memoryFs.mkdirError = new Error("Permission denied");

      await expect(
        provider.send({
          to: "+1234567890",
          message: "Test message",
        }),
      ).rejects.toThrow(SmsError);

      await expect(
        provider.send({
          to: "+1234567890",
          message: "Test message",
        }),
      ).rejects.toThrow("Failed to save SMS to local file: Permission denied");
    });

    test("should throw SmsError when writeFile fails", async () => {
      const alepha = Alepha.create().with({
        provide: FileSystemProvider,
        use: MemoryFileSystemProvider,
      });

      const provider = alepha.inject(LocalSmsProvider);
      const memoryFs = alepha.inject(MemoryFileSystemProvider);
      await alepha.start();

      memoryFs.writeFileError = new Error("Disk full");

      await expect(
        provider.send({
          to: "+1234567890",
          message: "Test message",
        }),
      ).rejects.toThrow(SmsError);

      await expect(
        provider.send({
          to: "+1234567890",
          message: "Test message",
        }),
      ).rejects.toThrow("Failed to save SMS to local file: Disk full");
    });

    test("should handle non-Error exceptions", async () => {
      const alepha = Alepha.create().with({
        provide: FileSystemProvider,
        use: MemoryFileSystemProvider,
      });

      const provider = alepha.inject(LocalSmsProvider);
      const memoryFs = alepha.inject(MemoryFileSystemProvider);
      await alepha.start();

      // Simulate non-Error throw
      memoryFs.writeFileError = "String error" as unknown as Error;

      await expect(
        provider.send({
          to: "+1234567890",
          message: "Test message",
        }),
      ).rejects.toThrow(SmsError);
    });

    test("should handle multiple recipients", async () => {
      const alepha = Alepha.create().with({
        provide: FileSystemProvider,
        use: MemoryFileSystemProvider,
      });

      const provider = alepha.inject(LocalSmsProvider);
      const memoryFs = alepha.inject(MemoryFileSystemProvider);
      await alepha.start();

      await provider.send({
        to: ["+1111111111", "+2222222222"],
        message: "Broadcast message",
      });

      expect(memoryFs.writeFileCalls).toHaveLength(2);
      expect(memoryFs.writeFileCalls[0].path).toContain("+1111111111");
      expect(memoryFs.writeFileCalls[1].path).toContain("+2222222222");
    });

    test("should use custom directory when provided", async () => {
      const alepha = Alepha.create().with({
        provide: FileSystemProvider,
        use: MemoryFileSystemProvider,
      });

      class CustomLocalSmsProvider extends LocalSmsProvider {
        constructor() {
          super({ directory: "custom-sms-dir" });
        }
      }

      const provider = alepha.inject(CustomLocalSmsProvider);
      const memoryFs = alepha.inject(MemoryFileSystemProvider);
      await alepha.start();

      await provider.send({
        to: "+1234567890",
        message: "Test",
      });

      expect(memoryFs.mkdirCalls[0].path).toBe("custom-sms-dir");
      expect(memoryFs.joinCalls[0][0]).toBe("custom-sms-dir");
    });
  });

  describe("createSmsText", () => {
    let provider: LocalSmsProvider;

    beforeEach(async () => {
      const alepha = Alepha.create().with({
        provide: FileSystemProvider,
        use: MemoryFileSystemProvider,
      });
      provider = alepha.inject(LocalSmsProvider);
      await alepha.start();
    });

    test("should create proper text structure", () => {
      const mockDate = new Date("2023-01-01T12:00:00.000Z");
      vi.setSystemTime(mockDate);

      const text = provider.createSmsText({
        to: "+1234567890",
        message: "Test message",
      });

      expect(text).toContain("SMS Message");
      expect(text).toContain("+1234567890");
      expect(text).toContain("Test message");
      expect(text).toContain("2023-01-01T12:00:00.000Z");

      vi.useRealTimers();
    });

    test("should handle multiline messages", () => {
      const text = provider.createSmsText({
        to: "+1234567890",
        message: "Line 1\nLine 2\nLine 3",
      });

      expect(text).toContain("Line 1\nLine 2\nLine 3");
    });
  });
});
