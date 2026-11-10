import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, expect, it } from "vitest";

import { EmailError } from "../errors/EmailError.ts";
import {
  LocalEmailProvider,
  localEmailOptions,
} from "../providers/LocalEmailProvider.ts";

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

const DEFAULT_DIRECTORY = localEmailOptions.options.default.directory;

describe("LocalEmailProvider", () => {
  describe("send", () => {
    it("should successfully send email to local file", async () => {
      const alepha = Alepha.create()
        .with({ provide: DateTimeProvider, use: StoppedClock })
        .with({
          provide: FileSystemProvider,
          use: MemoryFileSystemProvider,
        });

      const provider = alepha.inject(LocalEmailProvider);
      const memoryFs = alepha.inject(MemoryFileSystemProvider);
      await alepha.start();

      const to = "test@example.com";
      const subject = "Test Subject";
      const body = "<p>Test body</p>";

      await provider.send({
        to,
        subject,
        body,
      });

      expect(memoryFs.writeFileCalls).toHaveLength(1);
      expect(memoryFs.writeFileCalls[0].path).toContain("test@example.com");

      const written = JSON.parse(memoryFs.writeFileCalls[0].data as string);
      expect(written.to).toBe(to);
      expect(written.subject).toBe(subject);
      expect(written.body).toBe(body);
      expect(written.sentAt).toBeDefined();
    });

    it("should create proper filename with sanitized email and timestamp", async () => {
      const alepha = Alepha.create()
        .with({ provide: DateTimeProvider, use: StoppedClock })
        .with({
          provide: FileSystemProvider,
          use: MemoryFileSystemProvider,
        });

      const provider = alepha.inject(LocalEmailProvider);
      const memoryFs = alepha.inject(MemoryFileSystemProvider);
      await alepha.start();

      const to = "user+test@example.com";
      const subject = "Test Subject";
      const body = "<p>Test body</p>";

      await provider.send({
        to,
        subject,
        body,
      });

      expect(memoryFs.joinCalls).toHaveLength(1);
      expect(memoryFs.joinCalls[0]).toEqual([
        DEFAULT_DIRECTORY,
        "user_test@example.com,2023-01-01T12-00-00-000Z.eml.json",
      ]);
    });

    it("should sanitize special characters in email address", async () => {
      const alepha = Alepha.create()
        .with({ provide: DateTimeProvider, use: StoppedClock })
        .with({
          provide: FileSystemProvider,
          use: MemoryFileSystemProvider,
        });

      const provider = alepha.inject(LocalEmailProvider);
      const memoryFs = alepha.inject(MemoryFileSystemProvider);
      await alepha.start();

      const to = "user<script>@example.com";
      const subject = "Test Subject";
      const body = "<p>Test body</p>";

      await provider.send({
        to,
        subject,
        body,
      });

      expect(memoryFs.joinCalls).toHaveLength(1);
      expect(memoryFs.joinCalls[0][1]).toMatch(
        /user_script_@example\.com,.+\.eml\.json/,
      );
    });

    it("should create proper JSON content", async () => {
      const alepha = Alepha.create()
        .with({ provide: DateTimeProvider, use: StoppedClock })
        .with({
          provide: FileSystemProvider,
          use: MemoryFileSystemProvider,
        });

      const provider = alepha.inject(LocalEmailProvider);
      const memoryFs = alepha.inject(MemoryFileSystemProvider);
      await alepha.start();

      const to = "test@example.com";
      const subject = "Test <Subject>";
      const body = "<p>Test body with <strong>HTML</strong></p>";

      await provider.send({
        to,
        subject,
        body,
      });

      const content = JSON.parse(memoryFs.writeFileCalls[0].data as string);

      expect(content.to).toBe(to);
      expect(content.subject).toBe(subject);
      expect(content.body).toBe(body);
      expect(content.sentAt).toBe("2023-01-01T12:00:00.000Z");
    });

    it("should throw EmailError when writeFile fails", async () => {
      const alepha = Alepha.create()
        .with({ provide: DateTimeProvider, use: StoppedClock })
        .with({
          provide: FileSystemProvider,
          use: MemoryFileSystemProvider,
        });

      const provider = alepha.inject(LocalEmailProvider);
      const memoryFs = alepha.inject(MemoryFileSystemProvider);
      await alepha.start();

      memoryFs.writeFileError = new Error("Disk full");

      const to = "test@example.com";
      const subject = "Test Subject";
      const body = "<p>Test body</p>";

      await expect(
        provider.send({
          to,
          subject,
          body,
        }),
      ).rejects.toThrow(EmailError);

      await expect(
        provider.send({
          to,
          subject,
          body,
        }),
      ).rejects.toThrow("Failed to save email to local file: Disk full");
    });

    it("should handle non-Error exceptions", async () => {
      const alepha = Alepha.create()
        .with({ provide: DateTimeProvider, use: StoppedClock })
        .with({
          provide: FileSystemProvider,
          use: MemoryFileSystemProvider,
        });

      const provider = alepha.inject(LocalEmailProvider);
      const memoryFs = alepha.inject(MemoryFileSystemProvider);
      await alepha.start();

      memoryFs.writeFileError = "String error" as unknown as Error;

      const to = "test@example.com";
      const subject = "Test Subject";
      const body = "<p>Test body</p>";

      await expect(
        provider.send({
          to,
          subject,
          body,
        }),
      ).rejects.toThrow(EmailError);

      await expect(
        provider.send({
          to,
          subject,
          body,
        }),
      ).rejects.toThrow("Failed to save email to local file: String error");
    });

    it("should handle multiple recipients", async () => {
      const alepha = Alepha.create()
        .with({ provide: DateTimeProvider, use: StoppedClock })
        .with({
          provide: FileSystemProvider,
          use: MemoryFileSystemProvider,
        });

      const provider = alepha.inject(LocalEmailProvider);
      const memoryFs = alepha.inject(MemoryFileSystemProvider);
      await alepha.start();

      await provider.send({
        to: ["user1@example.com", "user2@example.com"],
        subject: "Broadcast",
        body: "<p>Hello all</p>",
      });

      expect(memoryFs.writeFileCalls).toHaveLength(2);
      expect(memoryFs.writeFileCalls[0].path).toContain("user1@example.com");
      expect(memoryFs.writeFileCalls[1].path).toContain("user2@example.com");
    });
  });

  describe("createEmailJson", () => {
    it("should return structured email data with sentAt timestamp", async () => {
      const alepha = Alepha.create()
        .with({ provide: DateTimeProvider, use: StoppedClock })
        .with({
          provide: FileSystemProvider,
          use: MemoryFileSystemProvider,
        });
      const provider = alepha.inject(LocalEmailProvider);
      await alepha.start();

      const result = provider.createEmailJson({
        to: "test@example.com",
        subject: "Test Subject",
        body: "<p>Test body</p>",
      });

      expect(result).toEqual({
        to: "test@example.com",
        subject: "Test Subject",
        body: "<p>Test body</p>",
        sentAt: "2023-01-01T12:00:00.000Z",
      });
    });
  });
});
