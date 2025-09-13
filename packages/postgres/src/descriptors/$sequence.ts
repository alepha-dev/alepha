import { $inject, createDescriptor, Descriptor, KIND } from "@alepha/core";
import { sql } from "drizzle-orm";
import { PostgresProvider } from "../providers/drivers/PostgresProvider.ts";

/**
 * Creates a PostgreSQL sequence descriptor for generating unique numeric values.
 *
 * This descriptor provides a type-safe interface to PostgreSQL sequences, which are
 * database objects that generate unique numeric identifiers. Sequences are commonly
 * used for primary keys, order numbers, invoice numbers, and other cases where
 * guaranteed unique, incrementing values are needed across concurrent operations.
 *
 * **Key Features**
 *
 * - **Thread-Safe**: PostgreSQL sequences are inherently thread-safe and handle concurrency
 * - **Configurable Parameters**: Start value, increment, min/max bounds, and cycling behavior
 * - **Automatic Creation**: Sequences are created automatically when first used
 * - **Type Safety**: Full TypeScript support with numeric return types
 * - **Performance**: Optimized for high-throughput ID generation
 * - **Schema Support**: Works with PostgreSQL schemas for organization
 *
 * **Use Cases**
 *
 * Perfect for generating unique identifiers in concurrent environments:
 * - Primary key generation (alternative to UUIDs)
 * - Order numbers and invoice sequences
 * - Ticket numbers and reference IDs
 * - Version numbers and revision tracking
 * - Batch numbers for processing workflows
 * - Any scenario requiring guaranteed unique incrementing numbers
 *
 * @example
 * **Basic sequence for order numbers:**
 * ```ts
 * import { $sequence } from "@alepha/postgres";
 *
 * class OrderService {
 *   orderNumbers = $sequence({
 *     name: "order_numbers",
 *     start: 1000,      // Start from order #1000
 *     increment: 1      // Increment by 1 each time
 *   });
 *
 *   async createOrder(orderData: OrderData) {
 *     const orderNumber = await this.orderNumbers.next();
 *
 *     return await this.orders.create({
 *       id: generateUUID(),
 *       orderNumber,
 *       ...orderData
 *     });
 *   }
 *
 *   async getCurrentOrderNumber() {
 *     // Get the last generated number without incrementing
 *     return await this.orderNumbers.current();
 *   }
 * }
 * ```
 *
 * @example
 * **Invoice numbering with yearly reset:**
 * ```ts
 * class InvoiceService {
 *   // Separate sequence for each year
 *   getInvoiceSequence(year: number) {
 *     return $sequence({
 *       name: `invoice_numbers_${year}`,
 *       start: 1,
 *       increment: 1
 *     });
 *   }
 *
 *   async generateInvoiceNumber(): Promise<string> {
 *     const year = new Date().getFullYear();
 *     const sequence = this.getInvoiceSequence(year);
 *     const number = await sequence.next();
 *
 *     // Format as INV-2024-001, INV-2024-002, etc.
 *     return `INV-${year}-${number.toString().padStart(3, '0')}`;
 *   }
 * }
 * ```
 *
 * @example
 * **High-performance ID generation with custom increments:**
 * ```ts
 * class TicketService {
 *   // Generate ticket numbers in increments of 10 for better distribution
 *   ticketSequence = $sequence({
 *     name: "ticket_numbers",
 *     start: 1000,
 *     increment: 10,
 *     min: 1000,
 *     max: 999999,
 *     cycle: false  // Don't cycle when max is reached
 *   });
 *
 *   priorityTicketSequence = $sequence({
 *     name: "priority_ticket_numbers",
 *     start: 1,
 *     increment: 1,
 *     min: 1,
 *     max: 999,
 *     cycle: true   // Cycle when reaching max
 *   });
 *
 *   async generateTicketNumber(isPriority: boolean = false): Promise<number> {
 *     if (isPriority) {
 *       return await this.priorityTicketSequence.next();
 *     }
 *     return await this.ticketSequence.next();
 *   }
 *
 *   async getSequenceStatus() {
 *     return {
 *       currentTicketNumber: await this.ticketSequence.current(),
 *       currentPriorityNumber: await this.priorityTicketSequence.current()
 *     };
 *   }
 * }
 * ```
 *
 * @example
 * **Batch processing with sequence-based coordination:**
 * ```ts
 * class BatchProcessor {
 *   batchSequence = $sequence({
 *     name: "batch_numbers",
 *     start: 1,
 *     increment: 1
 *   });
 *
 *   async processBatch(items: any[]) {
 *     const batchNumber = await this.batchSequence.next();
 *
 *     console.log(`Starting batch processing #${batchNumber} with ${items.length} items`);
 *
 *     try {
 *       // Process items with batch number for tracking
 *       for (const item of items) {
 *         await this.processItem(item, batchNumber);
 *       }
 *
 *       await this.auditLogger.log({
 *         event: 'batch_completed',
 *         batchNumber,
 *         itemCount: items.length,
 *         timestamp: new Date()
 *       });
 *
 *       return { batchNumber, processedCount: items.length };
 *
 *     } catch (error) {
 *       await this.auditLogger.log({
 *         event: 'batch_failed',
 *         batchNumber,
 *         error: error.message,
 *         timestamp: new Date()
 *       });
 *       throw error;
 *     }
 *   }
 *
 *   async processItem(item: any, batchNumber: number) {
 *     // Associate item processing with batch number
 *     await this.items.update(item.id, {
 *       ...item.updates,
 *       batchNumber,
 *       processedAt: new Date()
 *     });
 *   }
 * }
 * ```
 *
 * @example
 * **Multi-tenant sequence management:**
 * ```ts
 * class TenantSequenceService {
 *   // Create tenant-specific sequences
 *   getTenantSequence(tenantId: string, sequenceType: string) {
 *     return $sequence({
 *       name: `${tenantId}_${sequenceType}_seq`,
 *       start: 1,
 *       increment: 1
 *     });
 *   }
 *
 *   async generateTenantOrderNumber(tenantId: string): Promise<string> {
 *     const sequence = this.getTenantSequence(tenantId, 'orders');
 *     const number = await sequence.next();
 *
 *     return `${tenantId.toUpperCase()}-ORD-${number.toString().padStart(6, '0')}`;
 *   }
 *
 *   async generateTenantInvoiceNumber(tenantId: string): Promise<string> {
 *     const sequence = this.getTenantSequence(tenantId, 'invoices');
 *     const number = await sequence.next();
 *
 *     return `${tenantId.toUpperCase()}-INV-${number.toString().padStart(6, '0')}`;
 *   }
 *
 *   async getTenantSequenceStatus(tenantId: string) {
 *     const orderSeq = this.getTenantSequence(tenantId, 'orders');
 *     const invoiceSeq = this.getTenantSequence(tenantId, 'invoices');
 *
 *     return {
 *       tenant: tenantId,
 *       sequences: {
 *         orders: {
 *           current: await orderSeq.current(),
 *           next: await orderSeq.next()
 *         },
 *         invoices: {
 *           current: await invoiceSeq.current()
 *         }
 *       }
 *     };
 *   }
 * }
 * ```
 *
 * **Important Notes**:
 * - Sequences are created automatically when first used
 * - PostgreSQL sequences are atomic and handle high concurrency
 * - Sequence values are not rolled back in failed transactions
 * - Consider the impact of max values and cycling behavior
 * - Sequences are schema-scoped in PostgreSQL
 *
 * @stability 1
 */
