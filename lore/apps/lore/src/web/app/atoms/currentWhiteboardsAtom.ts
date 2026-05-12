import { $atom, t } from "alepha";
import { whiteboards } from "@/api/entities/whiteboards.ts";

export const currentWhiteboardsAtom = $atom({
  name: "lor.current.whiteboards",
  schema: t.array(whiteboards.schema),
  default: [],
});

export const currentWhiteboardAtom = $atom({
  name: "lor.current.whiteboard",
  schema: t.optional(whiteboards.schema),
  default: undefined,
});
