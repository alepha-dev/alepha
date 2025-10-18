import {
	AlephaError,
	createDescriptor,
	Descriptor,
	KIND,
	type Service,
	type Static,
	type TSchema,
} from "@alepha/core";
import { $logger } from "@alepha/logger";
import { EmailProvider } from "../providers/EmailProvider.ts";
import { MemoryEmailProvider } from "../providers/MemoryEmailProvider.ts";
import { TemplateService } from "../services/TemplateService.ts";

/**
 * Creates an email descriptor for sending type-safe templated emails.
 *
 * The $email descriptor provides a powerful templating system for creating and sending emails
 * with full type safety and validation. It supports multiple email providers, template variable
 * validation, and automatic HTML rendering.
 *
 * **Template Engine**
 * - Simple {{variable}} or {{ variable }} syntax for dynamic content
 * - Automatic template variable validation at runtime
 * - Support for nested object properties in templates
 * - HTML email support with rich formatting
 *
 * **Type Safety**
 * - Full TypeScript support with schema validation using TypeBox
 * - Compile-time type checking for template variables
 * - Runtime validation of email data before sending
 * - Automatic type inference from schema definitions
 *
 * **Provider Flexibility**
 * - Memory provider for development and testing
 * - Support for SMTP, SendGrid, AWS SES, and other providers
 * - Custom provider implementation for specialized services
 * - Automatic fallback and error handling
 *
 * **Template Management**
 * - Reusable email templates across your application
 * - Centralized template configuration and maintenance
 * - Template variable documentation through schemas
 * - Easy testing and preview capabilities
 *
 * **Development Experience**
 * - Clear error messages for missing template variables
 * - Comprehensive logging for debugging email delivery
 * - Memory provider captures emails for testing
 * - Template validation before sending
 *
 * @example Welcome email template
 * ```typescript
 * const welcomeEmail = $email({
 *   subject: "Welcome to {{companyName}}, {{firstName}}!",
 *   body: `
 *     <h1>Welcome {{firstName}} {{lastName}}!</h1>
 *     <p>Thank you for joining {{companyName}}.</p>
 *     <p>Your account role is: <strong>{{role}}</strong></p>
 *     <p>Get started by visiting your <a href="{{dashboardUrl}}">dashboard</a>.</p>
 *   `,
 *   schema: t.object({
 *     firstName: t.text(),
 *     lastName: t.text(),
 *     companyName: t.text(),
 *     role: t.enum(["admin", "user", "manager"]),
 *     dashboardUrl: t.text()
 *   })
 * });
 *
 * // Send with full type safety
 * await welcomeEmail.send("user@example.com", {
 *   firstName: "John",
 *   lastName: "Doe",
 *   companyName: "Acme Corp",
 *   role: "user",
 *   dashboardUrl: "https://app.acme.com/dashboard"
 * });
 * ```
 *
 * @example Order confirmation email
 * ```typescript
 * const orderConfirmation = $email({
 *   subject: "Order #{{orderNumber}} confirmed - {{totalAmount}}",
 *   body: `
 *     <h1>Order Confirmed!</h1>
 *     <p>Hi {{customerName}},</p>
 *     <p>Your order #{{orderNumber}} has been confirmed.</p>
 *     <h2>Order Details:</h2>
 *     <p><strong>Total: {{totalAmount}}</strong></p>
 *     <p>Estimated delivery: {{deliveryDate}}</p>
 *   `,
 *   schema: t.object({
 *     customerName: t.text(),
 *     orderNumber: t.text(),
 *     totalAmount: t.text(),
 *     deliveryDate: t.text()
 *   })
 * });
 * ```
 *
 * @example Development with memory provider
 * ```typescript
 * const testEmail = $email({
 *   subject: "Test: {{subject}}",
 *   body: "<p>{{message}}</p>",
 *   provider: "memory", // Captures emails for testing
 *   schema: t.object({
 *     subject: t.text(),
 *     message: t.text()
 *   })
 * });
 *
 * // In tests - emails are captured, not actually sent
 * await testEmail.send("test@example.com", {
 *   subject: "Unit Test",
 *   message: "This email was captured for testing"
 * });
 * ```
 */
export const $email = <T extends TSchema>(
	options: EmailDescriptorOptions<T>,
): EmailDescriptor<T> => {
	return createDescriptor(EmailDescriptor<T>, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export interface EmailDescriptorOptions<T extends TSchema> {
	/**
	 * Email subject template. Supports {{variableName}} syntax.
	 */
	subject: string | ((payload: Static<T>) => string);

	/**
	 * Email body template (HTML content). Supports {{variableName}} syntax.
	 */
	body: string | ((payload: Static<T>) => string);

	/**
	 * Schema defining the structure of template variables.
	 */
	schema: T;

	/**
	 * Optional name of the email template.
	 * @default Descriptor key
	 */
	name?: string;

	/**
	 * Optional description of the email template.
	 */
	description?: string;

	/**
	 * Email provider to use. If not provided, the default provider will be used.
	 */
	provider?: Service<EmailProvider> | "memory";
}

// ---------------------------------------------------------------------------------------------------------------------

export class EmailDescriptor<T extends TSchema> extends Descriptor<
	EmailDescriptorOptions<T>
> {
	protected readonly log = $logger();
	protected readonly templateService = new TemplateService();
	public readonly provider = this.$provider();

	public get name(): string {
		return this.options.name ?? this.config.propertyKey;
	}

	/**
	 * Send an email using the template with the provided values.
	 *
	 * @param to Recipient email address
	 * @param values Template variable values
	 */
	public async send(to: string, values: Static<T>): Promise<void> {
		// Validate and parse the values using the schema
		const parsedValues = this.alepha.parse(this.options.schema, values);

		// Compile templates
		const subject = this.compileTemplate(this.options.subject, parsedValues);
		const body = this.compileTemplate(this.options.body, parsedValues);

		// Send the email
		await this.provider.send(to, subject, body);

		this.log.debug(`Sent email ${this.name} to ${to}`, {
			subject,
			values: parsedValues,
		});
	}

	protected compileTemplate(
		template: string | ((payload: Static<T>) => string),
		payload: Static<T>,
	): string {
		if (typeof template === "function") {
			return template(payload);
		}

		const keysMissing = this.templateService.validateTemplate(
			template,
			payload,
		);

		if (keysMissing.length > 0) {
			const missing = [...new Set([...keysMissing])];
			throw new AlephaError(
				`Missing template variables for email ${this.name}: ${missing.join(", ")}`,
			);
		}

		return this.templateService.compile(
			template,
			payload as Record<string, unknown>,
		);
	}

	protected $provider() {
		if (!this.options.provider) {
			return this.alepha.inject(EmailProvider);
		}
		if (this.options.provider === "memory") {
			return this.alepha.inject(MemoryEmailProvider);
		}
		return this.alepha.inject(this.options.provider);
	}
}

$email[KIND] = EmailDescriptor;
