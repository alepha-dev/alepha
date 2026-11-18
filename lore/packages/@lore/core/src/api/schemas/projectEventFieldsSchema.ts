import { type Infer, z } from "alepha";

/**
 * What a project event carries, as data and never as finished text (#Q3889):
 * names, numbers, states and links, which each channel's message turns into
 * words. The webhook channel sends the same object as its `data.fields`.
 */
export const projectEventFieldsSchema = z
  .record(
    z.string().max(64),
    z.union([z.string().max(16_384), z.number(), z.boolean(), z.null()]),
  )
  .refine(
    (value) =>
      new TextEncoder().encode(JSON.stringify(value)).byteLength <= 65_536,
    { message: "Event fields exceed 64 KiB" },
  );

export type ProjectEventFields = Infer<typeof projectEventFieldsSchema>;
