import { AlephaError } from "alepha";
import { BadRequestError } from "alepha/server";

import type { SearchHit } from "../schemas/searchHitSchema.ts";

/**
 * Everything linkable in Lore, by kind: the base of the core module (#E75,
 * #Q2610, folio #F1356).
 *
 * Core is the glue, and its resources are what it glues: a quest, an epic, a
 * release, a feedback item, a folio, a directory. Core owns the link graph
 * (`folio_links`, read by `ResourceLinkService`), search, and the actions that
 * cross two modules, but it reads no module's table. Each module registers its
 * kinds here instead, and core asks the registry:
 *
 * - a `[[#Q12]]` reference resolves through the kind that owns the letter
 *   `Q`, and renders as plain text when no module registered it;
 * - the ⌘K palette asks every kind that declares a search source;
 * - forwarding a blight asks the `quest` kind to `create`, and deleting a
 *   quest tells whoever subscribed to its `onDeleted`.
 *
 * An action needing a kind no module registered is refused by name
 * ({@link ResourceRegistry.require}), never resolved by importing the module.
 *
 * Entries are ordered by an explicit `order`, never by registration order:
 * module registration order is an accident of the entries, and search hits
 * and reference lists must not reshuffle when it changes.
 */
export class ResourceRegistry {
  protected readonly kinds = new Map<string, ResourceKind>();
  protected readonly deletionHandlers = new Map<
    string,
    Array<ResourceDeletionHandler>
  >();

  /**
   * One letter, then digits, and nothing else: the reference grammar
   * (`#Q12`), matched case-insensitively.
   */
  protected readonly REFERENCE = /^#([A-Za-z])(\d+)$/;

  /**
   * Register a kind. A kind is registered once, by the module that owns its
   * table, and a letter names one kind.
   */
  public register(kind: ResourceKind): void {
    if (this.kinds.has(kind.kind)) {
      throw new AlephaError(
        `Resource kind '${kind.kind}' is registered twice: one module owns each kind`,
      );
    }
    if (kind.letter) {
      const taken = this.byLetter(kind.letter);
      if (taken) {
        throw new AlephaError(
          `Reference letter '${kind.letter}' is claimed by both '${taken.kind}' and '${kind.kind}'`,
        );
      }
    }
    this.kinds.set(kind.kind, kind);
  }

  /**
   * The kind, or `undefined` when no registered module owns it.
   */
  public get(kind: string): ResourceKind | undefined {
    return this.kinds.get(kind);
  }

  /**
   * The kind, or a refusal naming what is missing: an action that needs a
   * kind from a module this build does not register.
   */
  public require(kind: string, action: string): ResourceKind {
    const found = this.kinds.get(kind);
    if (!found) {
      throw new BadRequestError(
        `Cannot ${action}: no module registers the '${kind}' resource here`,
      );
    }
    return found;
  }

  /**
   * Every registered kind, in `order`.
   */
  public all(): ResourceKind[] {
    return [...this.kinds.values()].sort((a, b) => a.order - b.order);
  }

  /**
   * The kind a reference letter names (case-insensitive), if any.
   */
  public byLetter(letter: string): ResourceKind | undefined {
    const upper = letter.toUpperCase();
    return [...this.kinds.values()].find((kind) => kind.letter === upper);
  }

  /**
   * Parse a typed reference, `#Q12`, into the kind and its per-project
   * number. `undefined` for anything else, including a letter no registered
   * kind claims: that reference is plain text here.
   */
  public parseReference(
    raw: string,
  ): { kind: string; number: number } | undefined {
    const match = this.REFERENCE.exec(raw.trim());
    if (!match) return undefined;
    const kind = this.byLetter(match[1]);
    if (!kind) return undefined;
    return { kind: kind.kind, number: Number.parseInt(match[2], 10) };
  }

  /**
   * The display refs of a kind's stored ids, or none when the kind is absent
   * or has nothing to describe them with.
   */
  public async describe(
    kind: string,
    projectId: number,
    ids: readonly string[],
  ): Promise<ResourceRef[]> {
    const found = this.kinds.get(kind);
    if (!found?.describe || ids.length === 0) return [];
    return found.describe(projectId, ids);
  }

