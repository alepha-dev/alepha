import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

export interface FlexProps {
	children?: ReactNode;

	/**
	 * If true, the flex container will fill the available space.
	 * This is useful for creating layouts that adapt to the size of their parent container.
	 */
	fill?: boolean;

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

	dark?: boolean;

	pad1?: boolean; // Padding 1
	pad2?: boolean; // Padding 2
	pad3?: boolean; // Padding 3
	pad4?: boolean; // Padding 4

	pad2h?: boolean; // Horizontal Padding 2

	gap1?: boolean; // Gap 1
	gap2?: boolean; // Gap 2
	gap3?: boolean; // Gap 3
	gap4?: boolean; // Gap 4

	card?: boolean;
	bg?: boolean;

	radius?: boolean;
	border?: boolean;

	className?: string; // Additional class names to apply to the flex container
	style?: CSSProperties; // Additional styles to apply to the flex container
}

const Flex = (props: FlexProps) => {
	const s: CSSProperties = {};
	const classes = ["fx"];

	if (props.border) {
		classes.push("border");
	}

	if (props.radius) {
		classes.push("radius");
	}

	if (props.dark) {
		classes.push("bp6-dark dark");
	}

	if (props.card) {
		classes.push("card");
	}

	if (props.fill) {
		classes.push("fl");
	}

	if (props.col) {
		classes.push("col");
	}

	if (props.layout) {
		classes.push("layout");
	}

	if (props.bg) {
		classes.push("bg");
	}

	if (props.center) {
		classes.push("cx");
		classes.push("cy");
	} else {
		if (props.centerX) {
			classes.push("cx");
		}
		if (props.centerY) {
			classes.push("cy");
		}
	}

	const size = 8;

	if (props.pad1) {
		classes.push("p1");
	} else if (props.pad2) {
		classes.push("p2");
	} else if (props.pad3) {
		classes.push("p3");
	} else if (props.pad4) {
		classes.push("p4");
	}

	if (props.pad2h) {
		classes.push("p2h");
	}

	if (props.gap1) {
		s.gap = `${size}px`;
	}
	if (props.gap2) {
		s.gap = `${size * 2}px`;
	}
	if (props.gap3) {
		s.gap = `${size * 3}px`;
	}
	if (props.gap4) {
		s.gap = `${size * 4}px`;
	}

	const p: HTMLAttributes<HTMLDivElement> = {
		style: {
			...s,
			...props.style,
		},
		className:
			classes.join(" ") + (props.className ? ` ${props.className}` : ""),
	};

	return <div {...p}>{props.children}</div>;
};

export default Flex;
