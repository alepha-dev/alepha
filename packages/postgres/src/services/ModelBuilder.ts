import type { EntityDescriptor } from "../descriptors/$entity.ts";
import type { SequenceDescriptor } from "../descriptors/$sequence.ts";

/**
 * Transform Alepha Descriptors (Entity, Sequence, etc...) into drizzle models (tables, enums, sequences, etc...).
 */
export interface ModelBuilder {
  buildTable(
    entity: EntityDescriptor,
    options: {
      tables: Map<string, unknown>;
      enums: Map<string, unknown>;
      schema: string;
    },
  ): void;

  buildSequence(
    sequence: SequenceDescriptor,
    options: {
      sequences: Map<string, unknown>;
    },
  ): void;
}
