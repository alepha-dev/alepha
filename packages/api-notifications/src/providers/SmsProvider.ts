export abstract class SmsProvider {
	public abstract send(options: SmsSendOptions): Promise<void>;
}

export interface SmsSendOptions {
	to: string;
	message: string;
}
