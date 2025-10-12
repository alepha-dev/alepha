import { defineConfig } from "drizzle-kit";

const { DATABASE_URL = "./node_modules/.db" } = process.env;

export default defineConfig({
	schema: "./src/entities.ts",
	dialect: "postgresql",
	driver: "pglite",
	dbCredentials: {
		url: DATABASE_URL,
	},
});
