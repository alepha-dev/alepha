import {
	IconHeartHandshake,
	IconMap2,
	IconPackage,
	IconTools,
} from "@tabler/icons-react";
import { createElement } from "react";

export const icons = {
	IconHeartHandshake,
	IconMap2,
	IconPackage,
	IconTools,
};

export const renderIcon = (
	name: string & keyof typeof icons,
	size: number = 18,
) => {
	return createElement(icons[name], { size });
};
