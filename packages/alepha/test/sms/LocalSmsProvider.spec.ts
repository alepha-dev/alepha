import * as fs from "node:fs/promises";
import * as path from "node:path";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { SmsError } from "../../src/sms/errors/SmsError";
import { LocalSmsProvider } from "../../src/sms/providers/LocalSmsProvider";

// Mock fs and path modules
vi.mock("node:fs/promises");
vi.mock("node:path");

// Mock logger
vi.mock("alepha/logger", () => ({
  $logger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  }),
}));

const mockedFs = vi.mocked(fs);
const mockedPath = vi.mocked(path);

describe("LocalSmsProvider", () => {
  let provider: LocalSmsProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    // Setup default path.join mock
    mockedPath.join.mockImplementation((...args) => args.join("/"));
  });

  describe("send", () => {
    beforeEach(() => {
      provider = new LocalSmsProvider({ directory: "test-sms" });
    });

    test("should successfully send SMS to local file", async () => {
      mockedFs.mkdir.mockResolvedValue(undefined);
      mockedFs.writeFile.mockResolvedValue();

      const to = "+1234567890";
      const message = "Test message";

      await provider.send({
        to,
        message,
      });

      expect(mockedFs.mkdir).toHaveBeenCalledWith("test-sms", {
        recursive: true,
      });
      expect(mockedFs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining("+1234567890"),
        expect.stringContaining(message),
        "utf8",
      );
    });

    test("should create proper filename with sanitized phone and timestamp", async () => {
      mockedFs.mkdir.mockResolvedValue(undefined);
      mockedFs.writeFile.mockResolvedValue();

      const to = "+1 (234) 567-8900";
      const message = "Test message";

      // Mock Date to have predictable timestamp
      const mockDate = new Date("2023-01-01T12:00:00.000Z");
      vi.setSystemTime(mockDate);

      await provider.send({
        to,
        message,
      });

      expect(mockedPath.join).toHaveBeenCalledWith(
        "test-sms",
        "+1__234__567_8900+2023-01-01T12-00-00-000Z.txt",
      );

      vi.useRealTimers();
    });

    test("should sanitize special characters in phone number", async () => {
      mockedFs.mkdir.mockResolvedValue(undefined);
      mockedFs.writeFile.mockResolvedValue();

      const to = "+1-234-567-8900 ext. 123";
      const message = "Test message";

      await provider.send({
        to,
        message,
      });

      expect(mockedPath.join).toHaveBeenCalledWith(
        "test-sms",
        expect.stringMatching(/\+1_234_567_8900______123\+.+\.txt/),
      );
    });

    test("should create proper text content", async () => {
      mockedFs.mkdir.mockResolvedValue(undefined);
      mockedFs.writeFile.mockResolvedValue();

      const to = "+1234567890";
      const message = "Test message with content";

      await provider.send({
        to,
        message,
      });

      const writeCall = mockedFs.writeFile.mock.calls[0];
      const textContent = writeCall[1] as string;

      expect(textContent).toContain("SMS Message");
      expect(textContent).toContain("+1234567890");
      expect(textContent).toContain("Test message with content");
      expect(textContent).toContain("Sent:");
    });

    test("should throw SmsError when mkdir fails", async () => {
      const mkdirError = new Error("Permission denied");
      mockedFs.mkdir.mockRejectedValue(mkdirError);

      const to = "+1234567890";
      const message = "Test message";

      await expect(
        provider.send({
          to,
          message,
        }),
      ).rejects.toThrow(SmsError);
      await expect(
        provider.send({
          to,
          message,
        }),
      ).rejects.toThrow("Failed to save SMS to local file: Permission denied");
    });

    test("should throw SmsError when writeFile fails", async () => {
      mockedFs.mkdir.mockResolvedValue(undefined);
      const writeError = new Error("Disk full");
      mockedFs.writeFile.mockRejectedValue(writeError);

      const to = "+1234567890";
      const message = "Test message";

      await expect(
        provider.send({
          to,
          message,
        }),
      ).rejects.toThrow(SmsError);
      await expect(
        provider.send({
          to,
          message,
        }),
      ).rejects.toThrow("Failed to save SMS to local file: Disk full");
    });

    test("should handle non-Error exceptions", async () => {
      mockedFs.mkdir.mockResolvedValue(undefined);
      mockedFs.writeFile.mockRejectedValue("String error");

      const to = "+1234567890";
      const message = "Test message";

      await expect(
        provider.send({
          to,
          message,
        }),
      ).rejects.toThrow(SmsError);
      await expect(
        provider.send({
          to,
          message,
        }),
      ).rejects.toThrow("Failed to save SMS to local file: String error");
    });
  });

  describe("createSmsText", () => {
    beforeEach(() => {
      provider = new LocalSmsProvider();
    });

    test("should create proper text structure", () => {
      const mockDate = new Date("2023-01-01T12:00:00.000Z");
      vi.setSystemTime(mockDate);

      const to = "+1234567890";
      const message = "Test message";

      const text = provider.createSmsText({
        to,
        message,
      });

      expect(text).toContain("SMS Message");
      expect(text).toContain("+1234567890");
      expect(text).toContain("Test message");
      expect(text).toContain("2023-01-01T12:00:00.000Z");

      vi.useRealTimers();
    });

    test("should handle multiline messages", () => {
      const to = "+1234567890";
      const message = "Line 1\nLine 2\nLine 3";

      const text = provider.createSmsText({
        to,
        message,
      });

      expect(text).toContain("Line 1\nLine 2\nLine 3");
    });
  });
});
