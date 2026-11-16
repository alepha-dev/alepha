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
