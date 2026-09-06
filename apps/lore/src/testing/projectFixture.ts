import {
  CAPABILITY_KEYS,
  type CapabilityKey,
} from "../api/schemas/capabilityKeySchema.ts";
import type { ProjectCapabilityResource } from "../api/schemas/projectCapabilityResourceSchema.ts";
import type { ProjectResource } from "../api/schemas/projectResourceSchema.ts";
import { CapabilityRegistry } from "../api/services/CapabilityRegistry.ts";

/**
 * A project resource for a spec that has to seed `currentProjectAtom`.
 *
 * Twenty browser specs built one of these by hand, and every capability added
 * from here on would have meant twenty more edits, half of them wrong. The
 * shape is the RESOURCE rather than the row: that is what the atom holds and
 * what every web-side gate reads.
 *
 * ⚠️ **Lives under `src/` on purpose, though nothing ships it.** `@/*` maps to
 * `./src/*` and is the only path the `test/` tree and the `src/**\/*.browser.spec.tsx`
 * tree can both spell; a fixture in `test/fixtures` would reach a browser spec
 * as six levels of `../`. It is imported by specs only, so it leaves the
 * bundle with everything else nothing references.
 *
 * ## Why the default is every capability
 *
 * Not the wizard's preselection, which is Work and Knowledge. A wizard's
 * default is a product decision about what a person is offered; a fixture's
 * default is about not making an unrelated spec fail. A fixture that withheld
 * Apps would make a spec about an error table fail for a reason that has
 * nothing to do with error tables - and that failure gets "fixed" by copying
 * whatever the neighbouring spec does, which is how a suite stops describing
 * anything.
 *
 * A spec whose SUBJECT is a capability being off says so, and reads better for
 * it:
 *
 * ```ts
 * projectFixture({ capabilities: ["knowledge"] })   // a knowledge-only project
 * projectFixture({ options: { work: { board: false } } })
 * ```
 *
 * `createTestProject` in `test/fixtures/entities.ts` defaults the same way,
 * for the same reason - it seeds rows where this seeds an atom.
 */
export interface ProjectFixtureOptions {
  id?: number;
  title?: string;
  slug?: string;
  createdBy?: string;
  /**
   * Which capabilities the project has. Defaults to all four.
   */
  capabilities?: CapabilityKey[];
  /**
   * Per-capability option overrides, merged over "every option on".
   */
  options?: Partial<Record<CapabilityKey, Record<string, boolean>>>;
}

export class ProjectFixtureBuilder {
  protected readonly registry = new CapabilityRegistry();

  /**
   * Every option a capability declares, all on. The starting point the
   * `options` overrides are merged over.
   */
  protected allOptionsOf(key: CapabilityKey): Record<string, boolean> {
    const options: Record<string, boolean> = {};
    for (const option of this.registry.get(key).options) {
      // `deploy` is the exception: it gates nothing that exists yet, and a
      // fixture asserting it on would be asserting a surface nobody built.
      options[option.key] = !option.soon;
    }
    return options;
  }

  public capabilities(
    over: ProjectFixtureOptions = {},
  ): ProjectCapabilityResource[] {
    const keys = over.capabilities ?? [...CAPABILITY_KEYS];
    return keys.map((key) => ({
      key,
      enabledAt: "2026-01-01T00:00:00.000Z",
      options: { ...this.allOptionsOf(key), ...over.options?.[key] },
    }));
  }

  public build(over: ProjectFixtureOptions = {}): ProjectResource {
    return {
      id: over.id ?? 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      title: over.title ?? "Lore",
      slug: over.slug ?? "lore",
      createdBy: over.createdBy ?? "00000000-0000-4000-8000-000000000001",
      areas: [],
      // Still written, because the column is frozen rather than dropped and
      // the entity schema still describes it. Nothing reads it.
      features: {
        kanban: true,
        folios: true,
        feedback: true,
        milestones: true,
      },
      capabilities: this.capabilities(over),
      kanbanColumns: ["In Progress"],
      unlockedFeatures: [],
      unlockHistory: [],
    } as ProjectResource;
  }
}

/**
 * The one call a spec makes. A module-level const rather than a class method
 * because a spec is not a DI container: the `never write code outside a class`
 * rule exists so services stay substitutable, and a fixture nobody injects has
 * nothing to substitute.
 */
export const projectFixture = (
  over: ProjectFixtureOptions = {},
): ProjectResource => new ProjectFixtureBuilder().build(over);
