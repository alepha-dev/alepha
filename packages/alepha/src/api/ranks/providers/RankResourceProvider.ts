import { AlephaError } from "alepha";
import { NotFoundError } from "alepha/server";

import type {
  RankResourcePrimitive,
  RankRows,
} from "../primitives/$rankResource.ts";

/**
 * The registry of `$rankResource` declarations, keyed by type.
 *
 * Separate from {@link RankService} for the reason
 * `InvitationResourceProvider` is separate from `InvitationService`: the
 * primitive registers into it at field-initialisation time, and everything
 * the service pulls in must not have to be constructed that early.
 */
export class RankResourceProvider {
  protected readonly resources = new Map<string, RankResourcePrimitive>();

  public register(primitive: RankResourcePrimitive): void {
    const existing = this.resources.get(primitive.type);
    if (existing && existing !== primitive) {
      // Refused rather than overwritten: two declarations for one type mean
      // two different answers to "what may this member do", and whichever
      // registered last would silently win.
      throw new AlephaError(
        `A rank resource of type "${primitive.type}" is already registered. ` +
          "Each type may have exactly one $rankResource.",
      );
    }
    this.resources.set(primitive.type, primitive);
  }

  /**
   * The declaration for a type, or a 404. A type nothing declares is, to the
   * caller, a scope this application does not have.
   */
  public get(type: string): RankResourcePrimitive {
    const resource = this.resources.get(type);
    if (!resource) {
      throw new NotFoundError(`No rank resource registered for type "${type}"`);
    }
    return resource;
  }

  public find(type: string): RankResourcePrimitive | undefined {
    return this.resources.get(type);
  }

  public get types(): string[] {
    return [...this.resources.keys()];
  }

  /**
   * The declaration these rows belong to, with the scope it derived.
   *
   * Each resource's own `scope` closure is what recognises its rows, which is
   * also what lets an application declare two of them: a closure that does
   * not recognise the shape in hand answers `undefined` and the next one is
   * asked. Nothing here inspects a row itself, because nothing here knows
   * what any of an application's rows look like.
   */
  public resolve(
    rows: RankRows,
  ): { resource: RankResourcePrimitive; scopeId: string } | undefined {
    for (const resource of this.resources.values()) {
      const scopeId = resource.options.scope(rows);
      if (scopeId) {
        return { resource, scopeId };
      }
    }
    return undefined;
  }
}
