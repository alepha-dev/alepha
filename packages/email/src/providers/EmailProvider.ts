/**
 * Email provider interface.
 *
 * All methods are asynchronous and return promises.
 */
export abstract class EmailProvider {
	/**
	 * Send an email.
	 *
	 * @param to The recipient email address.
	 * @param subject The email subject.
	 * @param body The email body (HTML content).
	 *
	 * @return Promise that resolves when the email is sent.
	 */
	public abstract send(
		to: string,
		subject: string,
		body: string,
	): Promise<void>;
}
