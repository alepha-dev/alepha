import { $atom, type Infer, z } from "alepha";

/**
 * Where this app is allowed to post, by name.
 *
 * ⚠️ **The webhook URL is a secret and lives here, nowhere else.** It never
 * appears in template code, never in a queued outbox row, and never on a
 * delivery receipt: a receipt records `discord:alerts`, not the url that
 * anyone holding it could post to.
 *
 * Named destinations rather than one room per app, because release notes and
 * incident alerts hit that limit on the first real use. A template picks one
 * with `to`, and omitting `to` picks the one flagged `default`.
 *
 * @example
 * ```ts
 * alepha.set(discordOptions, {
 *   destinations: {
 *     alerts: { webhook: process.env.DISCORD_ALERTS!, default: true },
 *     releases: { webhook: process.env.DISCORD_RELEASES! },
 *   },
 * });
 * ```
 */
export const discordOptions = $atom({
  name: "alepha.notifications.discord.options",
  schema: z.object({
    destinations: z
      .record(
        z.text({ maxLength: 64 }),
        z.object({
          /**
           * The incoming webhook URL Discord issued for one channel.
           *
           * 512 rather than the default 255: a webhook url is around 120
           * characters today, and a cap that a provider can grow past is a
           * boot failure nobody can explain.
           */
          webhook: z.text({ maxLength: 512 }),
          /**
           * Use this destination for a template that names none. At most one
           * destination may declare it, checked at boot.
           */
          default: z.boolean().optional(),
          /**
           * Override the webhook's own name for messages sent here.
           */
          username: z.text({ maxLength: 80 }).optional(),
          /**
           * Override the webhook's own avatar, as an image url.
           */
          avatarUrl: z.text({ maxLength: 512 }).optional(),
        }),
      )
      .describe("Discord destinations this app may post to, by name."),
  }),
  default: {
    destinations: {},
  },
  // The value is a set of webhook urls. It must never reach the SSR
  // hydration payload or the devtools atom inspector.
  serverOnly: true,
});

export type DiscordOptions = Infer<typeof discordOptions.schema>;

export type DiscordDestination = DiscordOptions["destinations"][string];

declare module "alepha" {
  interface State {
    [discordOptions.key]: DiscordOptions;
  }
}
