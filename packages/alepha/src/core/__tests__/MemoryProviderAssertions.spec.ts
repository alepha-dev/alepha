import { Alepha } from "alepha";
import { AlephaBucket, MemoryFileStorageProvider } from "alepha/bucket";
import { MemoryEmailProvider } from "alepha/email";
import { MemoryDestinationProvider } from "alepha/logger";
import { AlephaQueue, MemoryQueueProvider } from "alepha/queue";
import { describe, expect, it } from "vitest";

/**
 * The `was…` assertion helpers on the memory providers (quest #142).
 *
 * These exist so a spec states what the code under test DID rather than
 * reaching into a provider's internals and re-deriving it. Each case below
 * also pins the one judgement call the helper makes, because that is the part
 * a future edit could get wrong without any test noticing.
 */
describe("memory provider assertions", () => {
  describe("MemoryQueueProvider.wasEnqueued", () => {
    const setup = async () => {
      const alepha = Alepha.create().with(AlephaQueue);
      await alepha.start();
      return alepha.inject(MemoryQueueProvider);
    };

    it("reports a message that was pushed", async () => {
      const queue = await setup();
      await queue.push("emails", '{"to":"a@b.c"}');
      expect(queue.wasEnqueued("emails")).toBe(true);
      expect(queue.wasEnqueued("other")).toBe(false);
    });

    it("matches on the message body", async () => {
      const queue = await setup();
      await queue.push("emails", '{"to":"a@b.c"}');
      expect(queue.wasEnqueued("emails", "a@b.c")).toBe(true);
      expect(queue.wasEnqueued("emails", /"to":"a@b\.c"/)).toBe(true);
      expect(queue.wasEnqueued("emails", /nobody/)).toBe(false);
    });

    /**
     * ⚠️ The case the helper exists for. `pop` removes the entry, so a
     * `wasEnqueued` reading the queue would answer "no" for a message that was
     * enqueued and then consumed - which is the run most tests are about.
     */
    it("still reports a message after it has been consumed", async () => {
      const queue = await setup();
      await queue.push("emails", "one");
      expect(await queue.pop("emails")).toBe("one");
      expect(queue.wasEnqueued("emails", "one")).toBe(true);
    });
  });

  describe("MemoryEmailProvider.wasSent", () => {
    // Through a container, not `new`: the provider declares a `$logger()`,
    // which needs a context to resolve. `MemoryEmailProvider` is what a test
    // container binds by default, so injecting it directly is enough - the
    // same shape `$email.spec.ts` uses.
    const provider = async () => {
      const alepha = Alepha.create();
      const email = alepha.inject(MemoryEmailProvider);
      await alepha.start();
      return email;
    };

    it("reports a send, and matches the subject", async () => {
      const email = await provider();
      await email.send({
        to: "user@example.com",
        subject: "Verify your email",
        body: "<a href='/verify?code=1'>go</a>",
      });

      expect(email.wasSent("user@example.com")).toBe(true);
      expect(email.wasSent("user@example.com", /verify/i)).toBe(true);
      expect(email.wasSent("someone@else.com")).toBe(false);
      expect(email.wasSent("user@example.com", "Password")).toBe(false);
    });

    /**
     * One record per recipient, so a single send to three addresses answers
     * for each of them - which is what "did this person get the mail" means.
     */
    it("answers for every recipient of one send", async () => {
      const email = await provider();
      await email.send({
        to: ["a@example.com", "b@example.com"],
        subject: "Hello",
        body: "hi",
      });

      expect(email.wasSent("a@example.com")).toBe(true);
      expect(email.wasSent("b@example.com")).toBe(true);
    });

    it("matches the body, and the text alternative", async () => {
      const email = await provider();
      await email.send({
        to: "user@example.com",
        subject: "Verify",
        body: "<a href='/verify?code=42'>go</a>",
        text: "Plain: /verify?code=42",
      });

      expect(
        email.wasSentMatching("user@example.com", /\/verify\?code=42/),
      ).toBe(true);
      // The subject is deliberately NOT part of the body match: a subject is a
      // short deliberate string and a body is markup, and one loose match over
      // both would go green on the wrong thing.
      expect(email.wasSentMatching("user@example.com", /^Verify$/)).toBe(false);
    });
  });

  describe("MemoryDestinationProvider.wasLogged", () => {
    it("matches a message, and narrows by level", () => {
      const alepha = Alepha.create();
      const logs = alepha.inject(MemoryDestinationProvider);
      const write = (level: any, message: string) =>
        logs.write("", {
          level,
          message,
          service: "S",
          module: "m",
          timestamp: 0,
        });

      write("WARN", "Skipping KV initialization");
      write("ERROR", "Failed to check login rate limit");

      expect(logs.wasLogged(/Skipping KV/)).toBe(true);
      expect(logs.wasLogged("rate limit")).toBe(true);
      expect(logs.wasLogged(/rate limit/, "ERROR")).toBe(true);
      // The level narrows rather than being ignored: this is the difference
      // between "it warned" and "it failed", which is usually the assertion.
      expect(logs.wasLogged(/rate limit/, "WARN")).toBe(false);
      expect(logs.wasLogged(/never happened/)).toBe(false);
    });
  });

  describe("MemoryFileStorageProvider.wasUploaded", () => {
    const setup = async () => {
      const alepha = Alepha.create().with(AlephaBucket);
      await alepha.start();
      return alepha.inject(MemoryFileStorageProvider);
    };

    it("reports an upload, by bucket and by id", async () => {
      const storage = await setup();
      const fileId = await storage.upload(
        "avatars",
        new File(["bytes"], "a.png", { type: "image/png" }),
      );

      expect(storage.wasUploaded("avatars")).toBe(true);
      expect(storage.wasUploaded("avatars", fileId)).toBe(true);
      expect(storage.wasUploaded("avatars", "not-this-one")).toBe(false);
      expect(storage.wasUploaded("documents")).toBe(false);
    });

    /**
     * Documented rather than worked around: this provider keeps no call log,
     * so it answers about what is STORED. A test that needs "was uploaded at
     * some point" has to assert before the delete.
     */
    it("answers false once the file is deleted", async () => {
      const storage = await setup();
      const fileId = await storage.upload(
        "avatars",
        new File(["bytes"], "a.png", { type: "image/png" }),
      );
      await storage.delete("avatars", fileId);

      expect(storage.wasUploaded("avatars", fileId)).toBe(false);
    });
  });
});
