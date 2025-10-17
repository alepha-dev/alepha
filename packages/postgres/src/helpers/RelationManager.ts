import type { TObject } from "@alepha/core";
import { PG_PRIMARY_KEY } from "../constants/PG_SYMBOLS.ts";
import type { PgQueryWhere } from "../interfaces/PgQueryWhere.ts";
import { getAttrFields } from "./pgAttr.ts";

/**
 * Manages relation loading for repositories.
 * Handles one-to-one, one-to-many, and inverse (belongsTo) relations.
 */
export class RelationManager {
	/**
	 * Load relations for a single entity or multiple entities.
	 */
	async loadRelations(
		entities: any,
		withConfig: WithConfig,
		relations: RepositoryRelations,
		context: RelationLoadContext,
	): Promise<any> {
		const isArray = Array.isArray(entities);
		const entityArray = isArray ? entities : [entities];

		if (entityArray.length === 0) {
			return isArray ? [] : {};
		}

		// Process each relation
		for (const [relationName, relationConfig] of Object.entries(withConfig)) {
			const relationDef = relations[relationName];
			if (!relationDef) {
				throw new Error(
					`Relation "${relationName}" not defined in repository relations`,
				);
			}

			if (relationConfig === true) {
				// Simple: just load the relation
				await this.loadRelation(
					entityArray,
					relationName,
					relationDef,
					{},
					context,
				);
			} else if (typeof relationConfig === "object") {
				// Advanced: load with query options
				await this.loadRelation(
					entityArray,
					relationName,
					relationDef,
					relationConfig,
					context,
				);
			}
		}

		return isArray ? entityArray : entityArray[0];
	}

	/**
	 * Load a single relation for entities.
	 */
	private async loadRelation(
		entities: any[],
		relationName: string,
		relationDef: RepositoryRelations[string],
		options: RelationOptions,
		context: RelationLoadContext,
	): Promise<void> {
		if (relationDef.type === "one" || relationDef.type === "many") {
			// One-to-one or One-to-many: related entities reference this entity
			await this.loadForwardRelation(
				entities,
				relationName,
				relationDef,
				options,
				context,
			);
		} else if (relationDef.type === "inverse") {
			// Inverse: this entity references the related entity
			await this.loadInverseRelation(
				entities,
				relationName,
				relationDef,
				options,
				context,
			);
		}
	}

	/**
	 * Load forward relation (one-to-one, one-to-many).
	 * The related entity has a foreign key pointing to this entity.
	 */
	private async loadForwardRelation(
		entities: any[],
		relationName: string,
		relationDef: Extract<RepositoryRelations[string], { type: "one" | "many" }>,
		options: RelationOptions,
		context: RelationLoadContext,
	): Promise<void> {
		const foreignKey = relationDef.foreignKey;

		// Get IDs from parent entities
		const parentIds = entities
			.map((entity) => entity[context.primaryKey])
			.filter((id) => id != null);

		if (parentIds.length === 0) {
			// No IDs to query, set empty relations
			for (const entity of entities) {
				entity[relationName] = relationDef.type === "many" ? [] : undefined;
			}
			return;
		}

		// Build query for related entities
		const where: any = {
			[foreignKey]: { inArray: parentIds },
			...((options.where as any) || {}),
		};

		// Query related entities using the repository finder
		const relatedEntities = await context.findRelated(
			relationDef.from,
			{
				where,
				orderBy: options.orderBy,
				limit: options.limit,
			} as any,
			options.with,
		);

		// Map related entities to parent entities
		if (relationDef.type === "many") {
			// One-to-many: group by foreign key
			const groupedByFK = new Map<any, any[]>();

			for (const related of relatedEntities) {
				const fkValue = related[foreignKey];
				if (!groupedByFK.has(fkValue)) {
					groupedByFK.set(fkValue, []);
				}
				groupedByFK.get(fkValue)!.push(related);
			}

			for (const entity of entities) {
				const entityId = entity[context.primaryKey];
				entity[relationName] = groupedByFK.get(entityId) || [];
			}
		} else {
			// One-to-one: map by foreign key
			const mappedByFK = new Map<any, any>();

			for (const related of relatedEntities) {
				const fkValue = related[foreignKey];
				if (!mappedByFK.has(fkValue)) {
					mappedByFK.set(fkValue, related);
				}
			}

			for (const entity of entities) {
				const entityId = entity[context.primaryKey];
				entity[relationName] = mappedByFK.get(entityId) || undefined;
			}
		}
	}

