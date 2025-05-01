import type { Static } from "@alepha/core";
import { $inject, t } from "@alepha/core";
import { $route, NotFoundError } from "../../src";

export const catSchema = t.object({ name: t.string(), color: t.string() });
export type Cat = Static<typeof catSchema>;

export class ColorApi {
	color = $route({
		url: "/color",
		schema: {
			response: t.object({ color: t.string() }),
		},
	});
}

export class ColorCtrl {
	api = $inject(ColorApi);
	env = $inject(
		t.object({
			COLOR: t.string({
				default: "red",
			}),
		}),
	);

	color = $route({
		use: this.api.color,
		handler: () => {
			return { color: this.env.COLOR };
		},
	});
}

export class CatApi {
	cats = $route({
		method: "get",
		url: "/cats",
		schema: {
			query: t.object({
				name: t.optional(t.string()),
				color: t.optional(t.string()),
			}),
			response: t.array(catSchema),
		},
	});

	oneCat = $route({
		method: "get",
		url: "/cats/:name",
		schema: {
			params: t.object({ name: t.string() }),
			response: catSchema,
		},
	});

	newCat = $route({
		method: "post",
		url: "/cats",
		schema: {
			body: t.object({ name: t.string() }),
			response: catSchema,
		},
	});
}

export class CatCtrl {
	api = $inject(CatApi);
	colorApi = $inject(ColorApi);

	data: Cat[] = [
		{ name: "Tom", color: "gray" },
		{ name: "Jerry", color: "brown" },
	];

	cats = $route({
		use: this.api.cats,
		handler: ({ query }) => {
			if (query.name) {
				return this.data.filter((cat) => cat.name === query.name);
			}
			if (query.color) {
				return this.data.filter((cat) => cat.color === query.color);
			}
			return this.data;
		},
	});

	oneCat = $route({
		use: this.api.oneCat,
		handler: ({ params }) => {
			const cat = this.data.find((cat) => cat.name === params.name);
			if (!cat) {
				throw new NotFoundError("Cat not found");
			}
			return cat;
		},
	});

	newCat = $route({
		use: this.api.newCat,
		handler: async ({ body }) => {
			const { color } = await this.colorApi.color();
			const cat = { name: body.name, color };
			this.data.push(cat);
			return cat;
		},
	});
}
