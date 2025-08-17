import type { ReactNode } from "react";
import { useContext, useState } from "react";
import { RouterLayerContext } from "../contexts/RouterLayerContext.ts";
import { Redirection } from "../errors/Redirection.ts";
import { useAlepha } from "../hooks/useAlepha.ts";
import { useRouterEvents } from "../hooks/useRouterEvents.ts";
import ErrorBoundary from "./ErrorBoundary.tsx";

export interface NestedViewProps {
	children?: ReactNode;
}

/**
 * A component that renders the current view of the nested router layer.
 *
 * To be simple, it renders the `element` of the current child page of a parent page.
 *
 * @example
 * ```tsx
 * import { NestedView } from "@alepha/react";
 *
 * class App {
 *   parent = $page({
 *     component: () => <NestedView />,
 *   });
 *
 *   child = $page({
 *     parent: this.root,
 *     component: () => <div>Child Page</div>,
 *   });
 * }
 * ```
 */
const NestedView = (props: NestedViewProps) => {
	const layer = useContext(RouterLayerContext);
	const index = layer?.index ?? 0;
	const alepha = useAlepha();
	const state = alepha.state("react.router.state");
	if (!state) {
		throw new Error("<NestedView/> must be used inside a RouterLayerContext.");
	}

	const [view, setView] = useState<ReactNode | undefined>(
		state.layers[index]?.element,
	);

	useRouterEvents(
		{
			onEnd: ({ state }) => {
				if (!state.layers[index]?.cache) {
					setView(state.layers[index]?.element);
				}
			},
		},
		[],
	);

	const element = view ?? props.children ?? null;

	return (
		<ErrorBoundary
			fallback={(error) => {
				const result = state.onError(error, state); // TODO: onError is not refreshed
				if (result instanceof Redirection) {
					return "Redirection inside ErrorBoundary is not allowed.";
				}
				return result as ReactNode;
			}}
		>
			{element}
		</ErrorBoundary>
	);
};

export default NestedView;
