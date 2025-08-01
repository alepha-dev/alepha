import { useAlepha } from "@alepha/react";
import type { Head } from "../interfaces/Head.ts";

/**
 * ```tsx
 * const App = () => {
 *   const [head, setHead] = useHead({
 *     // will set the document title on the first render
 *     title: "My App",
 *   });
 *
 *   return (
 *     // This will update the document title when the button is clicked
 *     <button onClick={() => setHead({ title: "Change Title" })}>
 *       Change Title {head.title}
 *     </button>
 *   );
 * }
 * ```
 */
export const useHead = (options?: UseHeadOptions): void => {
	const alepha = useAlepha();

	// TODO
};

export type UseHeadOptions = Head | ((previous?: Head) => Head);

export type UseHeadReturn = [
	Head,
	(head?: Head | ((previous?: Head) => Head)) => void,
];
