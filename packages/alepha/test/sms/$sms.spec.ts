import { Alepha } from "alepha";
import { describe, test } from "vitest";
import { $sms, MemorySmsProvider } from "../../src/sms";

describe("$sms", () => {
  test("should send SMS using descriptor", async ({ expect }) => {
    class TestService {
      readonly welcomeSms = $sms({ name: "welcome" });
    }

    const alepha = Alepha.create();
    const service = alepha.inject(TestService);
    await alepha.start();

    await service.welcomeSms.send({
      to: "+1234567890",
      message: "Hello World!",
    });

    const provider = alepha.inject(MemorySmsProvider);
    const messages = provider.records;

    expect(messages).toHaveLength(1);
    expect(messages[0].to).toBe("+1234567890");
    expect(messages[0].message).toBe("Hello World!");
  });

  test("should send SMS to multiple recipients", async ({ expect }) => {
    class TestService {
      readonly notificationSms = $sms();
    }

    const alepha = Alepha.create();
    const service = alepha.inject(TestService);
    await alepha.start();

    await service.notificationSms.send({
      to: ["+1234567890", "+0987654321"],
      message: "Important notification",
    });

    const provider = alepha.inject(MemorySmsProvider);
    const messages = provider.records;

    expect(messages).toHaveLength(2);
    expect(messages[0].to).toBe("+1234567890");
    expect(messages[1].to).toBe("+0987654321");
  });

  test("should use memory provider by default", async ({ expect }) => {
    class TestService {
      readonly sms = $sms();
    }

    const alepha = Alepha.create();
    const service = alepha.inject(TestService);
    await alepha.start();

    await service.sms.send({
      to: "+1234567890",
      message: "Test",
    });

    const provider = alepha.inject(MemorySmsProvider);
    expect(provider.records).toHaveLength(1);
  });

  test("should use explicit memory provider", async ({ expect }) => {
    class TestService {
      readonly sms = $sms({ provider: "memory" });
    }

    const alepha = Alepha.create();
    const service = alepha.inject(TestService);
    await alepha.start();

    await service.sms.send({
      to: "+1234567890",
      message: "Test",
    });

    const provider = alepha.inject(MemorySmsProvider);
    expect(provider.records).toHaveLength(1);
  });

  test("should emit sms:sending and sms:sent events", async ({ expect }) => {
    class TestService {
      readonly sms = $sms({ name: "test-sms" });
    }

    const alepha = Alepha.create();
    const service = alepha.inject(TestService);

    const sendingEvents: any[] = [];
    const sentEvents: any[] = [];

    alepha.events.on("sms:sending", (event) => {
      sendingEvents.push(event);
    });

    alepha.events.on("sms:sent", (event) => {
      sentEvents.push(event);
    });

    await alepha.start();

    await service.sms.send({
      to: "+1234567890",
      message: "Test message",
    });

    expect(sendingEvents).toHaveLength(1);
    expect(sendingEvents[0].to).toBe("+1234567890");
    expect(sendingEvents[0].template).toBe("test-sms");

    expect(sentEvents).toHaveLength(1);
    expect(sentEvents[0].to).toBe("+1234567890");
    expect(sentEvents[0].template).toBe("test-sms");
  });

  test("should abort SMS sending via hook", async ({ expect }) => {
    class TestService {
      readonly sms = $sms();
    }

    const alepha = Alepha.create();
    const service = alepha.inject(TestService);

    alepha.events.on("sms:sending", (event) => {
      event.abort();
    });

    await alepha.start();

    await expect(
      service.sms.send({
        to: "+1234567890",
        message: "Test",
      }),
    ).rejects.toThrowError("SMS sending aborted by hook");
  });

  test("should use property key as default name", async ({ expect }) => {
    class TestService {
      readonly welcomeSms = $sms();
    }

    const alepha = Alepha.create();
    const service = alepha.inject(TestService);

    let capturedTemplate = "";
    alepha.events.on("sms:sending", (event) => {
      capturedTemplate = event.template;
    });

    await alepha.start();

    await service.welcomeSms.send({
      to: "+1234567890",
      message: "Test",
    });

    expect(capturedTemplate).toBe("welcomeSms");
  });
});
