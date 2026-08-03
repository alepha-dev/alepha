import {
  DuplicateProductKindError,
  UnknownProductKindError,
} from "../errors/CommerceError.ts";
import type { ProductKindHandler } from "../interfaces/ProductKindHandler.ts";

/**
 * Extension point letting any module teach the catalog a new kind of sellable
 * thing.
 *
 * A module adds its handler from its `register` hook:
 *
 * ```ts
 * $module({
 *   name: "myapp.pos",
 *   services: [WalletTopUpHandler],
 *   register: (alepha) => {
 *     alepha
 *       .inject(ProductKindRegistry)
 *       .add(alepha.inject(WalletTopUpHandler));
 *   },
 * });
 * ```
 *
 * Same shape as `RootComponentsProvider` in `alepha/react/router` — a plain
 * collection that modules contribute to, resolved at use time.
 */
export class ProductKindRegistry {
  protected readonly handlers = new Map<string, ProductKindHandler>();

  /**
   * Claim a kind. Throws on a duplicate rather than letting the last module
   * registered win: two modules silently fighting over `subscription` is a bug
   * that would only surface as wrong fulfilment, months later.
   */
  public add(handler: ProductKindHandler): void {
    if (this.handlers.has(handler.kind)) {
      throw new DuplicateProductKindError(handler.kind);
    }
    this.handlers.set(handler.kind, handler);
  }

  /**
   * Resolve a kind, or throw naming every kind that *is* registered — the
   * error a developer gets when they forgot to import the module that owns it.
   */
  public get(kind: string): ProductKindHandler {
    const handler = this.handlers.get(kind);
    if (!handler) {
      throw new UnknownProductKindError(kind, this.kinds());
    }
    return handler;
  }

  public has(kind: string): boolean {
    return this.handlers.has(kind);
  }

  /**
   * Every registered kind. What the admin UI offers in a product form, and what
   * the error above reports.
   */
  public kinds(): string[] {
    return [...this.handlers.keys()].sort();
  }
}
