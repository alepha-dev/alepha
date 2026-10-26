/**
 * The in-app assistant on the client: a chat drawer with streamed replies,
 * history and a confirmation card per mutation, the headless `useAiChat`,
 * and `useAiContext` for a page to declare what it shows. Talks to
 * `alepha/api/ai`.
 *
 * @module alepha.ui.ai
 */

export * from "./AiChat.tsx";
export * from "./AiChatConfirmCard.tsx";
export * from "./AiChatHistory.tsx";
export * from "./AiChatMessage.tsx";
export * from "./aiChatMessageFormSchema.ts";
export * from "./aiContextAtom.ts";
export * from "./AiFormRegistry.ts";
export * from "./useAiChat.ts";
export * from "./useAiContext.ts";
