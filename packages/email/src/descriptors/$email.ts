import {
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
 * - Simple {{variable}} syntax for dynamic content
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
 *     firstName: t.string(),
 *     lastName: t.string(),
 *     companyName: t.string(),
 *     role: t.enum(["admin", "user", "manager"]),
 *     dashboardUrl: t.string()
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
 *     customerName: t.string(),
 *     orderNumber: t.string(),
 *     totalAmount: t.string(),
 *     deliveryDate: t.string()
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
 *     subject: t.string(),
 *     message: t.string()
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
	subject: string;

	/**
	 * Email body template (HTML content). Supports {{variableName}} syntax.
	 */
	body: string;

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

		// Validate template variables
		const subjectMissing = this.templateService.validateTemplate(
			this.options.subject,
			parsedValues as Record<string, unknown>,
		);
		const bodyMissing = this.templateService.validateTemplate(
			this.options.body,
			parsedValues as Record<string, unknown>,
		);

		if (subjectMissing.length > 0 || bodyMissing.length > 0) {
			const missing = [...new Set([...subjectMissing, ...bodyMissing])];
			throw new Error(
				`Missing template variables for email ${this.name}: ${missing.join(", ")}`,
			);
		}

		// Compile templates
		const subject = this.templateService.compile(
			this.options.subject,
			parsedValues as Record<string, unknown>,
		);
		const body = this.templateService.compile(
			this.options.body,
			parsedValues as Record<string, unknown>,
		);

		// Send the email
		await this.provider.send(to, subject, body);

		this.log.debug(`Sent email ${this.name} to ${to}`, {
			subject,
			values: parsedValues,
		});
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
