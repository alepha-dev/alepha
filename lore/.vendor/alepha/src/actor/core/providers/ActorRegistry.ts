import { AlephaError } from "alepha";

import type { ActorDeclaration } from "../interfaces/ActorInterfaces.ts";

/**
 * Per-container declaration allowlist, independent of the local atom store.
 */
export class ActorRegistry {
  protected readonly declarations = new Map<string, ActorDeclaration>();

  public register(declaration: ActorDeclaration): void {
    const name = declaration.atom.key;
    if (!name) throw new AlephaError("Actor atom name must be nonempty");
    const previous = this.declarations.get(name);
    if (previous && previous !== declaration)
      throw new AlephaError(`Duplicate actor declaration '${name}'`);
    this.declarations.set(name, declaration);
  }

  public get(name: string): ActorDeclaration {
    const declaration = this.declarations.get(name);
    if (!declaration) throw new AlephaError(`Unknown actor '${name}'`);
    return declaration;
  }
}
