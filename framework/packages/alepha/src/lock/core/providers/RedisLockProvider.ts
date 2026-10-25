import { $inject, Alepha } from "alepha";
import { $logger } from "alepha/logger";
import { RedisProvider, type RedisSetOptions } from "alepha/redis";

import { LockProvider } from "./LockProvider.ts";

/**
 * Locks over Redis `SET NX PX`.
 *
 * Every key is `<alepha.name>:lock:<key>`, here rather than in `$lock`, so a
 * caller of {@link LockProvider} that bypasses the primitive (the job cron
 * claims) is namespaced too. Two apps on one Redis never contend for each
 * other's locks; set `APP_NAME` to separate two environments of one app.
 */
export class RedisLockProvider extends LockProvider {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly redisProvider = $inject(RedisProvider);

  /**
   * The Redis key of a lock: `<alepha.name>:lock:<key>`.
   */
  public prefix(key: string): string {
    return `${this.alepha.name}:lock:${key}`;
  }

  public async set(
    key: string,
    value: string,
    nx?: boolean,
    px?: number,
  ): Promise<string> {
    const options: RedisSetOptions = {
      GET: true, // all the secrets of $lock is based on this
    };

    if (px) {
      options.expiration = {
        type: "PX",
        value: px,
      };
    }

    if (nx) {
      options.condition = "NX";
    }

    const resp = await this.redisProvider.set(this.prefix(key), value, options);

    return resp.toString("utf-8");
  }

  public async del(...keys: string[]): Promise<void> {
    await this.redisProvider.del(keys.map((key) => this.prefix(key)));
  }

  public async get(key: string): Promise<string | undefined> {
    const value = await this.redisProvider.get(this.prefix(key));
    return value?.toString("utf-8");
  }

  /**
   * Compare and delete in one server-side command.
   *
   * The inherited implementation reads the value, compares the owner, then
   * deletes: two round-trips, and the lock can expire and be taken by the
   * next contender in between. The delete then landed on SOMEBODY ELSE'S
   * lock, and two holders ran the guarded section at once, which is the one
   * thing a distributed lock exists to prevent.
   *
   * The value is `ownerId,<metadata...>`, so the script compares the segment
   * before the first comma rather than the whole string.
   */
  public override async delIfOwner(
    key: string,
    ownerId: string,
  ): Promise<boolean> {
    const deleted = await this.redisProvider.eval(
      RedisLockProvider.DEL_IF_OWNER,
      [this.prefix(key)],
      [ownerId],
    );

    return Number(deleted) === 1;
  }

  protected static readonly DEL_IF_OWNER = `
local value = redis.call("GET", KEYS[1])
if value == false then
  return 0
end
local sep = string.find(value, ",", 1, true)
local owner = value
if sep then
  owner = string.sub(value, 1, sep - 1)
end
if owner == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;
}
