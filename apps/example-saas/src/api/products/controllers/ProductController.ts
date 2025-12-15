import { $inject, type Page, t } from "alepha";
import { FileService } from "alepha/api/files";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { $action, okSchema } from "alepha/server";
import { ProductAudits } from "../../audits/index.ts";
import { type Product, products } from "../entities/products.ts";

export class ProductController {
  protected readonly log = $logger();
  protected readonly products = $repository(products);
  protected readonly fileService = $inject(FileService);
  protected readonly productAudits = $inject(ProductAudits);

  // ─────────────────────────────────────────────────────────────────────────────
  // Public Actions
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get active products available for purchase.
   * GET /products
   */
  getProducts = $action({
    path: "/products",
    secure: false,
    description: "Get active products available for purchase",
    schema: {
      query: t.object({
        category: t.optional(
          t.enum([
            "food_beverage",
            "comfort",
            "entertainment",
            "travel_accessories",
            "merchandise",
            "insurance",
            "services",
          ]),
        ),
        sellType: t.optional(t.enum(["standalone", "with_booking", "both"])),
      }),
      response: t.array(products.schema),
    },
    handler: async ({ query }) => {
      const where: Record<string, unknown> = { active: { eq: true } };

      if (query.category) {
        where.category = { eq: query.category };
      }

      if (query.sellType) {
        // If asking for standalone, include 'standalone' and 'both'
        // If asking for with_booking, include 'with_booking' and 'both'
        if (query.sellType === "both") {
          where.sellType = { eq: "both" };
        } else {
          where.or = [
            { sellType: { eq: query.sellType } },
            { sellType: { eq: "both" } },
          ];
        }
      }

      return await this.products.findMany({
        where,
        orderBy: [
          { column: "sortOrder", direction: "asc" },
          { column: "name", direction: "asc" },
        ],
      });
    },
  });

