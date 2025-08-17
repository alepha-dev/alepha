import { AlephaError } from "@alepha/core";
import { type AnchorProps, useActive, useInject } from "@alepha/react";
import { AnchorButton, Button, type ButtonProps } from "@blueprintjs/core";
import { createElement, type FunctionComponent, useState } from "react";
import { Toaster } from "../../services/Toaster.ts";

export type ActionProps = ButtonProps & {
	visibleText?: "sm" | "md" | "lg";
	href?: string;
	active?: boolean;
	anchorProps?: AnchorProps;
};

const Action = (props: ActionProps) => {
	const href = props.href;
	if (href) {
		return <HrefAction {...props} href={href} />;
	}

	return <AbstractAction {...props} />;
};

export default Action;

const HrefAction = (props: ActionProps & { href: string }) => {
	const { isActive, anchorProps } = useActive(props.href);

	return (
		<AbstractAction
			{...props}
			active={props.active ?? isActive}
			anchorProps={anchorProps}
		/>
	);
};

const AbstractAction = (props: ActionProps) => {
	const toaster = useInject(Toaster);
	const [pending, setPending] = useState(false);
	let { visibleText, href, anchorProps, ...rest } = props;

	const isAnchor = !!href;

	const onClick = rest.onClick;
	if (onClick) {
		rest.onClick = async (e: any) => {
			if (pending) return;
			setPending(true);
			try {
				await onClick(e);
			} catch (error) {
				if (error instanceof AlephaError) {
					toaster.show(error.message, "danger");
					return;
				}
				throw error;
			}
			setPending(false);
		};
	}

	rest.disabled ??= pending;
	rest.loading ??= pending;

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
