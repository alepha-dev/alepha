import {
  type Infer,
  type ZObject,
  type ZodArray,
  type ZodRecord,
  z,
} from "../providers/ZodProvider.ts";
import type { pageMetadataSchema } from "./pageMetadataSchema.ts";

/**
 * Create a pagination schema for the given object schema.
 *
 * Provides a standardized pagination response format compatible with Spring Data's Page interface.
 * This schema can be used across any data source (databases, APIs, caches, etc.).
 *
 * @example
 * ```ts
 * const userSchema = z.object({ id: z.integer(), name: z.text() });
 * const userPageSchema = pageSchema(userSchema);
 * ```
 *
 * @example In an API endpoint
 * ```ts
 * listUsers = $action({
 *   method: "GET",
 *   path: "/users",
 *   schema: { response: pageSchema(UserSchema) },
 *   handler: async () => {
 *     return await userRepo.paginate();
 *   }
 * })
 * ```
 */
export const pageSchema = <T extends ZObject | ZodRecord>(
  objectSchema: T,
): TPage<T> => z.page(objectSchema) as unknown as TPage<T>;

export type TPage<T extends ZObject | ZodRecord> = ZObject<{
  content: ZodArray<T>;
  page: typeof pageMetadataSchema;
}>;

/**
 * Opinionated type definition for a paginated response.
 *
 * Inspired by Spring Data's Page interface with all essential pagination metadata.
 * This generic type can be used with any data source.
 *
 * @example
 * ```ts
 * const page: Page<User> = {
 *   content: [user1, user2, ...],
 *   page: {
 *     number: 0,
 *     size: 10,
 *     offset: 0,
 *     numberOfElements: 10,
 *     totalElements: 1200,
 *     totalPages: 120,
 *     isEmpty: false,
 *     isFirst: true,
 *     isLast: false,
 *     sort: {
 *       sorted: true,
 *       fields: [
 *         { field: "name", direction: "asc" }
 *       ]
 *     }
 *   }
 * }
 * ```
 */
export type Page<T> = {
  /**
   * Array of items on the current page.
   */
  content: T[];
  page: Infer<typeof pageMetadataSchema>;
};
