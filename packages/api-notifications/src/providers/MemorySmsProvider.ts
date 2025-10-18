import { SmsProvider, type SmsSendOptions } from "./SmsProvider.ts";

export interface SmsRecord {
	to: string;
	message: string;
	sentAt: Date;
}

export class MemorySmsProvider extends SmsProvider {
	protected records: SmsRecord[] = [];

	public async send(options: SmsSendOptions): Promise<void> {
		const { to, message } = options;
		this.records.push({
			to,
			message,
			sentAt: new Date(),
		});
	}
}
