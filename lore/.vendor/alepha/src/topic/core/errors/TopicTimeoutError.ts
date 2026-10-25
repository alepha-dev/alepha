import { $error, z } from "alepha";

/**
 * A topic `wait` that saw no matching message before its timeout.
 */
export const TopicTimeoutError = $error({
  name: "TOPIC_TIMEOUT",
  schema: z.object({ topic: z.text(), timeout: z.number() }),
  message: (data) =>
    `Timeout of ${data.timeout}ms exceeded for topic ${data.topic}`,
});

export type TopicTimeoutError = InstanceType<typeof TopicTimeoutError>;
