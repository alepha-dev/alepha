import { AlephaError } from "@alepha/core";
import { type LinkProps, useActive, useInject } from "@alepha/react";
import { AnchorButton, Button, type ButtonProps } from "@blueprintjs/core";
import { createElement, type FunctionComponent, useState } from "react";
import Toast from "../../services/Toast.ts";

export type ActionProps = ButtonProps & {
	visibleText?: "sm";
	link?: LinkProps;
	active?: boolean;
	href?: string;
};

const Action = (props: ActionProps) => {
	const toast = useInject(Toast);
	let { visibleText, link, ...rest } = props;
	const [pending, setPending] = useState(false);

	const hasLink = !!link || !!props.href;
	const active = useActive(props.active !== false ? link?.to : undefined);

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

	if (active.isActive && link?.to && props.active !== false) {
		rest = {
			...rest,
			active: true,
		};
	}

	let element: FunctionComponent = Button;
	if (hasLink) {
		element = AnchorButton;
		rest = {
			...rest,
			...active.anchorProps,
		};
	}

	if (visibleText) {
		rest.className ??= "";
		rest.className += " hide-sm-up-text";
	}

	return createElement(element, rest);
};

export default Action;
