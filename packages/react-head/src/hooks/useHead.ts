import type { Head } from "../interfaces/Head.ts";

export const useHead = (head?: Head | ((previous?: Head) => Head)): void => {};
