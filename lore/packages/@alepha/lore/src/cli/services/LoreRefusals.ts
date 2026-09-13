import { $inject, AlephaError } from "alepha";
import { CommandError } from "alepha/command";
import { ForbiddenError, HttpError, UnauthorizedError } from "alepha/server";

import { LoreClientService } from "./LoreClientService.ts";

/**
 * What a guarded command learned before it failed, for the sentence it fails
 * with. Filled in as the handler goes, which is why it is an object rather
 * than an argument known up front.
 */
export interface LoreRefusalContext {
  /**
   * The project the command resolved, as the caller named it.
   */
  project?: string;
}

/**
 * Turns the ways a `lore project`, `lore quest` or `lore folio` call is
 * refused into an exit code and a sentence naming the fix.
 *
 * | Cause | What arrives | Exit |
 * | --- | --- | --- |
 * | No credential | `CommandError` from {@link LoreClientService.authorization} | 3 |
 * | Credential not accepted | `UnauthorizedError` from the registry | 3 |
 * | App-scope permission missing | `ForbiddenError` from the registry | 4 |
 * | Project rank missing | `HttpError` 403 from the call | 4 |
 * | Unreachable remote | `AlephaError` from the registry fetch | 1 |
 *
 * ## ⚠️ Why every one of them needs translating
 *
 * `CliProvider` reports a `CommandError` as a reason and an exit code, and
 * rethrows anything else, which reaches `run()` as `Alepha failed to start`
 * plus a stack and exit 1. Before this, that is what every `lore` refusal
 * looked like, an expired credential included.
 *
 * ## Why here and not in `alepha/command`
 *
 * A remote call's error is an `HttpError`, which lives in `alepha/server`,
 * and the command module does not depend on it.
 *
 * ## ⚠️ The credential that is not accepted is the row a stub gets wrong
 *
 * `ServerSecurityProvider` swallows a bearer it cannot resolve and carries on
 * as anonymous, so `/api/_links` answers 200 with no secured action in it,
 * and the call fails as `Action getQuests not found.` A device token expires;
 * this is what that looks like. A self-hosted Lore older than the action says
 * the same thing, so the sentence names both.
 *
 * ## Registry refusals are told apart by CLASS
 *
 * `LinkProvider` throws `ForbiddenError` and `UnauthorizedError` itself,
 * before the action's request leaves. A refused request never arrives as
 * either: `HttpClient` builds the base `HttpError` from the response body. So
 * the subclass is the registry, and a bare status is the server.
 *
 * ⚠️ Not re-exported from `index.ts`: it is part of how the `lore` binary
 * behaves, not an API. The nine verbs older than epic #45 are not guarded by
 * it, deliberately: what each of `lore apps deploy`'s failures should exit
 * with is a different change.
 */
export class LoreRefusals {
  public static readonly EXIT_FAILURE = 1;
  public static readonly EXIT_NOT_AUTHENTICATED = 3;
  public static readonly EXIT_FORBIDDEN = 4;

  protected readonly client = $inject(LoreClientService);

  /**
   * Run a command's work, and fail with a translated refusal.
   *
   * ```ts
   * const context: LoreRefusalContext = {};
   * await this.refusals.guard(context, async () => {
   *   context.project = this.client.resolveProject(flags.project);
   *   ...
   * });
   * ```
   */
  public async guard<T>(
    context: LoreRefusalContext,
    work: () => Promise<T>,
  ): Promise<T> {
    try {
      return await work();
    } catch (error) {
      throw this.translate(error, context);
    }
  }

  /**
   * The refusal a caller should see for `error`, or `error` itself when it
   * is not one of the causes this knows.
   */
  public translate(error: unknown, context: LoreRefusalContext = {}): unknown {
    if (error instanceof CommandError) {
      return error;
    }

    const host = this.client.hostname();

    if (error instanceof ForbiddenError) {
      return new CommandError(
        `${error.message} The role of this account on ${host}, or the permission scope of LORE_API_KEY, does not grant ${this.actionOf(error)}.`,
        { cause: error, exitCode: LoreRefusals.EXIT_FORBIDDEN },
      );
    }

    if (error instanceof UnauthorizedError) {
      const action = this.actionOf(error);
      return new CommandError(
        `${error.message} Either the credential for ${host} was not accepted (it expired or was revoked: run \`lore login\` again, or check LORE_API_KEY), or this Lore does not have ${action}.`,
        { cause: error, exitCode: LoreRefusals.EXIT_NOT_AUTHENTICATED },
      );
    }

    if (HttpError.is(error, 401)) {
      return new CommandError(
        `${error.message} The credential for ${host} was not accepted: run \`lore login\` again, or check LORE_API_KEY.`,
        { cause: error, exitCode: LoreRefusals.EXIT_NOT_AUTHENTICATED },
      );
    }

    if (HttpError.is(error, 403)) {
      // The server's sentence already names the rank and who can grant it
      // (`RankService.refusal`). The project is the one thing it leaves out,
      // so it is prefixed and the sentence is never rewritten.
      return new CommandError(
        context.project
          ? `Project ${context.project}: ${error.message}`
          : error.message,
        { cause: error, exitCode: LoreRefusals.EXIT_FORBIDDEN },
      );
    }

    if (this.isUnreachable(error)) {
      return new CommandError(
        `Could not reach Lore at ${host}. Check LORE_URL, and that the instance is up.`,
        { cause: error, exitCode: LoreRefusals.EXIT_FAILURE },
      );
    }

    return error;
  }

  /**
   * The action a registry refusal names, from `LinkProvider`'s own sentence.
   */
  protected actionOf(error: Error): string {
    return /^Action (\S+) /.exec(error.message)?.[1] ?? "this action";
  }

  /**
   * The registry fetch failed, or a call never got an answer.
   *
   * Never exit 4, whatever the fetch's cause looked like: an unreachable
   * host is the failure most easily misread as a permission problem.
   */
  protected isUnreachable(error: unknown): boolean {
    if (
      error instanceof AlephaError &&
      error.message.startsWith("Could not fetch the action registry")
    ) {
      return true;
    }
    return error instanceof TypeError && error.message === "fetch failed";
  }
}
