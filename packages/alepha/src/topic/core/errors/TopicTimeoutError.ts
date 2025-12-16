export class TopicTimeoutError extends Error {
  public readonly topic: string;
  public readonly timeout: number;

  constructor(topic: string, timeout: number) {
    super(`Timeout of ${timeout}ms exceeded for topic ${topic}`);
    this.timeout = timeout;
    this.topic = topic;
  }
}
