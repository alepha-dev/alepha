import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Alepha } from "alepha";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { EmailError } from "../errors/EmailError.ts";
import {
  LocalEmailProvider,
  localEmailOptions,
} from "../providers/LocalEmailProvider.ts";

// Mock fs and path modules
vi.mock("node:fs/promises");
vi.mock("node:path");

const mockedFs = vi.mocked(fs);
const mockedPath = vi.mocked(path);

const DEFAULT_DIRECTORY = localEmailOptions.options.default.directory;

describe("LocalEmailProvider", () => {
  let alepha: Alepha;
  let provider: LocalEmailProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    // Setup default path.join mock
    mockedPath.join.mockImplementation((...args) => args.join("/"));
  });

  describe("send", () => {
    beforeEach(() => {
      alepha = Alepha.create();
      provider = alepha.inject(LocalEmailProvider);
    });

    test("should successfully send email to local file", async () => {
      mockedFs.mkdir.mockResolvedValue(undefined);
      mockedFs.writeFile.mockResolvedValue();

      const to = "test@example.com";
      const subject = "Test Subject";
      const body = "<p>Test body</p>";

      await provider.send({
        to,
        subject,
        body,
      });

      expect(mockedFs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining("test@example.com"),
        expect.stringContaining(subject),
        "utf8",
      );
    });

    test("should create proper filename with sanitized email and timestamp", async () => {
      mockedFs.mkdir.mockResolvedValue(undefined);
      mockedFs.writeFile.mockResolvedValue();

      const to = "user+test@example.com";
      const subject = "Test Subject";
      const body = "<p>Test body</p>";

      // Mock Date to have predictable timestamp
      const mockDate = new Date("2023-01-01T12:00:00.000Z");
      vi.setSystemTime(mockDate);

      await provider.send({
        to,
        subject,
        body,
      });

      expect(mockedPath.join).toHaveBeenCalledWith(
        DEFAULT_DIRECTORY,
        "user_test@example.com+2023-01-01T12-00-00-000Z.html",
      );

      vi.useRealTimers();
    });

    test("should sanitize special characters in email address", async () => {
      mockedFs.mkdir.mockResolvedValue(undefined);
      mockedFs.writeFile.mockResolvedValue();

      const to = "user<script>@example.com";
      const subject = "Test Subject";
      const body = "<p>Test body</p>";

      await provider.send({
        to,
        subject,
        body,
      });

      expect(mockedPath.join).toHaveBeenCalledWith(
        DEFAULT_DIRECTORY,
        expect.stringMatching(/user_script_@example\.com\+.+\.html/),
      );
    });

    test("should create proper HTML content", async () => {
      mockedFs.mkdir.mockResolvedValue(undefined);
      mockedFs.writeFile.mockResolvedValue();

      const to = "test@example.com";
      const subject = "Test <Subject>";
      const body = "<p>Test body with <strong>HTML</strong></p>";

      await provider.send({
        to,
        subject,
        body,
      });

      const writeCall = mockedFs.writeFile.mock.calls[0];
      const htmlContent = writeCall[1] as string;

      expect(htmlContent).toContain("<!DOCTYPE html>");
      expect(htmlContent).toContain("Test &lt;Subject&gt;"); // escaped subject
      expect(htmlContent).toContain("test@example.com");
      expect(htmlContent).toContain(
        "<p>Test body with <strong>HTML</strong></p>",
      ); // body not escaped
      expect(htmlContent).toContain("Sent:");
    });

    test("should throw EmailError when writeFile fails", async () => {
      mockedFs.mkdir.mockResolvedValue(undefined);
      const writeError = new Error("Disk full");
      mockedFs.writeFile.mockRejectedValue(writeError);

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

    test("should handle non-Error exceptions", async () => {
      mockedFs.mkdir.mockResolvedValue(undefined);
      mockedFs.writeFile.mockRejectedValue("String error");

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
  });

  describe("createEmailHtml", () => {
    beforeEach(() => {
      alepha = Alepha.create();
      provider = alepha.inject(LocalEmailProvider);
    });

    test("should create proper HTML structure", () => {
      const mockDate = new Date("2023-01-01T12:00:00.000Z");
      vi.setSystemTime(mockDate);

      const to = "test@example.com";
      const subject = "Test Subject";
      const body = "<p>Test body</p>";

      const html = provider.createEmailHtml({
        to,
        subject,
        body,
      });

      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain('<html lang="en">');
      expect(html).toContain("<head>");
      expect(html).toContain("<body>");
      expect(html).toContain("Test Subject");
      expect(html).toContain("test@example.com");
      expect(html).toContain("<p>Test body</p>");
      expect(html).toContain("2023-01-01T12:00:00.000Z");

      vi.useRealTimers();
    });

    test("should escape HTML in subject and email address", () => {
      const to = "test<script>@example.com";
      const subject = "Test <Subject> & More";
      const body = "<p>Test body</p>";

      const html = provider.createEmailHtml({
        to,
        subject,
        body,
      });

      expect(html).toContain("test&lt;script&gt;@example.com");
      expect(html).toContain("Test &lt;Subject&gt; &amp; More");
      expect(html).not.toContain("test<script>@example.com");
      expect(html).not.toContain("Test <Subject> & More");
    });

    test("should not escape HTML in body content", () => {
      const to = "test@example.com";
      const subject = "Test Subject";
      const body = "<p>Test body with <strong>HTML</strong> & entities</p>";

      const html = provider.createEmailHtml({
        to,
        subject,
        body,
      });

      expect(html).toContain(
        "<p>Test body with <strong>HTML</strong> & entities</p>",
      );
    });

    test("should include CSS styles", () => {
      const to = "test@example.com";
      const subject = "Test Subject";
      const body = "<p>Test body</p>";

      const html = provider.createEmailHtml({
        to,
        subject,
        body,
      });

      expect(html).toContain("<style>");
      expect(html).toContain("font-family: Arial, sans-serif");
      expect(html).toContain(".email-header");
      expect(html).toContain(".email-body");
      expect(html).toContain(".meta");
    });
  });

  describe("escapeHtml", () => {
    beforeEach(() => {
      alepha = Alepha.create();
      provider = alepha.inject(LocalEmailProvider);
    });

    test("should escape ampersands", () => {
      const result = provider.escapeHtml("Tom & Jerry");
      expect(result).toBe("Tom &amp; Jerry");
    });

    test("should escape less than signs", () => {
      const result = provider.escapeHtml("5 < 10");
      expect(result).toBe("5 &lt; 10");
    });

    test("should escape greater than signs", () => {
      const result = provider.escapeHtml("10 > 5");
      expect(result).toBe("10 &gt; 5");
    });

    test("should escape double quotes", () => {
      const result = provider.escapeHtml('Say "Hello"');
      expect(result).toBe("Say &quot;Hello&quot;");
    });

    test("should escape single quotes", () => {
      const result = provider.escapeHtml("Don't worry");
      expect(result).toBe("Don&#39;t worry");
    });

    test("should escape multiple special characters", () => {
      const result = provider.escapeHtml(
        '<script>alert("Hello & goodbye")</script>',
      );
      expect(result).toBe(
        "&lt;script&gt;alert(&quot;Hello &amp; goodbye&quot;)&lt;/script&gt;",
      );
    });

    test("should handle empty string", () => {
      const result = provider.escapeHtml("");
      expect(result).toBe("");
    });

    test("should handle string with no special characters", () => {
      const result = provider.escapeHtml("Hello World");
      expect(result).toBe("Hello World");
    });
  });
});
