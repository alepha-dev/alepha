import {
	__bind,
	$inject,
	$injectResolverRegistry,
	type Alepha,
	type Module,
	type TObject,
	t,
} from "@alepha/core";
import * as drizzle from "drizzle-orm";
import { isTable, type TableConfig } from "drizzle-orm";
import { $repository } from "./descriptors/$repository.ts";
import { $sequence } from "./descriptors/$sequence.ts";
import type { PgTableWithColumnsAndSchema } from "./helpers/schemaToPgColumns.ts";
import { NodePostgresProvider } from "./providers/drivers/NodePostgresProvider.ts";
import { NodeSqliteProvider } from "./providers/drivers/NodeSqliteProvider.ts";
import { PostgresProvider } from "./providers/drivers/PostgresProvider.ts";
import { RepositoryDescriptorProvider } from "./providers/RepositoryDescriptorProvider.ts";
import { SequenceProvider } from "./providers/SequenceProvider.ts";
import type { Repository } from "./services/Repository.ts";

// ---------------------------------------------------------------------------------------------------------------------

export { drizzle };
export { sql } from "drizzle-orm";
export * from "drizzle-orm/pg-core";
export * from "./constants/PG_SCHEMA.ts";
export * from "./constants/PG_SYMBOLS.ts";
export * from "./descriptors/$db.ts";
export * from "./descriptors/$entity.ts";
export * from "./descriptors/$repository.ts";
export * from "./descriptors/$sequence.ts";
export * from "./descriptors/$transaction.ts";
export * from "./errors/EntityNotFoundError.ts";
export * from "./helpers/nullToUndefined.ts";
export * from "./helpers/schemaToPgColumns.ts";
export * from "./interfaces/FilterOperators.ts";
export * from "./interfaces/PgQuery.ts";
export * from "./interfaces/PgQueryWhere.ts";
export * from "./interfaces/TInsertObject.ts";
export * from "./providers/DrizzleKitProvider.ts";
export * from "./providers/drivers/NodePostgresProvider.ts";
export * from "./providers/drivers/PostgresProvider.ts";
export * from "./providers/PostgresTypeProvider.ts";
export * from "./providers/RepositoryDescriptorProvider.ts";
export * from "./schemas/entitySchema.ts";
export * from "./schemas/pageQuerySchema.ts";
export * from "./schemas/pageSchema.ts";
export * from "./services/Repository.ts";
export * from "./types/schema.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "@alepha/core" {
	function $inject<T extends TableConfig, R extends TObject>(
		type: PgTableWithColumnsAndSchema<T, R>,
	): Repository<PgTableWithColumnsAndSchema<T, R>, R>;
}

$injectResolverRegistry.register((it) => {
	if (isTable(it)) {
		return $repository(it as any);
	}
});

// ---------------------------------------------------------------------------------------------------------------------

const envSchema = t.object({
	DATABASE_URL: t.string({
		default: ":memory:",
	}),
});

/**
 * Provides PostgreSQL and SQLite database integration with type-safe ORM capabilities through Drizzle.
 *
 * The postgres module enables declarative database operations using descriptors like `$entity`, `$repository`,
 * and `$db` on class properties. It offers automatic schema generation, type-safe queries, transactions,
 * and database migrations with support for both PostgreSQL and SQLite backends.
 *
 * **Key Features:**
 * - Declarative entity definition with `$entity` descriptor
 * - Type-safe repository pattern with `$repository` descriptor
 * - Database connection management with `$db` descriptor
 * - Automatic schema migrations and type generation
 * - Transaction support with `$transaction` descriptor
 * - Sequence management with `$sequence` descriptor
 * - Full TypeScript integration with compile-time type checking
 *
 * **Basic Usage:**
 * ```ts
 * import { Alepha, run, t } from "alepha";
 * import { AlephaPostgres, $entity, $repository, pg } from "alepha/postgres";
 *
 * // Define database entities
 * const user = $entity({
 *   name: "users",
 *   schema: t.object({
 *     id: pg.primaryKey(),
 *     createdAt: pg.createdAt(),
 *     name: t.string(),
 *     email: t.string(),
 *     age: t.optional(t.integer()),
 *   }),
 * });
 *
 * const post = $entity({
 *   name: "posts",
 *   schema: t.object({
 *     id: pg.primaryKey(),
 *     createdAt: pg.createdAt(),
 *     title: t.string(),
 *     content: t.string(),
 *     authorId: pg.references(t.uint(), () => user.id),
 *   }),
 * });
 *
 * class Database {
 *   users = $repository(user);
 *   posts = $repository(post);
 * }
 *
 * const alepha = Alepha.create()
 *   .with(AlephaPostgres)
 *   .with(Database);
 *
 * run(alepha);
 * ```
 *
 * **Repository Operations:**
 * ```ts
 * class UserService {
 *   users = $repository(user);
 *
 *   async createUser(userData: { name: string; email: string }) {
 *     return await this.users.create(userData);
 *   }
 *
 *   async findUserByEmail(email: string) {
 *     return await this.users.findFirst({
 *       where: { email },
 *     });
 *   }
 *
 *   async getUsersWithPosts() {
 *     return await this.users.find({
 *       with: { posts: true },
 *       limit: 10,
 *     });
 *   }
 *
 *   async updateUser(id: number, updates: Partial<{ name: string; age: number }>) {
 *     return await this.users.update(id, updates);
 *   }
 * }
 * ```
 *
 * **Advanced Database Operations:**
 * ```ts
 * import { $db, $transaction } from "alepha/postgres";
 *
 * class AdvancedDatabase {
 *   db = $db({
 *     entities: { user, post },
 *   });
 *
 *   createUserWithPost = $transaction(async () => {
 *     const newUser = await this.db.users.create({
 *       name: "John Doe",
 *       email: "john@example.com",
 *     });
 *
 *     const newPost = await this.db.posts.create({
 *       title: "My First Post",
 *       content: "Hello world!",
 *       authorId: newUser.id,
 *     });
 *
 *     return { user: newUser, post: newPost };
 *   });
 *
 *   async rawQuery() {
 *     // Execute raw SQL queries
 *     return await this.db.execute(sql`
 *       SELECT users.name, COUNT(posts.id) as post_count
 *       FROM users
 *       LEFT JOIN posts ON users.id = posts.author_id
 *       GROUP BY users.id, users.name
 *     `);
 *   }
 * }
 * ```
 *
 * @see {@link $entity}
 * @see {@link $repository}
 * @see {@link $db}
 * @see {@link $transaction}
 * @module alepha.postgres
 */
export class AlephaPostgres implements Module {
	public readonly name = "alepha.postgres";
	public readonly env = $inject(envSchema);

	public readonly $services = (alepha: Alepha) => {
		alepha.with(RepositoryDescriptorProvider);

		if (this.env.DATABASE_URL?.includes(":memory:")) {
			alepha.with({
				optional: true,
				provide: PostgresProvider,
				use: NodeSqliteProvider,
			});
		} else {
			alepha.with({
				optional: true,
				provide: PostgresProvider,
				use: NodePostgresProvider,
			});
		}

		alepha.with(SequenceProvider);
	};
}

__bind($repository, AlephaPostgres);
__bind($sequence, AlephaPostgres);
