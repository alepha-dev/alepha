import { Alepha } from "alepha";
import { $email, MemoryEmailProvider } from "alepha/email";
import { describe, test } from "vitest";

describe("$email", () => {
  test("should send email using primitive", async ({ expect }) => {
    class TestService {
      readonly welcomeEmail = $email({ name: "welcome" });
    }

    const alepha = Alepha.create();
    const service = alepha.inject(TestService);
    await alepha.start();

    await service.welcomeEmail.send({
      to: "test@example.com",
      subject: "Welcome!",
      body: "<p>Hello World!</p>",
    });

    const provider = alepha.inject(MemoryEmailProvider);
    const emails = provider.records;

    expect(emails).toHaveLength(1);
    expect(emails[0].to).toBe("test@example.com");
    expect(emails[0].subject).toBe("Welcome!");
    expect(emails[0].body).toBe("<p>Hello World!</p>");
  });

  test("should send email to multiple recipients", async ({ expect }) => {
    class TestService {
      readonly notificationEmail = $email();
    }

    const alepha = Alepha.create();
    const service = alepha.inject(TestService);
    await alepha.start();

    await service.notificationEmail.send({
      to: ["user1@example.com", "user2@example.com"],
      subject: "Notification",
      body: "<p>Important message</p>",
    });

    const provider = alepha.inject(MemoryEmailProvider);
    const emails = provider.records;

    expect(emails).toHaveLength(2);
    expect(emails[0].to).toBe("user1@example.com");
    expect(emails[1].to).toBe("user2@example.com");
  });

  test("should use memory provider by default", async ({ expect }) => {
    class TestService {
      readonly email = $email();
    }

    const alepha = Alepha.create();
    const service = alepha.inject(TestService);
    await alepha.start();

    await service.email.send({
      to: "test@example.com",
      subject: "Test",
      body: "Test",
    });

    const provider = alepha.inject(MemoryEmailProvider);
    expect(provider.records).toHaveLength(1);
  });

  test("should use explicit memory provider", async ({ expect }) => {
    class TestService {
      readonly email = $email({ provider: "memory" });
    }

    const alepha = Alepha.create();
    const service = alepha.inject(TestService);
    await alepha.start();

    await service.email.send({
      to: "test@example.com",
      subject: "Test",
      body: "Test",
    });

    const provider = alepha.inject(MemoryEmailProvider);
    expect(provider.records).toHaveLength(1);
  });

  test("should emit email:sending and email:sent events", async ({
    expect,
  }) => {
    class TestService {
      readonly email = $email({ name: "test-email" });
    }

    const alepha = Alepha.create();
    const service = alepha.inject(TestService);

    const sendingEvents: any[] = [];
    const sentEvents: any[] = [];

    alepha.events.on("email:sending", (event) => {
      sendingEvents.push(event);
    });

    alepha.events.on("email:sent", (event) => {
      sentEvents.push(event);
    });

    await alepha.start();

    await service.email.send({
      to: "test@example.com",
      subject: "Test",
      body: "Test body",
    });

    expect(sendingEvents).toHaveLength(1);
    expect(sendingEvents[0].to).toBe("test@example.com");
    expect(sendingEvents[0].template).toBe("test-email");

    expect(sentEvents).toHaveLength(1);
    expect(sentEvents[0].to).toBe("test@example.com");
    expect(sentEvents[0].template).toBe("test-email");
  });

  test("should abort email sending via hook", async ({ expect }) => {
    class TestService {
      readonly email = $email();
    }

    const alepha = Alepha.create();
    const service = alepha.inject(TestService);

    alepha.events.on("email:sending", (event) => {
      event.abort();
    });

    await alepha.start();

    await expect(
      service.email.send({
        to: "test@example.com",
        subject: "Test",
        body: "Test",
      }),
    ).rejects.toThrowError("Email sending aborted by hook");
  });

  test("should use property key as default name", async ({ expect }) => {
    class TestService {
      readonly welcomeEmail = $email();
    }

    const alepha = Alepha.create();
    const service = alepha.inject(TestService);

    let capturedTemplate = "";
    alepha.events.on("email:sending", (event) => {
      capturedTemplate = event.template;
    });

    await alepha.start();

    await service.welcomeEmail.send({
      to: "test@example.com",
      subject: "Test",
      body: "Test",
    });

    expect(capturedTemplate).toBe("welcomeEmail");
  });
});
