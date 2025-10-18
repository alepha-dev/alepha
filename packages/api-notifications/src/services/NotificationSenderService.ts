import { $inject, Alepha, AlephaError } from "@alepha/core";
import { DateTimeProvider } from "@alepha/datetime";
import { EmailProvider } from "@alepha/email";
import { $logger } from "@alepha/logger";
import { $repository } from "@alepha/postgres";
import { $notification } from "../descriptors/$notification.ts";
import {
	type NotificationEntity,
	notifications,
} from "../entities/notifications.ts";

export class NotificationSenderService {
	protected readonly alepha = $inject(Alepha);
	protected readonly log = $logger();
	protected readonly notificationRepository = $repository(notifications);
	protected readonly dateTimeProvider = $inject(DateTimeProvider);
	protected readonly emailProvider = $inject(EmailProvider);

	public async send(notificationId: string | NotificationEntity) {
		const notification =
			typeof notificationId === "string"
				? await this.notificationRepository.findById(notificationId)
				: notificationId;

		if (notification.sentAt) {
			this.log.info(`Notification already sent`, {
				notificationId: notification.id,
			});
			return;
		}

		try {
			if (notification.type === "email") {
				await this.emailProvider.send(this.renderEmail(notification));
				notification.sentAt = this.dateTimeProvider.nowISOString();
			}
			// else if (sms)
			// else if (push)
			// else if (whatsapp)
			// ...
		} catch (e) {
			this.log.error("Failed to process notification", e);
			if (e instanceof Error) {
				notification.error = {
					at: this.dateTimeProvider.nowISOString(),
					name: e.name,
					message: e.message,
				};
			}
		} finally {
			await this.notificationRepository.save(notification);
		}
	}

	public renderEmail(notification: NotificationEntity) {
		if (notification.type !== "email") {
			throw new AlephaError("Notification is not of type email");
		}

		const variables = notification.variables || {};
		const contact = notification.contact;
		const template = this.alepha
			.descriptors($notification)
			.find((it) => it.name === notification.template);

		if (!template) {
			throw new AlephaError(
				`No notification template found for ${notification.template}`,
			);
		}

		const email = template.options.email;
		if (!email) {
			throw new AlephaError(
				`Notification template ${notification.template} has no email defined`,
			);
		}

		this.log.debug(
			`Rendering email for template ${notification.template} to ${contact}`,
			{ variables },
		);

		const subject = email.subject;

		const body =
			typeof email.body === "function"
				? email.body(variables as any)
				: email.body;

		return {
			to: contact,
			subject,
			body,
		};
	}
}
