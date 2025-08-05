import type { ReactNode } from "react";
import Flex, { type FlexProps } from "./Flex.tsx";

export interface GridProps {
	flexProps?: FlexProps;
	md?: number;
	children?: ReactNode;
	gap1?: boolean;
	gap2?: boolean;
}

const Grid = (props: GridProps) => {
	const { flexProps, md = 2, children } = props;

	if (!Array.isArray(children)) {
		return children;
	}

	const gap = props.gap1
		? 1
		: props.gap2
			? 2
			: props.flexProps?.gap1
				? 1
				: props.flexProps?.gap2
					? 2
					: 0;

	const className = `grid grid-md-${md}${flexProps?.className ? ` ${flexProps?.className}` : ""}`;

	const style = {
		display: "grid",
		gridTemplateColumns: `repeat(${md}, minmax(0, 1fr))`,
		gap: typeof gap === "number" ? `calc(var(--spacing) * ${gap})` : gap,
		...flexProps?.style,
	};

	return (
		<Flex className={className} style={style} {...flexProps}>
			{children}
		</Flex>
	);
};

export default Grid;
