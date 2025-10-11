import { $env, $hook, t } from "@alepha/core";
import { $logger } from "@alepha/logger";
import type { Transporter } from "nodemailer";
import nodemailer from "nodemailer";
import { EmailError } from "../errors/EmailError.ts";
import type { EmailProvider } from "./EmailProvider.ts";

const envSchema = t.object({
	EMAIL_HOST: t.text({
		description: "SMTP server host",
	}),
	EMAIL_PORT: t.number({
		default: 587,
		description: "SMTP server port",
	}),
	EMAIL_USER: t.text({
		description: "SMTP authentication username",
	}),
	EMAIL_PASS: t.text({
		description: "SMTP authentication password",
	}),
	EMAIL_FROM: t.text({
		description: "Default from email address",
	}),
	EMAIL_SECURE: t.boolean({
		default: false,
		description: "Use secure connection (TLS)",
	}),
});

export interface NodemailerEmailProviderOptions {
	/**
	 * Custom transporter configuration.
	 * If provided, will override environment variables.
	 */
	transporter?: Transporter;

	/**
	 * Custom from email address.
	 * If not provided, will use EMAIL_FROM from environment.
	 */
	from?: string;

	/**
	 * Additional nodemailer options.
	 */
	options?: {
		pool?: boolean;
		maxConnections?: number;
		maxMessages?: number;
		rateDelta?: number;
		rateLimit?: number;
	};
}

export class NodemailerEmailProvider implements EmailProvider {
	protected readonly env = $env(envSchema);
	protected readonly log = $logger();
	protected transporter: Transporter;
	protected fromAddress: string;

	public readonly options: NodemailerEmailProviderOptions = {};

	constructor() {
		this.fromAddress = this.options.from ?? this.env.EMAIL_FROM;
		this.transporter = this.createTransporter();
	}

	public async send(to: string, subject: string, body: string): Promise<void> {
		this.log.debug("Sending email via Nodemailer", { to, subject });

		try {
			const mailOptions = {
				from: this.fromAddress,
				to,
				subject,
				html: body,
			};

			const result = await this.transporter.sendMail(mailOptions);

			this.log.info("Email sent successfully", {
				to,
				subject,
				messageId: result.messageId,
				response: result.response,
			});
		} catch (error) {
			const message = `Failed to send email via Nodemailer: ${error instanceof Error ? error.message : String(error)}`;
			this.log.error(message, { to, subject });
			throw new EmailError(message, error instanceof Error ? error : undefined);
		}
	}

	protected createTransporter(): Transporter {
		if (this.options.transporter) {
			return this.options.transporter;
		}

		const transporterConfig = {
			host: this.env.EMAIL_HOST,
			port: this.env.EMAIL_PORT,
			secure: this.env.EMAIL_SECURE,
			auth: {
				user: this.env.EMAIL_USER,
				pass: this.env.EMAIL_PASS,
			},
			...this.options.options,
		};

		this.log.debug("Creating Nodemailer transporter", {
			host: transporterConfig.host,
			port: transporterConfig.port,
			secure: transporterConfig.secure,
			user: transporterConfig.auth.user,
		});

		return nodemailer.createTransport(transporterConfig);
	}

	/**
	 * Verify the connection to the email server.
	 */
	public async verify(): Promise<boolean> {
		try {
			await this.transporter.verify();
			this.log.info("Email server connection verified");
			return true;
		} catch (error) {
			this.log.error("Email server connection failed", { error });
			return false;
		}
	}

	/**
	 * Close the transporter connection.
	 */
	public close(): void {
		this.transporter.close();
	}

	protected readonly onStart = $hook({
		on: "start",
		handler: () => this.verify(),
	});

	protected readonly onStop = $hook({
		on: "stop",
		handler: () => this.close(),
	});
}
