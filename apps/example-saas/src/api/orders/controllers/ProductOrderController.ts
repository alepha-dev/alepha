import { $inject, type Page, t } from "alepha";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { $action } from "alepha/server";
import { ProductOrderAudits } from "../../audits/index.ts";
import { bookings } from "../../bookings/entities/bookings.ts";
import { customers } from "../../customers/entities/customers.ts";
import { products } from "../../products/entities/products.ts";
import {
  type OrderItem,
  type ProductOrder,
  productOrders,
} from "../entities/productOrders.ts";

export class ProductOrderController {
  protected readonly log = $logger();
  protected readonly orders = $repository(productOrders);
  protected readonly products = $repository(products);
  protected readonly customers = $repository(customers);
  protected readonly bookings = $repository(bookings);
  protected readonly orderAudits = $inject(ProductOrderAudits);

  // ─────────────────────────────────────────────────────────────────────────────
  // Helper Methods
  // ─────────────────────────────────────────────────────────────────────────────

  protected async generateOrderNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `ORD-${year}-`;

    // Find the highest order number for this year
    const existing = await this.orders.findMany({
      where: { orderNumber: { like: `${prefix}%` } },
      orderBy: [{ column: "orderNumber", direction: "desc" }],
      limit: 1,
    });

    let sequence = 1;
    if (existing.length > 0) {
      const lastNumber = existing[0].orderNumber;
      const lastSequence = Number.parseInt(lastNumber.split("-")[2], 10);
      sequence = lastSequence + 1;
    }

