import { describe, expect, test } from "vitest";
import { TemplateService } from "../src/services/TemplateService";

describe("TemplateService", () => {
	const templateService = new TemplateService();

	describe("compile", () => {
		test("should compile simple template with string values", () => {
			const template = "Hello {{name}}!";
			const values = { name: "John" };
			const result = templateService.compile(template, values);
			expect(result).toBe("Hello John!");
		});

		test("should compile template with multiple variables", () => {
			const template = "Hello {{name}}! You have {{count}} messages.";
			const values = { name: "Jane", count: 5 };
			const result = templateService.compile(template, values);
			expect(result).toBe("Hello Jane! You have 5 messages.");
		});

		test("should compile template with number values", () => {
			const template = "Issue #{{number}} - Score: {{score}}";
			const values = { number: 42, score: 95.5 };
			const result = templateService.compile(template, values);
			expect(result).toBe("Issue #42 - Score: 95.5");
		});

		test("should compile template with boolean values", () => {
			const template = "Active: {{isActive}}, Premium: {{isPremium}}";
			const values = { isActive: true, isPremium: false };
			const result = templateService.compile(template, values);
			expect(result).toBe("Active: true, Premium: false");
		});

		test("should leave undefined variables unchanged", () => {
			const template = "Hello {{name}}! Missing: {{missing}}";
			const values = { name: "John" };
			const result = templateService.compile(template, values);
			expect(result).toBe("Hello John! Missing: {{missing}}");
		});

		test("should handle template with no variables", () => {
			const template = "This is a simple message without variables.";
			const values = { unused: "value" };
			const result = templateService.compile(template, values);
			expect(result).toBe("This is a simple message without variables.");
		});

		test("should handle same variable used multiple times", () => {
			const template = "{{name}} said hello to {{name}} in the mirror.";
			const values = { name: "Alice" };
			const result = templateService.compile(template, values);
			expect(result).toBe("Alice said hello to Alice in the mirror.");
		});

		test("should handle empty string values", () => {
			const template = "Name: '{{name}}', Value: '{{value}}'";
			const values = { name: "", value: "test" };
			const result = templateService.compile(template, values);
			expect(result).toBe("Name: '', Value: 'test'");
		});

		test("should handle null values", () => {
			const template = "Value: {{value}}";
			const values = { value: null };
			const result = templateService.compile(template, values);
			expect(result).toBe("Value: null");
		});

		test("should handle zero values", () => {
			const template = "Count: {{count}}, Price: ${{price}}";
			const values = { count: 0, price: 0.0 };
			const result = templateService.compile(template, values);
			expect(result).toBe("Count: 0, Price: $0");
		});

		test("should compile template with spaces around variables", () => {
			const template = "Hello {{ name }}! You have {{ count }} messages.";
			const values = { name: "Jane", count: 5 };
			const result = templateService.compile(template, values);
			expect(result).toBe("Hello Jane! You have 5 messages.");
		});

		test("should compile template with mixed spacing styles", () => {
			const template =
				"Hello {{name}}! You have {{ count }} messages from {{ sender}}.";
			const values = { name: "John", count: 3, sender: "Alice" };
			const result = templateService.compile(template, values);
			expect(result).toBe("Hello John! You have 3 messages from Alice.");
		});

		test("should compile template with multiple spaces", () => {
			const template = "Hello {{  name  }}!";
			const values = { name: "Bob" };
			const result = templateService.compile(template, values);
			expect(result).toBe("Hello Bob!");
		});
	});

	describe("extractVariables", () => {
		test("should extract single variable", () => {
			const template = "Hello {{name}}!";
			const variables = templateService.extractVariables(template);
			expect(variables).toEqual(["name"]);
		});

		test("should extract multiple variables", () => {
			const template = "Hello {{name}}! You have {{count}} messages.";
			const variables = templateService.extractVariables(template);
			expect(variables).toEqual(["name", "count"]);
		});

		test("should extract duplicate variables only once", () => {
			const template = "{{name}} said hello to {{name}}.";
			const variables = templateService.extractVariables(template);
			expect(variables).toEqual(["name"]);
		});

		test("should return empty array for template with no variables", () => {
			const template = "This has no variables.";
			const variables = templateService.extractVariables(template);
			expect(variables).toEqual([]);
		});

		test("should handle complex variable names", () => {
			const template = "{{firstName}} {{lastName123}} {{item_count}}";
			const variables = templateService.extractVariables(template);
			expect(variables).toEqual(["firstName", "lastName123", "item_count"]);
		});

		test("should extract variables with spaces", () => {
			const template = "Hello {{ name }}! You have {{ count }} messages.";
			const variables = templateService.extractVariables(template);
			expect(variables).toEqual(["name", "count"]);
		});

		test("should extract variables with mixed spacing", () => {
			const template = "{{name}} {{ email }} {{  phone  }}";
			const variables = templateService.extractVariables(template);
			expect(variables).toEqual(["name", "email", "phone"]);
		});
	});

	describe("validateTemplate", () => {
		test("should return empty array when all variables are provided", () => {
			const template = "Hello {{name}}! You have {{count}} messages.";
			const values = { name: "John", count: 5 };
			const missing = templateService.validateTemplate(template, values);
			expect(missing).toEqual([]);
		});

		test("should return missing variables", () => {
			const template = "Hello {{name}}! You have {{count}} messages.";
			const values = { name: "John" };
			const missing = templateService.validateTemplate(template, values);
			expect(missing).toEqual(["count"]);
		});

		test("should return multiple missing variables", () => {
			const template =
				"Hello {{name}}! You have {{count}} messages from {{sender}}.";
			const values = { name: "John" };
			const missing = templateService.validateTemplate(template, values);
			expect(missing).toEqual(["count", "sender"]);
		});

		test("should return empty array for template with no variables", () => {
			const template = "This has no variables.";
			const values = {};
			const missing = templateService.validateTemplate(template, values);
			expect(missing).toEqual([]);
		});

		test("should handle duplicate variables correctly", () => {
			const template = "{{name}} said hello to {{name}}.";
			const values = {};
			const missing = templateService.validateTemplate(template, values);
			expect(missing).toEqual(["name"]);
		});

		test("should ignore extra values that are not used in template", () => {
			const template = "Hello {{name}}!";
			const values = { name: "John", extra: "unused" };
			const missing = templateService.validateTemplate(template, values);
			expect(missing).toEqual([]);
		});

		test("should validate template with spaces around variables", () => {
			const template = "Hello {{ name }}! You have {{ count }} messages.";
			const values = { name: "John" };
			const missing = templateService.validateTemplate(template, values);
			expect(missing).toEqual(["count"]);
		});
	});
});
