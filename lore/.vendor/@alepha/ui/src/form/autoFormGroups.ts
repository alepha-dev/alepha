import { type ZObject, z } from "alepha";
import { isObjectOrUnionOfObjects } from "alepha/react/form";

import type { AutoFormGroup } from "./AutoForm.tsx";

export const autoGroupSchema = (
  schema: ZObject,
  opts: {
    defaultTitle?: string;
    defaultIcon?: string;
    /**
     * Translator for the fallback group title (the helper is hook-free).
     */
    tr?: (key: string, options?: { default?: string }) => string;
  },
): AutoFormGroup[] => {
  const general: AutoFormGroup = {
    title:
      opts.defaultTitle ??
      opts.tr?.("autoForm.general", { default: "General" }) ??
      "General",
    icon: opts.defaultIcon ?? "cog",
    fields: [],
  };
  const groups: AutoFormGroup[] = [];

  for (const [key, prop] of Object.entries(z.schema.shape(schema))) {
    // Classify the unwrapped schema: an optional object is still an object.
    const inner = z.schema.unwrap(prop);
    const isObject = z.schema.isObject(inner);
    // An array of a UNION of objects is a complex field too — without this it
    // lands in the "General" grid and gets a third of a row to render a list
    // of object editors in.
    const isArrayOfObjects =
      z.schema.isArray(inner) &&
      isObjectOrUnionOfObjects(z.schema.element(inner));
    if (isObject || isArrayOfObjects) {
      // Solo complex fields render their own header (label + description +
      // chevron + add/init), so we skip the group bar to avoid a
      // duplicate title row.
      groups.push({ fields: [key] });
    } else {
      general.fields.push(key);
    }
  }

  if (general.fields.length === 0) return groups;
  return [general, ...groups];
};