	/**
	 * Load inverse relation (belongsTo).
	 * This entity has a foreign key pointing to the related entity.
	 */
	private async loadInverseRelation(
		entities: any[],
		relationName: string,
		relationDef: Extract<RepositoryRelations[string], { type: "inverse" }>,
		options: RelationOptions,
		context: RelationLoadContext,
	): Promise<void> {
		const foreignKey = relationDef.foreignKey;

		// Get foreign key values from entities
		const foreignKeyValues = entities
			.map((entity) => entity[foreignKey])
			.filter((fk) => fk != null);

		if (foreignKeyValues.length === 0) {
			// No foreign keys, set undefined
			for (const entity of entities) {
				entity[relationName] = undefined;
			}
			return;
		}

		// Get the related table from the relation definition
		const relatedTable = relationDef.from;
		const relatedSchema = relatedTable.$schema;
		const relatedPrimaryKey = this.getPrimaryKeyName(relatedSchema);

		// Build query
		const where: PgQueryWhere<TObject> = {
			[relatedPrimaryKey]: { inArray: foreignKeyValues },
			...(options.where || {}),
		};

		// Query related entities
		const relatedEntities = await context.findRelated(
			relatedTable,
			{
				where,
				orderBy: options.orderBy,
				limit: options.limit,
			} as any,
			options.with,
		);

		// Map related entities to parent entities by their primary key
		const mappedByPK = new Map<any, any>();
		for (const related of relatedEntities) {
			const pkValue = related[relatedPrimaryKey];
			mappedByPK.set(pkValue, related);
		}

		for (const entity of entities) {
			const fkValue = entity[foreignKey];
			entity[relationName] = mappedByPK.get(fkValue) || undefined;
		}
	}

	/**
	 * Get primary key name from schema.
	 */
	private getPrimaryKeyName(schema: TObject): string {
		const primaryKeys = getAttrFields(schema, PG_PRIMARY_KEY);
		if (primaryKeys.length === 0) {
			throw new Error("Primary key not found in schema");
		}
		return primaryKeys[0].key;
	}
}

/**
 * Configuration for loading relations in a query.
 */
export type WithRelations = {
	[relationName: string]:
		| true
		| {
				where?: any;
				orderBy?: string | any;
				limit?: number;
				with?: any; // Nested relations
		  };
};

/**
 * Configuration for loading relations.
 */
export type WithConfig = WithRelations;

/**
 * Options for loading a single relation.
 */
export interface RelationOptions {
	where?: PgQueryWhere<TObject>;
	orderBy?: string | any;
	limit?: number;
	with?: WithConfig; // Nested relations
}

/**
 * Context provided by the repository for loading relations.
 */
export interface RelationLoadContext {
	/**
	 * Primary key name of the current entity.
	 */
	primaryKey: string;

	/**
	 * Function to find related entities.
	 */
	findRelated: (
		table: { $schema: TObject },
		query: {
			where?: PgQueryWhere<TObject>;
			orderBy?: string | any;
			limit?: number;
		},
		nestedWith?: WithConfig,
		relationRegistry?: RelationRegistry,
	) => Promise<any[]>;

	/**
	 * Resolve the table for an inverse relation based on foreign key.
	 */
	resolveInverseTable: (foreignKey: string) => { $schema: TObject } | undefined;

	/**
	 * Registry of all relations for all tables.
	 */
	relationRegistry?: RelationRegistry;
}

/**
 * Registry that maps tables to their relation definitions.
 */
export type RelationRegistry = Map<any, RepositoryRelations>;

/**
 * Configuration for defining relations between repositories.
 *
 * Relations allow you to load related entities without circular dependencies by:
 * - Defining relations at the repository level (not in entities)
 * - Using lazy references to avoid import cycles
 * - Supporting one-to-one, one-to-many, and inverse (belongsTo) relations
 *
 * @example
 * ```ts
 * const users = $repository(User, {
 *   // One-to-many: user has many posts
 *   posts: {
 *     type: 'many',
 *     from: Posts, // the related entity table
 *     foreignKey: 'authorId', // posts.authorId -> users.id
 *   },
 *   // One-to-one: user has one profile
 *   profile: {
 *     type: 'one',
 *     from: Profile,
 *     foreignKey: 'userId', // profile.userId -> users.id
 *   }
 * });
 *
 * const posts = $repository(Post, {
 *   // Many-to-one (inverse): post belongs to one user
 *   author: {
 *     type: 'inverse',
 *     from: User,
 *     foreignKey: 'authorId', // reuses FK from entity schema
 *   }
 * });
 * ```
 */
export interface RepositoryRelations {
	[relationName: string]:
		| {
				/**
				 * One-to-one relation: the current entity has exactly one related entity.
				 * Example: User has one Account
				 */
				type: "one";
				/**
				 * The related entity table (must have $schema).
				 */
				from: { $schema: TObject };
				/**
				 * The foreign key column in the related entity that references this entity's primary key.
				 * Example: Account.userId references User.id
				 */
				foreignKey: string;
		  }
		| {
				/**
				 * One-to-many relation: the current entity has multiple related entities.
				 * Example: User has many Posts
				 */
				type: "many";
				/**
				 * The related entity table (must have $schema).
				 */
				from: { $schema: TObject };
				/**
				 * The foreign key column in the related entity that references this entity's primary key.
				 * Example: Post.authorId references User.id
				 */
				foreignKey: string;
		  }
		| {
				/**
				 * Inverse (belongsTo) relation: the current entity belongs to one parent entity.
				 * This is the "many" side of a one-to-many or the other side of a one-to-one.
				 * Example: Post belongs to one User
				 *
				 * Note: The foreign key must already exist in the current entity's schema (defined with pg.ref).
				 */
				type: "inverse";
				/**
				 * The related entity table (must have $schema).
				 */
				from: { $schema: TObject };
				/**
				 * The foreign key column in the current entity's schema.
				 * This should match a column defined with pg.ref() in the entity.
				 */
				foreignKey: string;
		  };
}