  /**
   * Subscribe to the deletion of a kind's rows. The handler runs before the
   * row is removed, with the row still readable, and a throw fails the
   * delete. Allowed for a kind no module registered: the subscription simply
   * never fires.
   */
  public onDeleted(kind: string, handler: ResourceDeletionHandler): void {
    const handlers = this.deletionHandlers.get(kind) ?? [];
    handlers.push(handler);
    this.deletionHandlers.set(kind, handlers);
  }

  /**
   * Tell every subscriber that a row of this kind is being deleted. Called by
   * the owning module's delete path, before the row goes.
   */
  public async deleted(event: ResourceDeletion): Promise<void> {
    for (const handler of this.deletionHandlers.get(event.kind) ?? []) {
      await handler(event);
    }
  }
}

/**
 * One kind of linkable resource, as its module registers it.
 */
export interface ResourceKind {
  /**
   * The stored kind: `folio_links.target_type`, the search hit's `kind`.
   */
  kind: string;

  /**
   * Its reference letter, uppercase (`Q` for `#Q12`), when it has one. A kind
   * without a letter is never a `[[...]]` target.
   */
  letter?: string;

  /**
   * Position among the kinds: search hits and reference lists follow it.
   */
  order: number;

  /**
   * The permission that reads one: a ref, a search hit or a preview of this
   * kind is shown only to whoever holds it.
   */
  permission: string;

  /**
   * The page that shows one, by route name, and the params it takes from a
   * ref.
   */
  page?: {
    name: string;
    params: (ref: ResourceRef) => Record<string, string | number>;
    query?: (ref: ResourceRef) => Record<string, string>;
  };

  /**
   * Per-project numbers to the id `folio_links.to_id` stores for each: a
   * folio's UUID, every other kind's integer id as a string. A number nothing
   * answers to is absent from the map.
   */
  resolveNumbers?: (
    projectId: number,
    numbers: readonly number[],
  ) => Promise<Map<number, string>>;

  /**
   * Stored ids to display refs: the hover preview's and the links list's
   * shape. An id nothing answers to is absent.
   */
  describe?: (
    projectId: number,
    ids: readonly string[],
  ) => Promise<ResourceRef[]>;

  /**
   * What the ⌘K palette finds of this kind.
   */
  search?: ResourceSearchSource;

  /**
   * Create one, for an action that crosses modules (a blight forwarded to a
   * quest). Fields beyond the common ones are the kind's own.
   */
  create?: (input: ResourceCreateInput) => Promise<ResourceCreated>;

  /**
   * Hard-delete one that {@link ResourceKind.create} just made, when the
   * action that made it lost a race. Nothing points at it yet.
   */
  discard?: (id: number) => Promise<void>;
}

/**
 * One resource, as a reference list or a hover card shows it.
 */
export interface ResourceRef {
  id: string;
  /**
   * The per-project number it is addressed by: a `shortId`, or an epic's or
   * release's `number`.
   */
  shortId: number;
  title: string;
  /**
   * A release's tag, which is what its page is addressed by.
   */
  tag?: string;
  /**
   * The kind's own status, where it has one (an epic's `draft`...).
   */
  status?: string;
}

/**
 * What the palette finds of one kind.
 */
export interface ResourceSearchSource {
  /**
   * Found by its number only (`#E52`, a bare `52`), never by title.
   */
  numberOnly?: boolean;

  /**
   * The hits for one query, at most `limit` of them.
   */
  find: (query: ResourceSearchQuery) => Promise<SearchHit[]>;
}

export interface ResourceSearchQuery {
  projectId: number;
  /**
   * The query as typed, trimmed.
   */
  raw: string;
  /**
   * The query lowercased, for a column stored lowercased.
   */
  needle: string;
  /**
   * The per-project number this kind should pin, when the query is one
   * (`#Q42` for quests only, a bare `42` for every kind).
   */
  number?: number;
  limit: number;
}

export interface ResourceCreateInput {
  projectId: number;
  title: string;
  description?: string;
  createdBy: string;
  [field: string]: unknown;
}

export interface ResourceCreated {
  id: number;
  shortId: number;
}

export interface ResourceDeletion {
  kind: string;
  id: number | string;
  projectId: number;
  /**
   * The row as it was read before the delete, for a subscriber that needs
   * one of its fields (a quest's `source`).
   */
  row: Record<string, unknown>;
}

export type ResourceDeletionHandler = (
  event: ResourceDeletion,
) => Promise<void>;
