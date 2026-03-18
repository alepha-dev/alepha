import { AlephaError } from "alepha";

export class TopicTimeoutError extends AlephaError {
  public readonly topic: string;
  public readonly timeout: number;

  constructor(topic: string, timeout: number) {
    super(`Timeout of ${timeout}ms exceeded for topic ${topic}`);
    this.timeout = timeout;
    this.topic = topic;
  }
}
