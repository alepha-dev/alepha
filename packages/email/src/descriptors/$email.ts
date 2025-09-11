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
 * Create an email descriptor for sending templated emails.
 *
 * @example
 * ```ts
 * import { $email } from "@alepha/email";
 * import { Type } from "@alepha/core";
 *
 * class App {
 *   welcome = $email({
 *     subject: "Welcome {{name}}!",
 *     body: "<h1>Welcome {{name}}!</h1><p>Your role is {{role}}.</p>",
 *     schema: t.object({
 *       name: t.string(),
 *       role: t.string()
 *     })
 *   });
 *
 *   async sendWelcome(userEmail: string, name: string, role: string) {
 *     await this.welcome.send(userEmail, { name, role });
 *   }
 * }
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
