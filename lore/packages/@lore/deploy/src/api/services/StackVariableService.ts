import { $inject } from "alepha";
import { $repository } from "alepha/orm";
import { BadRequestError, NotFoundError } from "alepha/server";

import type { StackEnvironment } from "../entities/stackEnvironments.ts";
import {
  type StackVariable,
  stackVariables,
} from "../entities/stackVariables.ts";
import type { StackModel } from "../schemas/stackModelSchema.ts";
import { CredentialSealService } from "./CredentialSealService.ts";

/**
 * A stack environment's variables: sealed, write-only, opened only by the
 * deploy, and generated server-side on request so an `APP_SECRET`-style
 * value never passes through a terminal.
 */
export class StackVariableService {
  protected readonly rows = $repository(stackVariables);
  protected readonly seal = $inject(CredentialSealService);

  public static readonly MAX_VALUE_LENGTH = 5_000;
  public static readonly MAX_KEYS = 200;
  public static readonly MIN_MASKABLE_LENGTH = 12;
  public static readonly PREFIX_LENGTH = 4;

  /**
   * How long a generated value may be, in hex characters.
   */
  public static readonly MAX_GENERATED_LENGTH = 256;

  async list(environmentId: string): Promise<StackVariable[]> {
    return await this.rows.findMany({
      where: { environmentId: { eq: environmentId } },
      orderBy: { column: "key", direction: "asc" },
    });
  }

  /**
   * Sets one variable, or generates it: `generate` is the length in hex
   * characters of a random value made here, from the platform's CSPRNG.
   */
  async set(input: {
    environment: StackEnvironment;
    key: string;
    value?: string;
    generate?: number;
    updatedBy?: string;
  }): Promise<StackVariable> {
    const key = this.assertKey(input.key);
    if ((input.value === undefined) === (input.generate === undefined)) {
      throw new BadRequestError(
        `Give ${key} either a value or generate, not both and not neither`,
      );
    }
    const value =
      input.generate !== undefined
        ? this.generate(input.generate)
        : (input.value ?? "");
    if (!value || value.length > StackVariableService.MAX_VALUE_LENGTH) {
      throw new BadRequestError(
        `${key} needs a value of at most ${StackVariableService.MAX_VALUE_LENGTH} characters`,
      );
    }
    const existing = await this.rows.findOne({
      where: { environmentId: { eq: input.environment.id }, key: { eq: key } },
    });
    const patch = {
      valueSealed: await this.seal.seal(
        value,
        CredentialSealService.APP_SECRETS_PURPOSE,
      ),
      valuePrefix: input.generate !== undefined ? "" : this.mask(value),
      generated: input.generate !== undefined,
      keyVersion: CredentialSealService.KEY_VERSION,
    };
    if (existing) {
      return await this.rows.updateById(existing.id, {
        ...patch,
        updatedBy: input.updatedBy ?? null,
      });
    }
    const count = (await this.list(input.environment.id)).length;
    if (count >= StackVariableService.MAX_KEYS) {
      throw new BadRequestError(
        `This environment already has ${StackVariableService.MAX_KEYS} variables`,
      );
    }
    return await this.rows.create({
      environmentId: input.environment.id,
      key,
      ...patch,
      updatedBy: input.updatedBy,
    });
  }

  async remove(environment: StackEnvironment, key: string): Promise<void> {
    const existing = await this.rows.findOne({
      where: { environmentId: { eq: environment.id }, key: { eq: key } },
    });
    if (!existing) {
      throw new NotFoundError(`${key} is not set in this environment`);
    }
    await this.rows.deleteById(existing.id);
  }

  /**
   * The opened set, for the deploy and nothing else.
   */
  async open(environmentId: string): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const row of await this.list(environmentId)) {
      out[row.key] = await this.seal.open(
        row.valueSealed,
        CredentialSealService.APP_SECRETS_PURPOSE,
      );
    }
    return out;
  }

  /**
   * Refuses a revision whose compose file interpolates a required variable
   * this environment has not set, naming every one, before anything is
   * dispatched to an estate. Reads names only: no value is opened.
   */
  async assertComplete(
    model: StackModel,
    environment: StackEnvironment,
    stackName: string,
  ): Promise<void> {
    const set = new Set((await this.list(environment.id)).map((r) => r.key));
    const missing = model.variables
      .filter((v) => v.required && !set.has(v.name))
      .map((v) => v.name);
    if (missing.length > 0) {
      throw new BadRequestError(
        `${stackName}/${environment.env} has no value for ${missing.join(", ")}, which the compose file needs: set ${missing.length === 1 ? "it" : "them"} first`,
      );
    }
  }

  protected assertKey(raw: string): string {
    const key = raw.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || key.length > 100) {
      throw new BadRequestError(
        `${raw} is not a variable name: letters, digits and underscores, not starting with a digit`,
      );
    }
    return key;
  }

  protected generate(length: number): string {
    if (
      !Number.isInteger(length) ||
      length < 16 ||
      length > StackVariableService.MAX_GENERATED_LENGTH
    ) {
      throw new BadRequestError(
        `A generated value is 16 to ${StackVariableService.MAX_GENERATED_LENGTH} hex characters long`,
      );
    }
    const bytes = crypto.getRandomValues(new Uint8Array(Math.ceil(length / 2)));
    return [...bytes]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, length);
  }

  protected mask(value: string): string {
    return value.length < StackVariableService.MIN_MASKABLE_LENGTH
      ? ""
      : value.slice(0, StackVariableService.PREFIX_LENGTH);
  }
}
