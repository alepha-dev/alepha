import { type ReactNode, use, useRef, useState } from "react";
import { RouterLayerContext } from "../contexts/RouterLayerContext.ts";
import type { PageAnimation } from "../descriptors/$page.ts";
import { Redirection } from "../errors/Redirection.ts";
import { useRouterEvents } from "../hooks/useRouterEvents.ts";
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
	const index = use(RouterLayerContext)?.index ?? 0;
	const state = useRouterState();

	const [view, setView] = useState<ReactNode | undefined>(
		state.layers[index]?.element,
	);

	const [animation, setAnimation] = useState("");
	const animationExitDuration = useRef<number>(0);
	const animationExitNow = useRef<number>(0);

	useRouterEvents(
		{
			onBegin: async ({ previous, state }) => {
				// --------- Animations Begin ---------
				const layer = previous.layers[index];
				if (state.url.pathname.startsWith(layer?.path)) {
					return;
				}

				const animationExit = parseAnimation(layer.route?.animation, "exit");
				const isChild = state.url.pathname.startsWith(previous.url.pathname);
				if (animationExit && !isChild) {
					const duration = animationExit.duration || 200;
					animationExitNow.current = Date.now();
					animationExitDuration.current = duration;
					setAnimation(animationExit.animation);
				} else {
					animationExitNow.current = 0;
					animationExitDuration.current = 0;
					setAnimation("");
				}
				// --------- Animations End ---------
			},
			onEnd: async ({ state }) => {
				const layer = state.layers[index];

				// --------- Animations Begin ---------
				if (animationExitNow.current) {
					const duration = animationExitDuration.current;
					const diff = Date.now() - animationExitNow.current;
					if (diff < duration) {
						await new Promise((resolve) =>
							setTimeout(resolve, duration - diff),
						);
					}
				}
				// --------- Animations End ---------

				if (!layer?.cache) {
					setView(layer?.element);

					// --------- Animations Begin ---------
					const animationEnter = parseAnimation(
						layer?.route?.animation,
						"enter",
					);

					if (animationEnter) {
						setAnimation(animationEnter.animation);
					} else {
						setAnimation("");
					}
					// --------- Animations End ---------
				}
			},
		},
		[],
	);

	let element = view ?? props.children ?? null;

	// --------- Animations Begin ---------
	if (animation) {
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
					key={animation}
					style={{ height: "100%", width: "100%", display: "flex", animation }}
				>
					{element}
				</div>
			</div>
		);
	}
	// --------- Animations End ---------

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

function parseAnimation(
	animation?: PageAnimation,
	type: "enter" | "exit" = "enter",
):
	| {
			duration: number;
			animation: string;
	  }
	| undefined {
	if (!animation) {
		return undefined;
	}

	if (typeof animation === "string") {
		if (type === "exit") {
			return;
		}
		return {
			duration: 200,
			animation: `200ms ease-out ${animation}`,
		};
	}

	if (typeof animation === "object") {
		const anim = animation[type];
		const duration = typeof anim === "object" ? (anim.duration ?? 200) : 200;
		const name = typeof anim === "object" ? anim.name : anim;

		if (type === "exit") {
			const timing =
				typeof anim === "object" ? (anim.timing ?? "ease-in") : "ease-in";
			return {
				duration,
				animation: `${duration}ms ${timing} ${name}`,
			};
		}

		const timing =
			typeof anim === "object" ? (anim.timing ?? "ease-out") : "ease-out";

		return {
			duration,
			animation: `${duration}ms ${timing} ${name}`,
		};
	}

	return undefined;
}
