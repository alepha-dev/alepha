export class TopicTimeoutError extends Error {
	constructor(
		public readonly topic: string,
		public readonly timeout: number,
	) {
		super(`Timeout of ${timeout}ms exceeded for topic ${topic}`);
	}
}
