import { AlephaError } from "alepha";

/**
 * MQTT topic filter rules, shared by the clients and the memory broker.
 *
 * - `+` matches exactly one level, `#` the rest of the levels (last only).
 * - `$share/<group>/<filter>` is a shared subscription: the broker hands each
 *   message to one member of the group, and matching runs on `<filter>`.
 * - A filter starting with a wildcard never matches a topic starting with `$`
 *   (MQTT 5, 4.7.2), so `#` does not see `$SYS/...`.
 */
export class MqttTopicMatcher {
  /**
   * Whether a received topic matches a subscription filter.
   *
   * A `$share/<group>/` prefix is stripped first.
   */
  public matches(filter: string, topic: string): boolean {
    const pattern = this.parse(filter).filter;
    if (pattern === topic) {
      return true;
    }

    if (topic.startsWith("$") && (pattern[0] === "+" || pattern[0] === "#")) {
      return false;
    }

    const patternParts = pattern.split("/");
    const topicParts = topic.split("/");

    for (let i = 0; i < patternParts.length; i++) {
      const part = patternParts[i];

      if (part === "#") {
        return true;
      }

      if (i >= topicParts.length) {
        return false;
      }

      if (part !== "+" && part !== topicParts[i]) {
        return false;
      }
    }

    return patternParts.length === topicParts.length;
  }

  /**
   * Split a filter into its shared group (if any) and the filter proper.
   */
  public parse(filter: string): MqttParsedFilter {
    if (!filter.startsWith("$share/")) {
      return { filter };
    }

    const rest = filter.slice("$share/".length);
    const slash = rest.indexOf("/");
    const group = slash > 0 ? rest.slice(0, slash) : "";
    const inner = slash > 0 ? rest.slice(slash + 1) : "";

    if (!group || !inner || /[+#]/.test(group)) {
      throw new AlephaError(
        `Invalid shared subscription '${filter}': expected $share/<group>/<filter>`,
      );
    }

    return { group, filter: inner };
  }

  /**
   * Refuse a topic name that cannot be published to: empty, or holding a
   * wildcard.
   */
  public assertPublishable(topic: string): void {
    if (!topic || /[+#]/.test(topic)) {
      throw new AlephaError(
        `Invalid MQTT topic name '${topic}': a published topic holds no wildcard`,
      );
    }
  }
}

export interface MqttParsedFilter {
  /**
   * The shared subscription group, for a `$share/<group>/...` filter.
   */
  group?: string;

  /**
   * The filter that topics are matched against.
   */
  filter: string;
}
