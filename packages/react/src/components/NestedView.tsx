import { Flex } from "@mantine/core";
import {
	type ReactNode,
	useContext,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { RouterLayerContext } from "../contexts/RouterLayerContext.ts";
import { Redirection } from "../errors/Redirection.ts";
import { useRouterEvents } from "../hooks/useRouterEvents.ts";
import { useRouterLayerIndex } from "../hooks/useRouterLayerIndex.ts";
import { useRouterState } from "../hooks/useRouterState.ts";
import ErrorBoundary from "./ErrorBoundary.tsx";

export interface NestedViewProps {
	children?: ReactNode;
	errorBoundary?: false | ((error: Error) => ReactNode);
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
	const index = useRouterLayerIndex();
	const state = useRouterState();

	const [view, setView] = useState<ReactNode | undefined>(
		state.layers[index]?.element,
	);
	const [className, setClassName] = useState("");

	const animationExitDuration = useRef<number>(0);
	const animationExitNow = useRef<number>(0);
	const animationEnterDuration = useRef<number>(0);

	useRouterEvents(
		{
			onBegin: async ({ previous }) => {
				const layer = previous.layers[index];
				const animationExit = layer.route?.animations?.exit;
				if (animationExit) {
					console.log("animating exit");

					animationExitNow.current = Date.now();
					animationExitDuration.current = animationExit.duration;
					setClassName(animationExit.className);
					setTimeout(() => {
						setClassName(`${animationExit.className} active`);
					});
					setTimeout(() => {
						console.log("animation exit done");
					}, animationExit.duration);
				} else {
					animationExitNow.current = 0;
					animationExitDuration.current = 0;
				}
			},
			onEnd: async ({ state }) => {
				const layer = state.layers[index];

				if (animationExitNow.current) {
					const duration = animationExitDuration.current;
					const diff = Date.now() - animationExitNow.current - 20;
					if (diff < duration) {
						console.log("waiting to enter", duration - diff);
						await new Promise((resolve) =>
							setTimeout(resolve, duration - diff),
						);
					}
				}

				if (!layer?.cache) {
					setView(layer?.element);
					if (layer?.route?.animations?.enter) {
						const animationEnter = layer.route.animations.enter;
						setClassName(animationEnter.className);
						animationEnterDuration.current = animationEnter.duration;
					}
				}
			},
		},
		[],
	);

	useEffect(() => {
		if (animationEnterDuration.current) {
			console.log("activating enter");
			setClassName(`${className} active`);
			setTimeout(() => {
				setClassName("");
				console.log("animation enter done");
			}, animationEnterDuration.current);
		}
	}, [view]);

	let element = view ?? props.children ?? null;

	if (className) {
		element = (
			<div
				style={{
					display: "flex",
					flex: 1,
					height: "100%",
					width: "100%",
					position: "relative",
					overflow: "hidden",
				}}
			>
				<div
					className={className}
					style={{ height: "100%", width: "100%", display: "flex" }}
				>
					{element}
				</div>
			</div>
		);
	}

	if (props.errorBoundary === false) {
		return <>{element}</>;
	}

	if (props.errorBoundary) {
		return (
			<ErrorBoundary fallback={props.errorBoundary}>{element}</ErrorBoundary>
		);
	}

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
