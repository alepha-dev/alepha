import { quests } from "../../api/entities/quests.ts";

/**
 * Quest size as the ordinal the column stores. The label mapping lives in the
 * field description rather than in the type, so the wire stays sortable and
 * an agent still knows that `4` means L.
 *
 * Taken from the column, so the 1-5 bound has one definition.
 */
export const questSizeSchema = quests.schema.shape.size;
