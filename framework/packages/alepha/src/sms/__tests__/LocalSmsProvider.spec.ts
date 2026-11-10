import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { beforeEach, describe, expect, it } from "vitest";

import { SmsError } from "../errors/SmsError.ts";
import {
  LocalSmsProvider,
  localSmsOptions,
} from "../providers/LocalSmsProvider.ts";

/**
 * A clock stopped at one instant, so a timestamp built into a filename is
 * predictable.
 */
class StoppedClock extends DateTimeProvider {
  public static readonly at = "2023-01-01T12:00:00.000Z";

  protected override getCurrentDate() {
    return this.of(StoppedClock.at);
  }

  public override nowISOString(): string {
    return StoppedClock.at;
  }

  public override nowMillis(): number {
    return this.of(StoppedClock.at).valueOf();
  }
}

// ---------------------------------------------------------------------------------------------------------------------

describe("LocalSmsProvider", () => {
  describe("send", () => {
    it("should successfully send SMS to local file", async () => {
      const alepha = Alepha.create()
        .with({ provide: DateTimeProvider, use: StoppedClock })
        .with({
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

      const written = JSON.parse(memoryFs.writeFileCalls[0].data as string);
      expect(written.to).toBe("+1234567890");
      expect(written.message).toBe("Test message");
      expect(written.sentAt).toBeDefined();
    });

    it("should create proper filename with sanitized phone and timestamp", async () => {
      const alepha = Alepha.create()
        .with({ provide: DateTimeProvider, use: StoppedClock })
        .with({
          provide: FileSystemProvider,
          use: MemoryFileSystemProvider,
        });

      const provider = alepha.inject(LocalSmsProvider);
      const memoryFs = alepha.inject(MemoryFileSystemProvider);
      await alepha.start();

      await provider.send({
        to: "+1 (234) 567-8900",
        message: "Test message",
      });

      expect(memoryFs.joinCalls).toHaveLength(1);
      expect(memoryFs.joinCalls[0]).toEqual([
        "node_modules/.alepha/sms",
        "+1__234__567_8900,2023-01-01T12-00-00-000Z.sms.json",
      ]);
    });

    it("should sanitize special characters in phone number", async () => {
      const alepha = Alepha.create()
        .with({ provide: DateTimeProvider, use: StoppedClock })
        .with({
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
        /\+1_234_567_8900______123,.+\.sms\.json/,
      );
    });

    it("should create proper JSON content", async () => {
      const alepha = Alepha.create()
        .with({ provide: DateTimeProvider, use: StoppedClock })
        .with({
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

      const written = JSON.parse(memoryFs.writeFileCalls[0].data as string);
      expect(written.to).toBe("+1234567890");
      expect(written.message).toBe("Test message with content");
      expect(written.sentAt).toBe("2023-01-01T12:00:00.000Z");
    });

    it("should throw SmsError when mkdir fails", async () => {
      const alepha = Alepha.create()
        .with({ provide: DateTimeProvider, use: StoppedClock })
        .with({
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

    it("should throw SmsError when writeFile fails", async () => {
      const alepha = Alepha.create()
        .with({ provide: DateTimeProvider, use: StoppedClock })
        .with({
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

    it("should handle non-Error exceptions", async () => {
      const alepha = Alepha.create()
        .with({ provide: DateTimeProvider, use: StoppedClock })
        .with({
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

    it("should handle multiple recipients", async () => {
      const alepha = Alepha.create()
        .with({ provide: DateTimeProvider, use: StoppedClock })
        .with({
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

    it("should use custom directory when provided", async () => {
      const alepha = Alepha.create()
        .with({ provide: DateTimeProvider, use: StoppedClock })
        .with({
          provide: FileSystemProvider,
          use: MemoryFileSystemProvider,
        });

      // Through the atom, which is how an app configures it. It used to be a
      // constructor argument, reachable only by subclassing the provider -
      // which is exactly why nothing else in the process could read the
      // directory back.
      alepha.store.set(localSmsOptions.key, { directory: "custom-sms-dir" });

      const provider = alepha.inject(LocalSmsProvider);
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

  describe("createSmsJson", () => {
    let provider: LocalSmsProvider;

    beforeEach(async () => {
      const alepha = Alepha.create()
        .with({ provide: DateTimeProvider, use: StoppedClock })
        .with({
          provide: FileSystemProvider,
          use: MemoryFileSystemProvider,
        });
      provider = alepha.inject(LocalSmsProvider);
      await alepha.start();
    });

    it("should create proper JSON structure", () => {
      const result = provider.createSmsJson({
        to: "+1234567890",
        message: "Test message",
      });

      expect(result.to).toBe("+1234567890");
      expect(result.message).toBe("Test message");
      expect(result.sentAt).toBe("2023-01-01T12:00:00.000Z");
    });

    it("should handle multiline messages", () => {
      const result = provider.createSmsJson({
        to: "+1234567890",
        message: "Line 1\nLine 2\nLine 3",
      });

      expect(result.message).toBe("Line 1\nLine 2\nLine 3");
    });
  });
});