  /**
   * Get a product by ID.
   * GET /products/:id
   */
  getProduct = $action({
    path: "/products/:id",
    secure: false,
    description: "Get a product by ID",
    schema: {
      params: t.object({ id: t.uuid() }),
      response: products.schema,
    },
    handler: async ({ params }) => {
      return await this.products.findById(params.id);
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Admin Actions
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Find all products with pagination and filtering.
   * GET /admin/products
   */
  findProducts = $action({
    path: "/admin/products",
    secure: false,
    description: "Find all products with pagination",
    schema: {
      query: t.object({
        page: t.optional(t.integer({ minimum: 0 })),
        size: t.optional(t.integer({ minimum: 1, maximum: 100 })),
        query: t.optional(t.text()),
        category: t.optional(
          t.enum([
            "food_beverage",
            "comfort",
            "entertainment",
            "travel_accessories",
            "merchandise",
            "insurance",
            "services",
          ]),
        ),
        sellType: t.optional(t.enum(["standalone", "with_booking", "both"])),
        active: t.optional(t.boolean()),
      }),
      response: t.page(products.schema),
    },
    handler: async ({ query }) => {
      const page = query.page ?? 0;
      const size = query.size ?? 10;

      const where: Record<string, unknown> = {};

      if (query.category) {
        where.category = { eq: query.category };
      }

      if (query.sellType) {
        where.sellType = { eq: query.sellType };
      }

      if (query.active !== undefined) {
        where.active = { eq: query.active };
      }

      if (query.query) {
        where.or = [
          { name: { ilike: `%${query.query}%` } },
          { sku: { ilike: `%${query.query}%` } },
          { description: { ilike: `%${query.query}%` } },
        ];
      }

      const result = await this.products.paginate(
        { page, size },
        {
          where: Object.keys(where).length > 0 ? where : undefined,
          orderBy: [
            { column: "sortOrder", direction: "asc" },
            { column: "name", direction: "asc" },
          ],
        },
      );

      return result as Page<Product>;
    },
  });

  /**
   * Get a product by ID (admin).
   * GET /admin/products/:id
   */
  getProductAdmin = $action({
    path: "/admin/products/:id",
    secure: false,
    description: "Get a product by ID",
    schema: {
      params: t.object({ id: t.uuid() }),
      response: products.schema,
    },
    handler: async ({ params }) => {
      return await this.products.findById(params.id);
    },
  });

  /**
   * Create a new product.
   * POST /admin/products
   */
  createProduct = $action({
    method: "POST",
    path: "/admin/products",
    secure: false,
    description: "Create a new product",
    schema: {
      body: t.object({
        name: t.text(),
        description: t.optional(t.text()),
        sku: t.text(),
        price: t.number({ minimum: 0 }),
        currency: t.optional(t.text()),
        category: t.enum([
          "food_beverage",
          "comfort",
          "entertainment",
          "travel_accessories",
          "merchandise",
          "insurance",
          "services",
        ]),
        sellType: t.optional(t.enum(["standalone", "with_booking", "both"])),
        imageId: t.optional(t.uuid()),
        stock: t.optional(t.integer({ minimum: 0 })),
        trackStock: t.optional(t.boolean()),
        active: t.optional(t.boolean()),
        minQuantity: t.optional(t.integer()),
        maxQuantity: t.optional(t.integer()),
        applicableFareClasses: t.optional(t.array(t.uuid())),
        taxRate: t.optional(t.number({ minimum: 0, maximum: 100 })),
        tags: t.optional(t.array(t.text())),
        sortOrder: t.optional(t.integer()),
      }),
      response: products.schema,
    },
    handler: async ({ body }) => {
      this.log.info("Creating product", { name: body.name, sku: body.sku });

      // Verify image exists if provided
      if (body.imageId) {
        await this.fileService.getFileById(body.imageId);
      }

      const product = await this.products.create({
        ...body,
        currency: body.currency ?? "EUR",
        sellType: body.sellType ?? "both",
        active: body.active ?? true,
        trackStock: body.trackStock ?? false,
        minQuantity: body.minQuantity ?? 1,
        sortOrder: body.sortOrder ?? 0,
      });

      this.log.info("Product created", { id: product.id, sku: product.sku });

      await this.productAudits.audit.logSuccess("create", {
        resourceType: "product",
        resourceId: product.id,
        description: `Product ${product.name} (${product.sku}) created`,
        metadata: {
          sku: product.sku,
          name: product.name,
          price: product.price,
          category: product.category,
          sellType: product.sellType,
        },
      });

      return product;
    },
  });

  /**
   * Update a product.
   * PATCH /admin/products/:id
   */
  updateProduct = $action({
    method: "PATCH",
    path: "/admin/products/:id",
    secure: false,
    description: "Update a product",
    schema: {
      params: t.object({ id: t.uuid() }),
      body: t.object({
        name: t.optional(t.text()),
        description: t.optional(t.text()),
        sku: t.optional(t.text()),
        price: t.optional(t.number({ minimum: 0 })),
        currency: t.optional(t.text()),
        category: t.optional(
          t.enum([
            "food_beverage",
            "comfort",
            "entertainment",
            "travel_accessories",
            "merchandise",
            "insurance",
            "services",
          ]),
        ),
        sellType: t.optional(t.enum(["standalone", "with_booking", "both"])),
        imageId: t.optional(t.uuid()),
        stock: t.optional(t.integer({ minimum: 0 })),
        trackStock: t.optional(t.boolean()),
        active: t.optional(t.boolean()),
        minQuantity: t.optional(t.integer()),
        maxQuantity: t.optional(t.integer()),
        applicableFareClasses: t.optional(t.array(t.uuid())),
        taxRate: t.optional(t.number({ minimum: 0, maximum: 100 })),
        tags: t.optional(t.array(t.text())),
        sortOrder: t.optional(t.integer()),
      }),
      response: products.schema,
    },
    handler: async ({ params, body }) => {
      this.log.info("Updating product", { id: params.id });

      // Verify new image exists if provided
      if (body.imageId) {
        await this.fileService.getFileById(body.imageId);
      }

      const product = await this.products.updateById(params.id, body);

      this.log.info("Product updated", { id: product.id, sku: product.sku });

      await this.productAudits.audit.logSuccess("update", {
        resourceType: "product",
        resourceId: product.id,
        description: `Product ${product.name} (${product.sku}) updated`,
        metadata: { updates: body },
      });

      return product;
    },
  });

  /**
   * Delete a product.
   * DELETE /admin/products/:id
   */
  deleteProduct = $action({
    method: "DELETE",
    path: "/admin/products/:id",
    secure: false,
    description: "Delete a product",
    schema: {
      params: t.object({ id: t.uuid() }),
      response: okSchema,
    },
    handler: async ({ params }) => {
      const product = await this.products.findById(params.id);

      this.log.info("Deleting product", { id: params.id, sku: product.sku });

      await this.products.deleteById(params.id);

      this.log.info("Product deleted", { id: params.id });

      await this.productAudits.audit.logSuccess("delete", {
        severity: "warning",
        resourceType: "product",
        resourceId: product.id,
        description: `Product ${product.name} (${product.sku}) deleted`,
        metadata: {
          sku: product.sku,
          name: product.name,
          price: product.price,
          category: product.category,
        },
      });

      return { ok: true };
    },
  });

  /**
   * Toggle product active status.
   * POST /admin/products/:id/toggle-active
   */
  toggleProductActive = $action({
    method: "POST",
    path: "/admin/products/:id/toggle-active",
    secure: false,
    description: "Toggle product active status",
    schema: {
      params: t.object({ id: t.uuid() }),
      response: products.schema,
    },
    handler: async ({ params }) => {
      const product = await this.products.findById(params.id);

      this.log.info("Toggling product active status", {
        id: params.id,
        currentlyActive: product.active,
      });

      const updated = await this.products.updateById(params.id, {
        active: !product.active,
      });

      this.log.info("Product active status toggled", {
        id: updated.id,
        active: updated.active,
      });

      await this.productAudits.audit.logSuccess(
        updated.active ? "activate" : "deactivate",
        {
          resourceType: "product",
          resourceId: updated.id,
          description: `Product ${updated.name} (${updated.sku}) ${updated.active ? "activated" : "deactivated"}`,
          metadata: {
            sku: updated.sku,
            name: updated.name,
            active: updated.active,
          },
        },
      );

      return updated;
    },
  });

  /**
   * Get product image info.
   * GET /admin/products/:id/image
   */
  getProductImage = $action({
    path: "/admin/products/:id/image",
    secure: false,
    description: "Get product image info",
    schema: {
      params: t.object({ id: t.uuid() }),
      response: t.object({
        imageId: t.optional(t.uuid()),
        imageUrl: t.optional(t.text()),
      }),
    },
    handler: async ({ params }) => {
      const product = await this.products.findById(params.id);

      if (!product.imageId) {
        return { imageId: undefined, imageUrl: undefined };
      }

      // The image can be accessed via /files/:imageId
      return {
        imageId: product.imageId,
        imageUrl: `/files/${product.imageId}`,
      };
    },
  });
}
