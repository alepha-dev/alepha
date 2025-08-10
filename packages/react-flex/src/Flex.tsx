import {
	type CSSProperties,
	createElement,
	type HTMLAttributes,
	type ReactNode,
} from "react";

export type Breakpoint = "xs" | "sm" | "md" | "lg" | "xl";

export interface FlexProps {
	/**
	 * Children to be rendered inside the flex container.
	 */
	children?: ReactNode;

	/**
	 * Show the flex container on specific breakpoints.
	 */
	visible?: Breakpoint;

	/**
	 * Hide the flex container on specific breakpoints.
	 */
	hide?: Breakpoint;

	/**
	 * If true, the flex container will fill the available space.
	 * This is useful for creating layouts that adapt to the size of their parent container.
	 */
	fill?: boolean;

	/**
	 * If true, the flex container will fill the available width.
	 */
	wFill?: boolean;

	/**
	 * If true, the flex container will fill the available height.
	 */
	hFill?: boolean;

	/**
	 * If true, the flex container will use column layout.
	 */
	col?: boolean;

	/**
	 * If true, the flex container will take the full width and height of the window.
	 * This is useful for creating full-screen layouts.
	 */
	layout?: boolean;

	/**
	 * If true, the flex items will be centered within the flex container.
	 */
	center?: boolean;

	/**
	 * If true, the flex items will be centered along the cross axis (vertically in a row layout).
	 */
	centerX?: boolean;

	/**
	 * If true, the flex items will be centered along the main axis (horizontally in a row layout).
	 */
	centerY?: boolean;

	/**
	 * Padding options for the flex container.
	 */
	pad1?: boolean; // Padding 1
	pad2?: boolean; // Padding 2
	pad3?: boolean; // Padding 3
	pad4?: boolean; // Padding 4
	pad1h?: boolean; // Horizontal Padding 2
	pad2h?: boolean; // Horizontal Padding 2

	/**
	 * Gap options for the flex container.
	 */
	gap1?: boolean; // Gap 1
	gap2?: boolean; // Gap 2
	gap3?: boolean; // Gap 3
	gap4?: boolean; // Gap 4

	/**
	 * If true, the flex container will have a card bg color.
	 */
	card?: boolean;

	/**
	 * If true, the flex container will have a layout bg color.
	 */
	bg?: boolean;

	/**
	 * If true, the flex container will have rounded corners.
	 */
	rounded?: boolean;

	/**
	 * If true, the flex container will have a border.
	 */
	bordered?: boolean;

	/**
	 * Additional class names to apply to the flex container
	 */
	className?: string;

	/**
	 * Additional styles to apply to the flex container
	 */
	style?: CSSProperties;

	/**
	 * Additional HTML attributes to apply to the flex container
	 */
	div?: HTMLAttributes<HTMLDivElement>;

	/**
	 * Click handler for the flex container.
	 * This can be used to make the flex container interactive, like a button.
	 * It will also make the flex looks like clickable.
	 */
	onClick?: () => void;

	/**
	 * Replace div by another HTML element.
	 */
	as?: string;

	/**
	 * If true, the flex container will have a shadow effect.
	 */
	shadow?: boolean | 2 | 3;

	overflow?: boolean;

	// TODO: as=form
	onSubmit?: any;
}

/**
 * Flex component is a utility component that provides a flexible and responsive layout.
 * It allows you to create layouts that adapt to different screen sizes and orientations.
 * It supports various properties to control visibility, layout, padding, gaps, and more.
 *
 * @example
 * ```tsx
 * import Flex from "./Flex.tsx";
 *
 * const MyComponent = () => {
 *   return (
 *     <Flex col center pad2 gap2>
 *       <Flex>Item 1</Flex>
 *       <Flex>Item 2</Flex>
 *       <Flex>Item 3</Flex>
 *     </Flex>
 *   );
 * };
 * ```
 */
const Flex = (props: FlexProps) => {
	const s: CSSProperties = {};
	const p: HTMLAttributes<HTMLDivElement> = {};
	const c = ["fx"];

	if (props.visible) {
		c.push(`hide-${props.visible}-down`);
	}

	if (props.shadow === 2) {
		c.push("shd-2");
	} else if (props.shadow === 3) {
		c.push("shd-3");
	} else if (props.shadow) {
		c.push("shd-1");
	}

	if (props.hide) {
		c.push(`hide-${props.hide}-up`);
	}

	if (props.bordered) {
		c.push("brd");
	}

	if (props.rounded) {
		c.push("rad");
	}

	if (props.card) {
		c.push("card");
	}

	if (props.fill) {
		c.push("fl");
	}
	if (props.wFill) {
		c.push("wfl");
	}
	if (props.hFill) {
		c.push("hfl");
	}

	if (props.col) {
		c.push("col");
	}

	if (props.overflow) {
		c.push("ovf");
	}

	if (props.layout) {
		c.push("layout");
	}

	if (props.bg) {
		c.push("bg");
	}

	if (props.center) {
		c.push("cx");
		c.push("cy");
	} else {
		if (props.centerX) {
			c.push("cx");
		}
		if (props.centerY) {
			c.push("cy");
		}
	}

	if (props.pad1) {
		c.push("p1");
	} else if (props.pad2) {
		c.push("p2");
	} else if (props.pad3) {
		c.push("p3");
	} else if (props.pad4) {
		c.push("p4");
	}

	if (props.pad1h) {
		c.push("p1h");
	}
	if (props.pad2h) {
		c.push("p2h");
	}

	if (props.gap1) {
		c.push("g1");
	} else if (props.gap2) {
		c.push("g2");
	} else if (props.gap3) {
		c.push("g3");
	} else if (props.gap4) {
		c.push("g4");
	}

	const click = props.onClick;
	if (click) {
		c.push("clk");
		p.onClick ??= (e) => {
			e.stopPropagation();
			click();
		};
		p.role ??= "button";
		p.tabIndex ??= 0;
		p.onKeyDown ??= (e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.stopPropagation();
				click();
			}
		};
	}

	const div: HTMLAttributes<HTMLDivElement> = {
		...p,
		...props.div,
		style: {
			...s,
			...props.style,
			...props.div?.style,
		},
		className: c.join(" ") + (props.className ? ` ${props.className}` : ""),
	};

	if (props.as) {
		return createElement(props.as, { ...div }, props.children);
	}

	return <div {...div}>{props.children}</div>;
};

export default Flex;