export const $sequence = (
	options: SequenceDescriptorOptions = {},
): SequenceDescriptor => {
	return createDescriptor(SequenceDescriptor, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export interface SequenceDescriptorOptions {
	/**
	 * Name of the PostgreSQL sequence to create.
	 *
	 * This name:
	 * - Must be unique within the database schema
	 * - Should follow PostgreSQL identifier conventions
	 * - Will be used in generated SQL for sequence operations
	 * - Should be descriptive of the sequence's purpose
	 *
	 * If not provided, defaults to the property key where the sequence is declared.
	 *
	 * **Naming Guidelines**:
	 * - Use descriptive names like "order_numbers", "invoice_seq"
	 * - Include the purpose or entity type in the name
	 * - Consider adding "_seq" suffix for clarity
	 * - Use snake_case for consistency with PostgreSQL conventions
	 *
	 * @example "order_numbers"
	 * @example "invoice_sequence"
	 * @example "ticket_numbers_seq"
	 */
	name?: string;

	/**
	 * The starting value for the sequence.
	 *
	 * This value:
	 * - Determines the first number that will be generated
	 * - Can be any integer within the sequence's range
	 * - Is useful for avoiding conflicts with existing data
	 * - Can be set higher for business reasons (e.g., starting invoices at 1000)
	 *
	 * **Common Patterns**:
	 * - Start at 1 for simple counters
	 * - Start at 1000+ for professional-looking numbers
	 * - Start at current max + 1 when migrating existing data
	 *
	 * @default 1
	 * @example 1     // Simple counter starting at 1
	 * @example 1000  // Professional numbering starting at 1000
	 * @example 10000 // Large starting number for established businesses
	 */
	start?: number;

	/**
	 * The increment value for each call to next().
	 *
	 * This value:
	 * - Determines how much the sequence increases each time
	 * - Can be any positive or negative integer
	 * - Affects the gaps between generated numbers
	 * - Can be used for number distribution strategies
	 *
	 * **Use Cases**:
	 * - increment: 1 for consecutive numbering
	 * - increment: 10 for distributed numbering (leaves gaps for manual entries)
	 * - increment: -1 for countdown sequences
	 *
	 * @default 1
	 * @example 1   // Standard consecutive numbering
	 * @example 10  // Leave gaps between numbers
	 * @example 100 // Large gaps for special numbering schemes
	 */
	increment?: number;

	/**
	 * The minimum value the sequence can generate.
	 *
	 * When the sequence reaches this value:
	 * - It cannot generate values below this minimum
	 * - Helps prevent negative numbers in contexts where they don't make sense
	 * - Works with cycling behavior to define the lower bound
	 *
	 * **Considerations**:
	 * - Set to 1 for positive-only sequences
	 * - Set to 0 if zero values are acceptable
	 * - Consider business rules about minimum valid numbers
	 *
	 * @example 1     // No zero or negative values
	 * @example 0     // Allow zero values
	 * @example 1000  // Maintain minimum professional appearance
	 */
	min?: number;

	/**
	 * The maximum value the sequence can generate.
	 *
	 * When the sequence reaches this value:
	 * - It cannot generate values above this maximum
	 * - Behavior depends on the cycle option
	 * - Useful for preventing overflow or limiting number ranges
	 *
	 * **Planning Considerations**:
	 * - Consider the expected volume of your application
	 * - Account for business growth over time
	 * - Factor in any formatting constraints (e.g., fixed-width displays)
	 * - Remember that PostgreSQL sequences can handle very large numbers
	 *
	 * @example 999999    // Six-digit limit
	 * @example 2147483647 // Maximum 32-bit signed integer
	 * @example 9999      // Four-digit limit for display purposes
	 */
	max?: number;

	/**
	 * Whether the sequence should cycle back to the minimum when it reaches the maximum.
	 *
	 * **cycle: true**:
	 * - When max is reached, next value will be the minimum value
	 * - Useful for scenarios where number reuse is acceptable
	 * - Common for temporary identifiers or rotating references
	 *
	 * **cycle: false (default)**:
	 * - When max is reached, further calls will fail with an error
	 * - Prevents unexpected number reuse
	 * - Better for permanent identifiers where uniqueness is critical
	 *
	 * **Use Cases for Cycling**:
	 * - Temporary ticket numbers that can be reused
	 * - Session IDs with limited lifetime
	 * - Batch numbers in rotating systems
	 *
	 * **Avoid Cycling For**:
	 * - Primary keys and permanent identifiers
	 * - Invoice numbers and financial references
	 * - Audit logs and compliance records
	 *
	 * @default false
	 */
	cycle?: boolean;
}

// ---------------------------------------------------------------------------------------------------------------------

export class SequenceDescriptor extends Descriptor<SequenceDescriptorOptions> {
	protected readonly provider = $inject(PostgresProvider);
	protected created = false;

	public get name(): string {
		return this.options.name ?? this.config.propertyKey;
	}

	protected async create(): Promise<void> {
		if (this.created) {
			return;
		}

		const options = this.options;
		const query = sql`CREATE SEQUENCE IF NOT EXISTS ${sql.raw(this.provider.schema)}."${sql.raw(this.name)}" `;

		if (options.increment != null) {
			query.append(sql`INCREMENT BY ${sql.raw(String(options.increment))} `);
		}

		if (options.min != null) {
			query.append(sql`MINVALUE ${sql.raw(String(options.min))}`);
		}

		if (options.max != null) {
			query.append(sql`MAXVALUE ${sql.raw(String(options.max))}`);
		}

		if (options.start != null) {
			query.append(sql`START WITH ${sql.raw(String(options.start))}`);
		}

		if (options.cycle) {
			query.append(sql`CYCLE`);
		}

		await this.provider.execute(query);

		this.created = true;
	}

	public async next(): Promise<number> {
		await this.create();
		return this.provider
			.execute(
				sql`SELECT nextval('${sql.raw(this.provider.schema)}."${sql.raw(this.name)}"')`,
			)
			.then((rows) => Number(rows[0]?.nextval));
	}

	public async current(): Promise<number> {
		await this.create();
		return this.provider
			.execute(
				sql`SELECT last_value FROM ${sql.raw(this.provider.schema)}."${sql.raw(this.name)}"`,
			)
			.then((rows) => Number(rows[0]?.last_value));
	}
}

$sequence[KIND] = SequenceDescriptor;
