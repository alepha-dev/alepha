import { $logger } from "@alepha/logger";
import type { EmailProvider, EmailSendOptions } from "./EmailProvider.ts";

export interface EmailRecord {
	to: string;
	subject: string;
	body: string;
	sentAt: Date;
}

export class MemoryEmailProvider implements EmailProvider {
	protected readonly log = $logger();
	protected emails: EmailRecord[] = [];

	public async send(options: EmailSendOptions): Promise<void> {
		const { to, subject, body } = options;
		this.log.debug("Sending email to memory store", { to, subject });

		for (const recipient of Array.isArray(to) ? to : [to]) {
			this.emails.push({
				to: recipient,
				subject,
				body,
				sentAt: new Date(),
			});
		}
	}

	/**
	 * Get all emails sent through this provider (for testing purposes).
	 */
	public getEmails(): EmailRecord[] {
		return [...this.emails];
	}

	/**
	 * Clear all stored emails (for testing purposes).
	 */
	public clearEmails(): void {
		this.emails = [];
	}

	/**
	 * Get the last email sent (for testing purposes).
	 */
	public getLastEmail(): EmailRecord | undefined {
		return this.emails[this.emails.length - 1];
	}
}
