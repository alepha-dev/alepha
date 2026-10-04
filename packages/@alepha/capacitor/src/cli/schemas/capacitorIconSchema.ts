import { type Infer, z } from "alepha";

/**
 * Where the app's icon and splash come from.
 */
export const capacitorIconSchema = z.object({
  /**
   * A square image of at least 1024 px (PNG, or SVG of any size), relative to
   * the project root.
   */
  source: z.string().min(1),

  /**
   * The colour behind the icon, `#RRGGBB`: the Android adaptive background,
   * what the iOS icon's transparency is flattened onto, and the splash.
   * White when unset.
   */
  background: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "background is a #RRGGBB colour")
    .optional(),
});

export type CapacitorIcon = Infer<typeof capacitorIconSchema>;
