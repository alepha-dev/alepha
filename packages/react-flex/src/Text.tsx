import { DateTimeProvider } from "@alepha/datetime";
import { useInject } from "@alepha/react";
import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import type { Breakpoint } from "./Flex.tsx";

export interface TextProps {
	bold?: boolean;
	small?: boolean;
	italic?: boolean;
	underline?: boolean;
	uppercase?: boolean;
	muted?: boolean;
	large?: boolean;

	visible?: Breakpoint;
	hide?: Breakpoint;
	span?: HTMLAttributes<HTMLSpanElement>;
	children?: ReactNode;
	className?: string;
	date?: boolean;
	style?: CSSProperties;
}

const Text = (props: TextProps) => {
	const s: CSSProperties = {
		...props.style,
	};
	const c: string[] = [...(props.className ? props.className.split(" ") : [])];

	if (props.bold) {
		s.fontWeight = "bold";
	}

	if (props.small) {
		s.fontSize = "0.8em";
	}

	if (props.large) {
		s.fontSize = "1.2em";
	}

	if (props.italic) {
		s.fontStyle = "italic";
	}

	if (props.underline) {
		s.textDecoration = "underline";
	}

	if (props.uppercase) {
		s.textTransform = "uppercase";
	}

	if (props.muted) {
		s.color = "var(--text-muted)";
	}

	const span = {
		className: c.join(" "),
		style: {
			...s,
			...props.span?.style,
		},
		...props.span,
		children: props.children,
	};

	const dt = useInject(DateTimeProvider);

	if (props.date) {
		if (typeof props.children === "string" || props.children instanceof Date) {
			span.children = dt.of(props.children).format("YY-MM-DD HH:mm");
		}
	}

	return <span {...span} />;
};

export default Text;
