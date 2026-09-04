/**
 * A channel name as a reader should see it: `email` becomes "Email",
 * `discord` becomes "Discord", `sms` becomes "SMS".
 *
 * The acronym list is the whole reason this is not a plain title-caser:
 * humanizing `sms` gives "Sms", which is what a filter dropdown offering
 * "Email" beside "Sms" looks like. Everything else gets the generic
 * treatment, which is right for a word and is the best a list that has never
 * heard of the plugin can do.
 *
 * Display only. The value sent to the API is always the raw channel name.
 */
export const notificationChannelLabel = (channel: string): string => {
  const known: Record<string, string> = { sms: "SMS", mqtt: "MQTT" };
  const raw = channel.trim();
  if (!raw) return channel;
  return known[raw.toLowerCase()] ?? raw.charAt(0).toUpperCase() + raw.slice(1);
};