    return `${prefix}${sequence.toString().padStart(6, "0")}`;
  }

  protected calculateOrderTotals(items: OrderItem[]): {
    subtotal: number;
    taxAmount: number;
    total: number;
    itemCount: number;
  } {
    let subtotal = 0;
    let taxAmount = 0;
    let itemCount = 0;

    for (const item of items) {
      subtotal += item.subtotal;
      taxAmount += item.taxAmount;
      itemCount += item.quantity;
    }

    return {
      subtotal,
      taxAmount,
      total: subtotal + taxAmount,
      itemCount,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Public Actions (Customer-facing)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Create a standalone product order.
   * POST /orders
   */
  createOrder = $action({
    method: "POST",
    path: "/orders",
    secure: false,
    description: "Create a new product order",
    schema: {
      body: t.object({
        customerId: t.optional(t.uuid()),
        customerEmail: t.optional(t.email()),
        customerName: t.optional(t.text()),
        channel: t.optional(
          t.enum(["web", "mobile", "station", "onboard", "agent"]),
        ),
        items: t.array(
          t.object({
            productId: t.uuid(),
            quantity: t.integer({ minimum: 1 }),
          }),
        ),
        voucherCode: t.optional(t.text()),
        deliveryMethod: t.optional(
          t.enum(["pickup", "seat_delivery", "lounge", "station"]),
        ),
        deliveryLocation: t.optional(t.text()),
        deliveryNotes: t.optional(t.text()),
        notes: t.optional(t.text()),
      }),
      response: productOrders.schema,
    },
    handler: async ({ body }) => {
      this.log.info("Creating standalone order", {
        customerId: body.customerId,
        itemCount: body.items.length,
      });

      // Build order items with product snapshots
      const orderItems: OrderItem[] = [];

      for (const item of body.items) {
        const product = await this.products.findById(item.productId);

        if (!product.active) {
          throw new Error(`Product ${product.name} is not available`);
        }

        // Check stock if tracked
        if (product.trackStock && product.stock !== undefined) {
          if (product.stock < item.quantity) {
            throw new Error(
              `Insufficient stock for ${product.name}. Available: ${product.stock}`,
            );
          }
        }

        // Check quantity limits
        if (item.quantity < product.minQuantity) {
          throw new Error(
            `Minimum quantity for ${product.name} is ${product.minQuantity}`,
          );
        }
        if (
          product.maxQuantity !== undefined &&
          item.quantity > product.maxQuantity
        ) {
          throw new Error(
            `Maximum quantity for ${product.name} is ${product.maxQuantity}`,
          );
        }

        const subtotal = product.price * item.quantity;
        const taxRate = product.taxRate ?? 0;
        const taxAmount = subtotal * (taxRate / 100);

        orderItems.push({
          productId: product.id,
          productName: product.name,
          productSku: product.sku,
          category: product.category,
          quantity: item.quantity,
          unitPrice: product.price,
          taxRate,
          subtotal,
          taxAmount,
          total: subtotal + taxAmount,
          status: "pending",
        });
      }

      const totals = this.calculateOrderTotals(orderItems);
      const orderNumber = await this.generateOrderNumber();

      // Get customer info if customerId provided
      const customerEmail = body.customerEmail;
      let customerName = body.customerName;

      if (body.customerId) {
        try {
          const customer = await this.customers.findById(body.customerId);
          customerName =
            customerName ?? `${customer.firstName} ${customer.lastName}`;
        } catch {
          // Customer not found, use provided info
        }
      }

      const order = await this.orders.create({
        orderNumber,
        customerId: body.customerId,
        customerEmail,
        customerName,
        channel: body.channel ?? "web",
        isBookingAddOn: false,
        status: "pending",
        items: orderItems,
        itemCount: totals.itemCount,
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        discountAmount: 0,
        total: totals.total,
        currency: "EUR",
        voucherCode: body.voucherCode,
        paymentStatus: "pending",
        deliveryMethod: body.deliveryMethod,
        deliveryLocation: body.deliveryLocation,
        deliveryNotes: body.deliveryNotes,
        notes: body.notes,
      });

      this.log.info("Order created", {
        orderId: order.id,
        orderNumber: order.orderNumber,
        total: order.total,
      });

      await this.orderAudits.audit.logSuccess("create", {
        resourceType: "product_order",
        resourceId: order.id,
        description: `Order ${order.orderNumber} created`,
        metadata: {
          orderNumber: order.orderNumber,
          channel: order.channel,
          itemCount: order.itemCount,
          total: order.total,
        },
      });

      return order;
    },
  });

  /**
   * Create order for booking add-ons.
   * POST /orders/booking/:bookingId
   */
  createBookingAddOns = $action({
    method: "POST",
    path: "/orders/booking/:bookingId",
    secure: false,
    description: "Create product order for booking add-ons",
    schema: {
      params: t.object({ bookingId: t.uuid() }),
      body: t.object({
        items: t.array(
          t.object({
            productId: t.uuid(),
            quantity: t.integer({ minimum: 1 }),
          }),
        ),
      }),
      response: productOrders.schema,
    },
    handler: async ({ params, body }) => {
      const booking = await this.bookings.findById(params.bookingId);

      this.log.info("Creating booking add-on order", {
        bookingId: params.bookingId,
        itemCount: body.items.length,
      });

      // Build order items
      const orderItems: OrderItem[] = [];

      for (const item of body.items) {
        const product = await this.products.findById(item.productId);

        if (!product.active) {
          throw new Error(`Product ${product.name} is not available`);
        }

        // Check if product can be sold with booking
        if (product.sellType === "standalone") {
          throw new Error(
            `${product.name} cannot be purchased as a booking add-on`,
          );
        }

        const subtotal = product.price * item.quantity;
        const taxRate = product.taxRate ?? 0;
        const taxAmount = subtotal * (taxRate / 100);

        orderItems.push({
          productId: product.id,
          productName: product.name,
          productSku: product.sku,
          category: product.category,
          quantity: item.quantity,
          unitPrice: product.price,
          taxRate,
          subtotal,
          taxAmount,
          total: subtotal + taxAmount,
          status: "pending",
        });
      }

      const totals = this.calculateOrderTotals(orderItems);
      const orderNumber = await this.generateOrderNumber();

      const order = await this.orders.create({
        orderNumber,
        customerEmail: booking.passengerEmail,
        customerName: `${booking.passengerFirstName} ${booking.passengerLastName}`,
        bookingId: params.bookingId,
        channel: "web",
        isBookingAddOn: true,
        status: "pending",
        items: orderItems,
        itemCount: totals.itemCount,
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        discountAmount: 0,
        total: totals.total,
        currency: "EUR",
        paymentStatus: "pending",
      });

      this.log.info("Booking add-on order created", {
        orderId: order.id,
        bookingId: params.bookingId,
        total: order.total,
      });

      await this.orderAudits.audit.logSuccess("create", {
        resourceType: "product_order",
        resourceId: order.id,
        description: `Booking add-on order ${order.orderNumber} created`,
        metadata: {
          orderNumber: order.orderNumber,
          bookingId: params.bookingId,
          itemCount: order.itemCount,
          total: order.total,
        },
      });

      return order;
    },
  });

  /**
   * Get order by ID.
   * GET /orders/:id
   */
  getOrder = $action({
    path: "/orders/:id",
    secure: false,
    description: "Get order by ID",
    schema: {
      params: t.object({ id: t.uuid() }),
      response: productOrders.schema,
    },
    handler: async ({ params }) => {
      return await this.orders.findById(params.id);
    },
  });

  /**
   * Get orders for a customer.
   * GET /orders/customer/:customerId
   */
  getCustomerOrders = $action({
    path: "/orders/customer/:customerId",
    secure: false,
    description: "Get orders for a customer",
    schema: {
      params: t.object({ customerId: t.uuid() }),
      query: t.object({
        page: t.optional(t.integer({ minimum: 0 })),
        size: t.optional(t.integer({ minimum: 1, maximum: 50 })),
      }),
      response: t.page(productOrders.schema),
    },
    handler: async ({ params, query }) => {
      const page = query.page ?? 0;
      const size = query.size ?? 10;

      return (await this.orders.paginate(
        { page, size },
        {
          where: { customerId: { eq: params.customerId } },
          orderBy: [{ column: "createdAt", direction: "desc" }],
        },
      )) as Page<ProductOrder>;
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Admin Actions
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Find all orders with pagination and filtering.
   * GET /admin/orders
   */
  findOrders = $action({
    path: "/admin/orders",
    secure: false,
    description: "Find all orders with filters",
    schema: {
      query: t.object({
        page: t.optional(t.integer({ minimum: 0 })),
        size: t.optional(t.integer({ minimum: 1, maximum: 100 })),
        query: t.optional(t.text()),
        status: t.optional(
          t.enum([
            "pending",
            "confirmed",
            "processing",
            "fulfilled",
            "partially_fulfilled",
            "cancelled",
            "refunded",
          ]),
        ),
        channel: t.optional(
          t.enum(["web", "mobile", "station", "onboard", "agent"]),
        ),
        paymentStatus: t.optional(
          t.enum(["pending", "paid", "failed", "refunded"]),
        ),
        isBookingAddOn: t.optional(t.boolean()),
        customerId: t.optional(t.uuid()),
        bookingId: t.optional(t.uuid()),
        fromDate: t.optional(t.date()),
        toDate: t.optional(t.date()),
      }),
      response: t.page(productOrders.schema),
    },
    handler: async ({ query }) => {
      const page = query.page ?? 0;
      const size = query.size ?? 20;

      const where: Record<string, unknown> = {};

      if (query.status) {
        where.status = { eq: query.status };
      }
      if (query.channel) {
        where.channel = { eq: query.channel };
      }
      if (query.paymentStatus) {
        where.paymentStatus = { eq: query.paymentStatus };
      }
      if (query.isBookingAddOn !== undefined) {
        where.isBookingAddOn = { eq: query.isBookingAddOn };
      }
      if (query.customerId) {
        where.customerId = { eq: query.customerId };
      }
      if (query.bookingId) {
        where.bookingId = { eq: query.bookingId };
      }
      if (query.fromDate) {
        where.createdAt = { gte: query.fromDate };
      }
      if (query.toDate) {
        where.createdAt = {
          ...(where.createdAt as Record<string, unknown>),
          lte: `${query.toDate}T23:59:59Z`,
        };
      }
      if (query.query) {
        where.or = [
          { orderNumber: { ilike: `%${query.query}%` } },
          { customerName: { ilike: `%${query.query}%` } },
          { customerEmail: { ilike: `%${query.query}%` } },
        ];
      }

      return (await this.orders.paginate(
        { page, size },
        {
          where: Object.keys(where).length > 0 ? where : undefined,
          orderBy: [{ column: "createdAt", direction: "desc" }],
        },
      )) as Page<ProductOrder>;
    },
  });

  /**
   * Get order by ID (admin).
   * GET /admin/orders/:id
   */
  getOrderAdmin = $action({
    path: "/admin/orders/:id",
    secure: false,
    description: "Get order by ID",
    schema: {
      params: t.object({ id: t.uuid() }),
      response: productOrders.schema,
    },
    handler: async ({ params }) => {
      return await this.orders.findById(params.id);
    },
  });

  /**
   * Update order status.
   * PATCH /admin/orders/:id/status
   */
  updateOrderStatus = $action({
    method: "PATCH",
    path: "/admin/orders/:id/status",
    secure: false,
    description: "Update order status",
    schema: {
      params: t.object({ id: t.uuid() }),
      body: t.object({
        status: t.enum([
          "pending",
          "confirmed",
          "processing",
          "fulfilled",
          "partially_fulfilled",
          "cancelled",
          "refunded",
        ]),
        internalNotes: t.optional(t.text()),
      }),
      response: productOrders.schema,
    },
    handler: async ({ params, body }) => {
      const order = await this.orders.findById(params.id);
      const previousStatus = order.status;

      this.log.info("Updating order status", {
        orderId: params.id,
        from: previousStatus,
        to: body.status,
      });

      const updates: Partial<ProductOrder> = {
        status: body.status,
        internalNotes: body.internalNotes ?? order.internalNotes,
      };

      // Set timestamps based on status
      if (body.status === "fulfilled" && !order.fulfilledAt) {
        updates.fulfilledAt = new Date().toISOString();
      }
      if (body.status === "cancelled" && !order.cancelledAt) {
        updates.cancelledAt = new Date().toISOString();
      }
      if (body.status === "refunded" && !order.refundedAt) {
        updates.refundedAt = new Date().toISOString();
        updates.refundAmount = order.total;
      }

      const updated = await this.orders.updateById(params.id, updates);

      await this.orderAudits.audit.logSuccess("status_change", {
        resourceType: "product_order",
        resourceId: order.id,
        description: `Order ${order.orderNumber} status changed from ${previousStatus} to ${body.status}`,
        metadata: {
          orderNumber: order.orderNumber,
          previousStatus,
          newStatus: body.status,
        },
      });

      return updated;
    },
  });

  /**
   * Fulfill an order.
   * POST /admin/orders/:id/fulfill
   */
  fulfillOrder = $action({
    method: "POST",
    path: "/admin/orders/:id/fulfill",
    secure: false,
    description: "Mark order as fulfilled",
    schema: {
      params: t.object({ id: t.uuid() }),
      body: t.object({
        fulfilledBy: t.optional(t.uuid()),
        notes: t.optional(t.text()),
      }),
      response: productOrders.schema,
    },
    handler: async ({ params, body }) => {
      const order = await this.orders.findById(params.id);

      if (order.status === "cancelled" || order.status === "refunded") {
        throw new Error(`Cannot fulfill a ${order.status} order`);
      }

      this.log.info("Fulfilling order", { orderId: params.id });

      // Update all items to fulfilled
      const updatedItems = order.items.map((item) => ({
        ...item,
        status: "fulfilled" as const,
        fulfilledAt: new Date().toISOString(),
      }));

      // Deduct stock for tracked products
      for (const item of order.items) {
        const product = await this.products.findById(item.productId);
        if (product.trackStock && product.stock !== undefined) {
          await this.products.updateById(item.productId, {
            stock: Math.max(0, product.stock - item.quantity),
          });
        }
      }

      const updated = await this.orders.updateById(params.id, {
        status: "fulfilled",
        items: updatedItems,
        fulfilledAt: new Date().toISOString(),
        fulfilledBy: body.fulfilledBy,
        internalNotes: body.notes
          ? `${order.internalNotes ?? ""}\n[Fulfilled] ${body.notes}`.trim()
          : order.internalNotes,
      });

      await this.orderAudits.audit.logSuccess("fulfill", {
        resourceType: "product_order",
        resourceId: order.id,
        description: `Order ${order.orderNumber} fulfilled`,
        metadata: {
          orderNumber: order.orderNumber,
          fulfilledBy: body.fulfilledBy,
          itemCount: order.itemCount,
        },
      });

      return updated;
    },
  });

  /**
   * Cancel an order.
   * POST /admin/orders/:id/cancel
   */
  cancelOrder = $action({
    method: "POST",
    path: "/admin/orders/:id/cancel",
    secure: false,
    description: "Cancel an order",
    schema: {
      params: t.object({ id: t.uuid() }),
      body: t.object({
        reason: t.text(),
        cancelledBy: t.optional(t.uuid()),
      }),
      response: productOrders.schema,
    },
    handler: async ({ params, body }) => {
      const order = await this.orders.findById(params.id);

      if (order.status === "fulfilled") {
        throw new Error("Cannot cancel a fulfilled order. Use refund instead.");
      }
      if (order.status === "cancelled") {
        throw new Error("Order is already cancelled");
      }

      this.log.info("Cancelling order", { orderId: params.id });

      // Update all items to cancelled
      const updatedItems = order.items.map((item) => ({
        ...item,
        status: "cancelled" as const,
      }));

      const updated = await this.orders.updateById(params.id, {
        status: "cancelled",
        items: updatedItems,
        cancelledAt: new Date().toISOString(),
        cancelledBy: body.cancelledBy,
        cancellationReason: body.reason,
      });

      await this.orderAudits.audit.logSuccess("cancel", {
        severity: "warning",
        resourceType: "product_order",
        resourceId: order.id,
        description: `Order ${order.orderNumber} cancelled: ${body.reason}`,
        metadata: {
          orderNumber: order.orderNumber,
          reason: body.reason,
          total: order.total,
        },
      });

      return updated;
    },
  });

  /**
   * Refund an order.
   * POST /admin/orders/:id/refund
   */
  refundOrder = $action({
    method: "POST",
    path: "/admin/orders/:id/refund",
    secure: false,
    description: "Refund an order",
    schema: {
      params: t.object({ id: t.uuid() }),
      body: t.object({
        amount: t.optional(t.number({ minimum: 0 })),
        reason: t.text(),
        refundedBy: t.optional(t.uuid()),
      }),
      response: productOrders.schema,
    },
    handler: async ({ params, body }) => {
      const order = await this.orders.findById(params.id);

      if (order.paymentStatus !== "paid") {
        throw new Error("Cannot refund an unpaid order");
      }
      if (order.status === "refunded") {
        throw new Error("Order is already refunded");
      }

      const refundAmount = body.amount ?? order.total;

      this.log.info("Refunding order", {
        orderId: params.id,
        amount: refundAmount,
      });

      const updated = await this.orders.updateById(params.id, {
        status: "refunded",
        paymentStatus: "refunded",
        refundedAt: new Date().toISOString(),
        refundAmount,
        internalNotes:
          `${order.internalNotes ?? ""}\n[Refund] ${body.reason} - Amount: ${refundAmount}`.trim(),
      });

      await this.orderAudits.audit.logSuccess("refund", {
        severity: "warning",
        resourceType: "product_order",
        resourceId: order.id,
        description: `Order ${order.orderNumber} refunded: ${refundAmount} EUR`,
        metadata: {
          orderNumber: order.orderNumber,
          refundAmount,
          reason: body.reason,
        },
      });

      return updated;
    },
  });

  /**
   * Confirm payment for an order.
   * POST /admin/orders/:id/confirm-payment
   */
  confirmPayment = $action({
    method: "POST",
    path: "/admin/orders/:id/confirm-payment",
    secure: false,
    description: "Confirm payment for an order",
    schema: {
      params: t.object({ id: t.uuid() }),
      body: t.object({
        paymentId: t.optional(t.uuid()),
      }),
      response: productOrders.schema,
    },
    handler: async ({ params, body }) => {
      const order = await this.orders.findById(params.id);

      if (order.paymentStatus === "paid") {
        throw new Error("Order is already paid");
      }

      this.log.info("Confirming payment", { orderId: params.id });

      const updated = await this.orders.updateById(params.id, {
        status: order.status === "pending" ? "confirmed" : order.status,
        paymentStatus: "paid",
        paymentId: body.paymentId,
        paidAt: new Date().toISOString(),
      });

      await this.orderAudits.audit.logSuccess("payment", {
        resourceType: "product_order",
        resourceId: order.id,
        description: `Payment confirmed for order ${order.orderNumber}`,
        metadata: {
          orderNumber: order.orderNumber,
          total: order.total,
          paymentId: body.paymentId,
        },
      });

      return updated;
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Analytics & Reports
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get sales statistics.
   * GET /admin/orders/stats
   */
  getSalesStats = $action({
    path: "/admin/orders/stats",
    secure: false,
    description: "Get overall sales statistics",
    schema: {
      query: t.object({
        fromDate: t.optional(t.date()),
        toDate: t.optional(t.date()),
      }),
      response: t.object({
        totalOrders: t.integer(),
        totalRevenue: t.number(),
        averageOrderValue: t.number(),
        ordersByStatus: t.record(t.text(), t.integer()),
        ordersByChannel: t.record(t.text(), t.integer()),
        ordersByPaymentStatus: t.record(t.text(), t.integer()),
        bookingAddOns: t.integer(),
        standaloneOrders: t.integer(),
      }),
    },
    handler: async ({ query }) => {
      const where: Record<string, unknown> = {};

      if (query.fromDate) {
        where.createdAt = { gte: query.fromDate };
      }
      if (query.toDate) {
        where.createdAt = {
          ...(where.createdAt as Record<string, unknown>),
          lte: `${query.toDate}T23:59:59Z`,
        };
      }

      const orders = await this.orders.findMany({
        where: Object.keys(where).length > 0 ? where : undefined,
      });

      const stats = {
        totalOrders: orders.length,
        totalRevenue: 0,
        ordersByStatus: {} as Record<string, number>,
        ordersByChannel: {} as Record<string, number>,
        ordersByPaymentStatus: {} as Record<string, number>,
        bookingAddOns: 0,
        standaloneOrders: 0,
      };

      for (const order of orders) {
        // Only count revenue from paid orders
        if (order.paymentStatus === "paid" && order.status !== "refunded") {
          stats.totalRevenue += order.total;
        }

        // Count by status
        stats.ordersByStatus[order.status] =
          (stats.ordersByStatus[order.status] ?? 0) + 1;

        // Count by channel
        stats.ordersByChannel[order.channel] =
          (stats.ordersByChannel[order.channel] ?? 0) + 1;

        // Count by payment status
        stats.ordersByPaymentStatus[order.paymentStatus] =
          (stats.ordersByPaymentStatus[order.paymentStatus] ?? 0) + 1;

        // Count by type
        if (order.isBookingAddOn) {
          stats.bookingAddOns++;
        } else {
          stats.standaloneOrders++;
        }
      }

      return {
        ...stats,
        averageOrderValue:
          stats.totalOrders > 0 ? stats.totalRevenue / stats.totalOrders : 0,
      };
    },
  });

  /**
   * Get sales by product.
   * GET /admin/orders/stats/by-product
   */
  getSalesByProduct = $action({
    path: "/admin/orders/stats/by-product",
    secure: false,
    description: "Get sales statistics by product",
    schema: {
      query: t.object({
        fromDate: t.optional(t.date()),
        toDate: t.optional(t.date()),
        limit: t.optional(t.integer({ minimum: 1, maximum: 50 })),
      }),
      response: t.array(
        t.object({
          productId: t.uuid(),
          productName: t.text(),
          productSku: t.text(),
          category: t.text(),
          totalQuantity: t.integer(),
          totalRevenue: t.number(),
          orderCount: t.integer(),
        }),
      ),
    },
    handler: async ({ query }) => {
      const where: Record<string, unknown> = {
        paymentStatus: { eq: "paid" },
        status: { ne: "refunded" },
      };

      if (query.fromDate) {
        where.createdAt = { gte: query.fromDate };
      }
      if (query.toDate) {
        where.createdAt = {
          ...(where.createdAt as Record<string, unknown>),
          lte: `${query.toDate}T23:59:59Z`,
        };
      }

      const orders = await this.orders.findMany({ where });

      // Aggregate by product
      const productStats = new Map<
        string,
        {
          productId: string;
          productName: string;
          productSku: string;
          category: string;
          totalQuantity: number;
          totalRevenue: number;
          orderCount: number;
        }
      >();

      for (const order of orders) {
        for (const item of order.items) {
          if (item.status === "cancelled") continue;

          const existing = productStats.get(item.productId);
          if (existing) {
            existing.totalQuantity += item.quantity;
            existing.totalRevenue += item.total;
            existing.orderCount++;
          } else {
            productStats.set(item.productId, {
              productId: item.productId,
              productName: item.productName,
              productSku: item.productSku,
              category: item.category,
              totalQuantity: item.quantity,
              totalRevenue: item.total,
              orderCount: 1,
            });
          }
        }
      }

      // Sort by revenue and limit
      const sorted = Array.from(productStats.values()).sort(
        (a, b) => b.totalRevenue - a.totalRevenue,
      );

      return sorted.slice(0, query.limit ?? 20);
    },
  });

  /**
   * Get sales by category.
   * GET /admin/orders/stats/by-category
   */
  getSalesByCategory = $action({
    path: "/admin/orders/stats/by-category",
    secure: false,
    description: "Get sales statistics by category",
    schema: {
      query: t.object({
        fromDate: t.optional(t.date()),
        toDate: t.optional(t.date()),
      }),
      response: t.array(
        t.object({
          category: t.text(),
          totalQuantity: t.integer(),
          totalRevenue: t.number(),
          orderCount: t.integer(),
          productCount: t.integer(),
        }),
      ),
    },
    handler: async ({ query }) => {
      const where: Record<string, unknown> = {
        paymentStatus: { eq: "paid" },
        status: { ne: "refunded" },
      };

      if (query.fromDate) {
        where.createdAt = { gte: query.fromDate };
      }
      if (query.toDate) {
        where.createdAt = {
          ...(where.createdAt as Record<string, unknown>),
          lte: `${query.toDate}T23:59:59Z`,
        };
      }

      const orders = await this.orders.findMany({ where });

      // Aggregate by category
      const categoryStats = new Map<
        string,
        {
          category: string;
          totalQuantity: number;
          totalRevenue: number;
          orderCount: number;
          products: Set<string>;
        }
      >();

      for (const order of orders) {
        for (const item of order.items) {
          if (item.status === "cancelled") continue;

          const existing = categoryStats.get(item.category);
          if (existing) {
            existing.totalQuantity += item.quantity;
            existing.totalRevenue += item.total;
            existing.orderCount++;
            existing.products.add(item.productId);
          } else {
            categoryStats.set(item.category, {
              category: item.category,
              totalQuantity: item.quantity,
              totalRevenue: item.total,
              orderCount: 1,
              products: new Set([item.productId]),
            });
          }
        }
      }

      return Array.from(categoryStats.values())
        .map((stat) => ({
          category: stat.category,
          totalQuantity: stat.totalQuantity,
          totalRevenue: stat.totalRevenue,
          orderCount: stat.orderCount,
          productCount: stat.products.size,
        }))
        .sort((a, b) => b.totalRevenue - a.totalRevenue);
    },
  });

  /**
   * Get recent orders.
   * GET /admin/orders/recent
   */
  getRecentOrders = $action({
    path: "/admin/orders/recent",
    secure: false,
    description: "Get recent orders",
    schema: {
      query: t.object({
        limit: t.optional(t.integer({ minimum: 1, maximum: 50 })),
      }),
      response: t.array(productOrders.schema),
    },
    handler: async ({ query }) => {
      return await this.orders.findMany({
        orderBy: [{ column: "createdAt", direction: "desc" }],
        limit: query.limit ?? 10,
      });
    },
  });
}
