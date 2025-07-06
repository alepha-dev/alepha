export interface Head extends SimpleHead {
	description?: string;

	// TODO
	keywords?: string[];
	author?: string;
	robots?: string;
	themeColor?: string;
	viewport?:
		| string
		| {
				width?: string;
				height?: string;
				initialScale?: string;
				maximumScale?: string;
				userScalable?: "no" | "yes" | "0" | "1";
				interactiveWidget?:
					| "resizes-visual"
					| "resizes-content"
					| "overlays-content";
		  };

	og?: {
		title?: string;
		description?: string;
		image?: string;
		url?: string;
		type?: string;
	};

	twitter?: {
		card?: string;
		title?: string;
		description?: string;
		image?: string;
		site?: string;
	};
}

export interface SimpleHead {
	title?: string;
	titleSeparator?: string;
	htmlAttributes?: Record<string, string>;
	bodyAttributes?: Record<string, string>;
	meta?: Array<{ name: string; content: string }>;
}
