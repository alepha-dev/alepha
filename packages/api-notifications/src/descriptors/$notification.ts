import {
	$inject,
	createDescriptor,
	Descriptor,
	KIND,
	type Static,
	type TObject,
} from "@alepha/core";
import { NotificationService } from "../services/NotificationService.ts";

export const $notification = <T extends TObject>(
	options: NotificationDescriptorOptions<T>,
) => createDescriptor(NotificationDescriptor<T>, options);

// ---------------------------------------------------------------------------------------------------------------------

export interface NotificationDescriptorOptions<T extends TObject>
	extends NotificationMessage<T> {
	name?: string;
	description?: string;
	category?: string;
	urgent?: boolean;
	sensitive?: boolean;
	translations?: {
		// e.g., "en", "fr", even "en-US"
		[lang: string]: NotificationMessage<T>;
	};
	schema: T;
}

// ---------------------------------------------------------------------------------------------------------------------

export class NotificationDescriptor<T extends TObject> extends Descriptor<
	NotificationDescriptorOptions<T>
> {
	protected readonly notificationService = $inject(NotificationService);

	public get name() {
		return this.options.name ?? `${this.config.propertyKey}`;
	}

	public async push(options: NotificationPushOptions<T>) {
		if (this.options.email) {
			await this.notificationService.createNotification({
				...options,
				type: "email",
				template: this.name,
			});
		}
	}
}

$notification[KIND] = NotificationDescriptor;

// ---------------------------------------------------------------------------------------------------------------------

export interface NotificationPushOptions<T extends TObject> {
	variables: Static<T>;
	contact: string;
}

export interface NotificationMessage<T extends TObject> {
	email?: {
		subject: string;
		body: string | ((variables: Static<T>) => string);
	};
	sms?: {
		message: string;
	};
}
