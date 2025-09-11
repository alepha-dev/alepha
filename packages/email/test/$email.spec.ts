import { Alepha, t } from "@alepha/core";
import { describe, expect, test } from "vitest";
import { $email, AlephaEmail, MemoryEmailProvider } from "../src";

describe("@alepha/email - $email descriptor", () => {
	test("should send a simple templated email", async () => {
		class TestApp {
			welcome = $email({
				subject: "Welcome {{name}}!",
				body: "<h1>Welcome {{name}}!</h1><p>Your role is {{role}}.</p>",
				schema: t.object({
					name: t.string(),
					role: t.string(),
				}),
				provider: "memory",
			});
		}

		const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
			.with(AlephaEmail)
			.with(TestApp);

		await alepha.start();

		const app = alepha.inject(TestApp);
		const emailProvider = alepha.inject(MemoryEmailProvider);

		await app.welcome.send("user@example.com", {
			name: "John Doe",
			role: "Developer",
		});

		const emails = emailProvider.getEmails();
		expect(emails).toHaveLength(1);

		const email = emails[0];
		expect(email.to).toBe("user@example.com");
		expect(email.subject).toBe("Welcome John Doe!");
		expect(email.body).toBe(
			"<h1>Welcome John Doe!</h1><p>Your role is Developer.</p>",
		);
		expect(email.sentAt).toBeInstanceOf(Date);
	});

	test("should send email with number templates", async () => {
		class TestApp {
			newsletter = $email({
				subject: "Newsletter #{{issue}}",
				body: "<h2>Newsletter #{{issue}}</h2><p>Hello {{firstName}}, we have {{articleCount}} articles for you!</p>",
				schema: t.object({
					issue: t.number(),
					firstName: t.string(),
					articleCount: t.number(),
				}),
				provider: "memory",
			});
		}

		const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
			.with(AlephaEmail)
			.with(TestApp);

		await alepha.start();

		const app = alepha.inject(TestApp);
		const emailProvider = alepha.inject(MemoryEmailProvider);

		await app.newsletter.send("subscriber@example.com", {
			issue: 42,
			firstName: "Jane",
			articleCount: 5,
		});

		const email = emailProvider.getLastEmail();
		expect(email).toBeDefined();
		expect(email!.to).toBe("subscriber@example.com");
		expect(email!.subject).toBe("Newsletter #42");
		expect(email!.body).toBe(
			"<h2>Newsletter #42</h2><p>Hello Jane, we have 5 articles for you!</p>",
		);
	});

	test("should send email without template variables", async () => {
		class TestApp {
			simple = $email({
				subject: "Simple email",
				body: "This is a simple email without templates.",
				schema: t.object({}),
				provider: "memory",
			});
		}

		const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
			.with(AlephaEmail)
			.with(TestApp);

		await alepha.start();

		const app = alepha.inject(TestApp);
		const emailProvider = alepha.inject(MemoryEmailProvider);

		await app.simple.send("user@example.com", {});

		const email = emailProvider.getLastEmail();
		expect(email).toBeDefined();
		expect(email!.to).toBe("user@example.com");
		expect(email!.subject).toBe("Simple email");
		expect(email!.body).toBe("This is a simple email without templates.");
	});

	test("should throw error for missing template variables", async () => {
		class TestApp {
			welcome = $email({
				subject: "Welcome {{name}}!",
				body: "<h1>Welcome {{name}}!</h1><p>Your role is {{role}}.</p>",
				schema: t.object({
					name: t.string(),
					role: t.string(),
				}),
				provider: "memory",
			});
		}

		const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
			.with(AlephaEmail)
			.with(TestApp);

		await alepha.start();

		const app = alepha.inject(TestApp);

		await expect(
			app.welcome.send("user@example.com", {
				name: "John Doe",
				// Missing 'role' property
			} as any),
		).rejects.toThrow();
	});

	test("should throw error for schema validation failure", async () => {
		class TestApp {
			newsletter = $email({
				subject: "Newsletter #{{issue}}",
				body: "<h2>Newsletter #{{issue}}</h2><p>Hello {{firstName}}, we have {{articleCount}} articles for you!</p>",
				schema: t.object({
					issue: t.number(),
					firstName: t.string(),
					articleCount: t.number(),
				}),
				provider: "memory",
			});
		}

		const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
			.with(AlephaEmail)
			.with(TestApp);

		await alepha.start();

		const app = alepha.inject(TestApp);

		await expect(
			app.newsletter.send("subscriber@example.com", {
				issue: "not a number", // Should be a number
				firstName: "Jane",
				articleCount: 5,
			} as any),
		).rejects.toThrow();
	});

	test("should handle extra schema properties that are not used in templates", async () => {
		class TestApp {
			partial = $email({
				subject: "Hello {{name}}!",
				body: "Hello {{name}}!",
				schema: t.object({
					name: t.string(),
					extra: t.string(), // Not used in templates
				}),
				provider: "memory",
			});
		}

		const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
			.with(AlephaEmail)
			.with(TestApp);

		await alepha.start();

		const app = alepha.inject(TestApp);
		const emailProvider = alepha.inject(MemoryEmailProvider);

		await app.partial.send("user@example.com", {
			name: "John",
			extra: "not used", // This is allowed since it's in the schema
		});

		const email = emailProvider.getLastEmail();
		expect(email).toBeDefined();
		expect(email!.subject).toBe("Hello John!");
		expect(email!.body).toBe("Hello John!");
	});

	test("should use descriptor property key as default name", async () => {
		class TestApp {
			myCustomEmail = $email({
				subject: "Test",
				body: "Test body",
				schema: t.object({}),
				provider: "memory",
			});
		}

		const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
			.with(AlephaEmail)
			.with(TestApp);

		await alepha.start();

		const app = alepha.inject(TestApp);
		expect(app.myCustomEmail.name).toBe("myCustomEmail");
	});

	test("should use custom name when provided", async () => {
		class TestApp {
			email = $email({
				name: "Custom Email Template",
				subject: "Test",
				body: "Test body",
				schema: t.object({}),
				provider: "memory",
			});
		}

		const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
			.with(AlephaEmail)
			.with(TestApp);

		await alepha.start();

		const app = alepha.inject(TestApp);
		expect(app.email.name).toBe("Custom Email Template");
	});

	test("should send multiple emails and track them", async () => {
		class TestApp {
			welcome = $email({
				subject: "Welcome {{name}}!",
				body: "Hello {{name}}!",
				schema: t.object({
					name: t.string(),
				}),
				provider: "memory",
			});
		}

		const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
			.with(AlephaEmail)
			.with(TestApp);

		await alepha.start();

		const app = alepha.inject(TestApp);
		const emailProvider = alepha.inject(MemoryEmailProvider);

		await app.welcome.send("user1@example.com", { name: "John" });
		await app.welcome.send("user2@example.com", { name: "Jane" });
		await app.welcome.send("user3@example.com", { name: "Bob" });

		const emails = emailProvider.getEmails();
		expect(emails).toHaveLength(3);

		expect(emails[0].to).toBe("user1@example.com");
		expect(emails[0].subject).toBe("Welcome John!");
		expect(emails[1].to).toBe("user2@example.com");
		expect(emails[1].subject).toBe("Welcome Jane!");
		expect(emails[2].to).toBe("user3@example.com");
		expect(emails[2].subject).toBe("Welcome Bob!");
	});
});
