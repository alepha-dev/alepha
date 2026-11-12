/**
 * A key as the reading direction sees it: `ArrowRight` means "forward along
 * the line" and `ArrowLeft` "back", so on a right-to-left page the two
 * physical keys swap. Every other key comes back as it is.
 *
 * For the kit's own arrow-key handlers (a radio group, a tab list, a tree),
 * which would otherwise move backwards on an Arabic or Hebrew page. Base
 * UI's parts do the same from their `DirectionProvider`; these read the
 * nearest `dir` attribute instead, which `<html dir>` always provides.
 */
export const inlineArrowKey = (event: {
  key: string;
  currentTarget: EventTarget | null;
}): string => {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
    return event.key;
  }
  const element =
    event.currentTarget instanceof Element ? event.currentTarget : null;
  const rtl = element?.closest("[dir]")?.getAttribute("dir") === "rtl";
  if (!rtl) return event.key;
  return event.key === "ArrowLeft" ? "ArrowRight" : "ArrowLeft";
};
