import { AlephaError } from "@alepha/core";
import { useActive, useInject } from "@alepha/react";
import { AnchorButton, Button, type ButtonProps } from "@blueprintjs/core";
import { createElement, type FunctionComponent, useState } from "react";
import Toast from "../../services/Toast.ts";

export type ActionProps = ButtonProps & {
	visibleText?: "sm" | "md" | "lg";
	active?: boolean;
	href?: string;
};

const Action = (props: ActionProps) => {
	const toast = useInject(Toast);
	let { visibleText, href, ...rest } = props;

	const isAnchor = !!href;
	const { isActive, anchorProps } = useActive(href);
	const [pending, setPending] = useState(false);

	const onClick = rest.onClick;
	if (onClick) {
		rest.onClick = async (e: any) => {
			if (pending) return;
			setPending(true);
			try {
				await onClick(e);
			} catch (error) {
				if (error instanceof AlephaError) {
					toast.show(error.message, "danger");
					return;
				}
				throw error;
			}
			setPending(false);
		};
	}

	rest.disabled ??= pending;
	rest.loading ??= pending;

	if (isAnchor && isActive && props.active !== false) {
		rest = {
			...rest,
			active: true,
		};
	}

	let element: FunctionComponent = Button;

	if (isAnchor) {
		element = AnchorButton;
		rest = {
			...rest,
			...anchorProps,
		};
	}

	if (visibleText) {
		rest.className ??= "";
		rest.className += ` hide-${visibleText}-up-text`;
	}

	return createElement(element, rest);
};

export default Action;
