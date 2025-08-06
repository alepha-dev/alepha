import type { ReactNode } from "react";
import { useContext, useState } from "react";
import { RouterContext } from "../contexts/RouterContext.ts";
import { RouterLayerContext } from "../contexts/RouterLayerContext.ts";
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
	const app = useContext(RouterContext);
	const layer = useContext(RouterLayerContext);
	const index = layer?.index ?? 0;

	const [view, setView] = useState<ReactNode | undefined>(
		app?.state.layers[index]?.element,
	);

	useRouterEvents(
		{
			onEnd: ({ state }) => {
				if (!state.layers[index]?.cache) {
					setView(state.layers[index]?.element);
				}
			},
		},
		[app],
	);

	if (!app) {
		throw new Error("NestedView must be used within a RouterContext.");
	}

	const element = view ?? props.children ?? null;

	return (
		<ErrorBoundary
			fallback={(error) => {
				return app.context.onError?.(error, app.context) as ReactNode;
			}}
		>
			{element}
		</ErrorBoundary>
	);
};

export default NestedView;
