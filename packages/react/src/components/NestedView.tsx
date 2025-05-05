import type { ReactNode } from "react";
import { useContext, useEffect, useState } from "react";
import { RouterContext } from "../contexts/RouterContext.ts";
import { RouterLayerContext } from "../contexts/RouterLayerContext.ts";

export interface NestedViewProps {
	children?: ReactNode;
}

/**
 * Nested view component
 *
 * @param props
 * @constructor
 */
const NestedView = (props: NestedViewProps) => {
	const app = useContext(RouterContext);
	const layer = useContext(RouterLayerContext);
	const index = layer?.index ?? 0;

	const [view, setView] = useState<ReactNode | undefined>(
		app?.state.layers[index]?.element,
	);

	useEffect(() => {
		if (app?.alepha.isBrowser()) {
			return app?.events.on("end", (state) => {
				setView(state.layers[index]?.element);
			});
		}
	}, [app]);

	return view ?? props.children ?? null;
};

export default NestedView;
