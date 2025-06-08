import { defineConfig } from "drizzle-kit";

const {
	DATABASE_URL = "postgres://postgres:postgres@localhost:5432/postgres",
} = process.env;

export default defineConfig({
	dbCredentials: {
		url: DATABASE_URL,
	},
	schema: "./src/entities.ts",
	out: "./drizzle",
	dialect: "postgresql",
});
