import { $atom, t } from "alepha";
import { whiteboards } from "../../../api/entities/whiteboards.ts";

export const currentWhiteboardsAtom = $atom({
  name: "current_whiteboards",
  schema: t.array(whiteboards.schema),
  default: [],
});

export const currentWhiteboardAtom = $atom({
  name: "current_whiteboard",
  schema: t.optional(whiteboards.schema),
  default: undefined,
});
