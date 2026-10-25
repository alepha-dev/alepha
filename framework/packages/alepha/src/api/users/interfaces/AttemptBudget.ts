/**
 * The consume input of a `$rateLimit` whose limit comes from realm settings.
 *
 * Settings load asynchronously and limiter resolvers are synchronous, so the
 * caller loads them first and passes the numbers in with the key.
 */
export interface AttemptBudget {
  key: string;
  max: number;
  windowMs: number;
}
