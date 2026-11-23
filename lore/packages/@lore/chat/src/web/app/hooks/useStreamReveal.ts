import { useEffect, useRef, useState } from "react";

/**
 * The share of the hidden text each frame reveals: a burst the stream
 * delivers is drained in about a fifth of a second, whatever its size.
 */
const FRAMES_PER_BURST = 8;

/**
 * The fewest characters a frame reveals, so the tail of a burst does not
 * crawl.
 */
const MIN_STEP = 3;

/**
 * The text of a streamed answer as it should be shown now (#Q4190): it
 * types itself out instead of jumping by the blocks the stream delivers.
 *
 * Each frame reveals a share of what is still hidden, so a large burst is
 * drained as fast as a small one and the text never falls far behind the
 * stream. A cut lands at a word boundary, so Markdown is never split inside
 * a word. Once the answer is complete and fully shown, the whole text is
 * returned and rendered as usual.
 *
 * Only an answer seen streaming animates: text that arrives finished (the
 * history, another member's message, a reload) is shown at once, and so is
 * everything under `prefers-reduced-motion`. A body that is not a
 * continuation of what is shown (an edit) is shown at once too.
 */
export const useStreamReveal = (text: string, streaming: boolean): string => {
  const animated = useRef(streaming);
  if (streaming) animated.current = true;
  const [shown, setShown] = useState(() => (streaming ? 0 : text.length));
  const previous = useRef(text);

  // A stream only appends: a body that does not continue the previous one
  // (an edit) is not a stream.
  if (!text.startsWith(previous.current)) {
    animated.current = false;
  }
  previous.current = text;

  const reduced =
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const instant =
    !animated.current || reduced || typeof requestAnimationFrame !== "function";

  useEffect(() => {
    if (instant || shown >= text.length) return;
    let frame = 0;
    const tick = () => {
      setShown((current) => {
        if (current >= text.length) return current;
        const step = Math.max(
          MIN_STEP,
          Math.ceil((text.length - current) / FRAMES_PER_BURST),
        );
        return Math.min(text.length, current + step);
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [instant, text, shown >= text.length]);

  if (instant || shown >= text.length) return text;
  // Back to the last space, so a word (and a Markdown mark) is never split.
  const cut = text.lastIndexOf(" ", shown);
  return text.slice(0, cut > 0 && shown - cut < 24 ? cut : shown);
};
