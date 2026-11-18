import type { BadgeTone } from "@alepha/ui";
import { Bot, Server, UserRound } from "lucide-react";

import type { PersonaKind } from "../../../../api/schemas/personaKindSchema.ts";

/**
 * Each persona kind's label key and glyph (#E153), written out so every key
 * has a call site.
 */
export const PERSONA_KIND_LABEL_KEYS = {
  human: "requirements.persona.kind.human",
  system: "requirements.persona.kind.system",
  agent: "requirements.persona.kind.agent",
} as const satisfies Record<PersonaKind, string>;

export const PERSONA_KIND_ICONS = {
  human: UserRound,
  system: Server,
  agent: Bot,
} as const satisfies Record<PersonaKind, unknown>;

/**
 * Each kind's tone on its `tint` badge: blue for a person, violet for a
 * system, green for an agent. Hue tones rather than semantic ones, which
 * mean success, warning or danger: a kind is none of those.
 */
export const PERSONA_KIND_TONES = {
  human: "blue",
  system: "violet",
  agent: "green",
} as const satisfies Record<PersonaKind, BadgeTone>;
