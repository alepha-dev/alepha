import { Alepha } from "alepha";
import { $sms, MemorySmsProvider, SmsProvider } from "alepha/sms";
import { describe, test } from "vitest";

describe("MemorySmsProvider", () => {
  test("should store SMS in memory", async ({ expect }) => {
    class TestService {
      readonly sms = $sms();
    }

    const alepha = Alepha.create();
    const service = alepha.inject(TestService);
    await alepha.start();

    const provider = alepha.inject(MemorySmsProvider);

    await service.sms.send({
      to: "+1234567890",
      message: "Hello World!",
    });

    expect(provider.records).toHaveLength(1);
    expect(provider.records[0].to).toBe("+1234567890");
    expect(provider.records[0].message).toBe("Hello World!");
    expect(provider.records[0].sentAt).toBeInstanceOf(Date);
  });

  test("should handle multiple recipients", async ({ expect }) => {
    class TestService {
      readonly sms = $sms();
    }

    const alepha = Alepha.create();
    const service = alepha.inject(TestService);
    await alepha.start();

    const provider = alepha.inject(MemorySmsProvider);

    await service.sms.send({
      to: ["+1111111111", "+2222222222", "+3333333333"],
      message: "Broadcast message",
    });

    expect(provider.records).toHaveLength(3);
    expect(provider.records[0].to).toBe("+1111111111");
    expect(provider.records[1].to).toBe("+2222222222");
    expect(provider.records[2].to).toBe("+3333333333");
    expect(
      provider.records.every((r) => r.message === "Broadcast message"),
    ).toBe(true);
  });

  test("should return last SMS sent", async ({ expect }) => {
    class TestService {
      readonly sms = $sms();
    }

    const alepha = Alepha.create();
    const service = alepha.inject(TestService);
    await alepha.start();

    const provider = alepha.inject(MemorySmsProvider);

    await service.sms.send({
      to: "+1234567890",
      message: "First message",
    });

    await service.sms.send({
      to: "+0987654321",
      message: "Second message",
    });

    expect(provider.last).toBeDefined();
    expect(provider.last?.to).toBe("+0987654321");
    expect(provider.last?.message).toBe("Second message");
  });

  test("should return undefined for last when no messages", async ({
    expect,
  }) => {
    class TestService {
      readonly sms = $sms();
    }

    const alepha = Alepha.create();
    alepha.inject(TestService);
    await alepha.start();

    const provider = alepha.inject(MemorySmsProvider);

    expect(provider.last).toBeUndefined();
  });

  test("should be registered as default SmsProvider", async ({ expect }) => {
    class TestService {
      readonly sms = $sms();
    }

    const alepha = Alepha.create();
    alepha.inject(TestService);
    await alepha.start();

    const provider = alepha.inject(SmsProvider);

    expect(provider).toBeInstanceOf(MemorySmsProvider);
  });

  test("should accumulate messages across multiple sends", async ({
    expect,
  }) => {
    class TestService {
      readonly sms = $sms();
    }

    const alepha = Alepha.create();
    const service = alepha.inject(TestService);
    await alepha.start();

    const provider = alepha.inject(MemorySmsProvider);

    await service.sms.send({ to: "+1111111111", message: "Message 1" });
    await service.sms.send({ to: "+2222222222", message: "Message 2" });
    await service.sms.send({ to: "+3333333333", message: "Message 3" });

    expect(provider.records).toHaveLength(3);
    expect(provider.records.map((r) => r.message)).toEqual([
      "Message 1",
      "Message 2",
      "Message 3",
    ]);
  });

  test("should track sentAt timestamp for each message", async ({ expect }) => {
    class TestService {
      readonly sms = $sms();
    }

    const alepha = Alepha.create();
    const service = alepha.inject(TestService);
    await alepha.start();

    const provider = alepha.inject(MemorySmsProvider);

    const before = new Date();
    await service.sms.send({ to: "+1234567890", message: "Test" });
    const after = new Date();

    const sentAt = provider.records[0].sentAt;
    expect(sentAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(sentAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  test("should handle empty message", async ({ expect }) => {
    class TestService {
      readonly sms = $sms();
    }

    const alepha = Alepha.create();
    const service = alepha.inject(TestService);
    await alepha.start();

    const provider = alepha.inject(MemorySmsProvider);

    await service.sms.send({
      to: "+1234567890",
      message: "",
    });

    expect(provider.records).toHaveLength(1);
    expect(provider.records[0].message).toBe("");
  });

  test("should handle message with special characters", async ({ expect }) => {
    class TestService {
      readonly sms = $sms();
    }

    const alepha = Alepha.create();
    const service = alepha.inject(TestService);
    await alepha.start();

    const provider = alepha.inject(MemorySmsProvider);

    const specialMessage = "Hello! 🎉 Special chars: <>&\"'";
    await service.sms.send({
      to: "+1234567890",
      message: specialMessage,
    });

    expect(provider.records[0].message).toBe(specialMessage);
  });
});
