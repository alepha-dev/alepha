import { LoreSpriteAsleepRenderer } from "./LoreSpriteAsleepRenderer.ts";
import { LoreSpriteCalmRenderer } from "./LoreSpriteCalmRenderer.ts";
import { LoreSpriteGlitchRenderer } from "./LoreSpriteGlitchRenderer.ts";
import { LoreSpriteListeningRenderer } from "./LoreSpriteListeningRenderer.ts";
import { LoreSpriteRenderer } from "./LoreSpriteRenderer.ts";
import {
  type LoreSpriteSeekingOptions,
  LoreSpriteSeekingRenderer,
} from "./LoreSpriteSeekingRenderer.ts";

/**
 * A state the companion can be drawn in, beyond the one Home shows:
 *
 * - `calm`: nothing left to do, her dust in one tidy orbit.
 * - `asleep`: nothing yet, wings folded and lens shut.
 * - `seeking`: looking for something, a beam turned to the list beside her
 *   or swept across a page that has none (`look`).
 * - `glitch`: something broke, a wing down and the lens red.
 * - `listening`: waiting for your words, her lens on the composer and rings
 *   of light turning around her (an empty conversation).
 */
export type LoreSpriteMood =
  | "calm"
  | "asleep"
  | "seeking"
  | "glitch"
  | "listening";

/**
 * Picks the renderer of a mood. A mood is a subclass of
 * `LoreSpriteRenderer` that bends its behaviour and draws nothing it could
 * not already draw: the companion is never redrawn, only put in another
 * state.
 *
 * The options are the widest any mood reads: `look` is `seeking`'s, and the
 * others ignore it.
 */
export class LoreSpriteMoods {
  public static create(
    canvas: HTMLCanvasElement,
    options: LoreSpriteSeekingOptions,
    mood?: LoreSpriteMood,
  ): LoreSpriteRenderer {
    switch (mood) {
      case "calm":
        return new LoreSpriteCalmRenderer(canvas, options);
      case "asleep":
        return new LoreSpriteAsleepRenderer(canvas, options);
      case "seeking":
        return new LoreSpriteSeekingRenderer(canvas, options);
      case "glitch":
        return new LoreSpriteGlitchRenderer(canvas, options);
      case "listening":
        return new LoreSpriteListeningRenderer(canvas, options);
      default:
        return new LoreSpriteRenderer(canvas, options);
    }
  }
}
