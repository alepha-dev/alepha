import { $cursor } from "@alepha/core";
import { $retry } from "@alepha/retry";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { PgTransactionConfig } from "drizzle-orm/pg-core/session";
import { PgVersionMismatchError } from "../errors/PgVersionMismatchError.ts";
import { PostgresProvider } from "../providers/drivers/PostgresProvider.ts";

/**
 * Creates a transaction descriptor for database operations requiring atomicity and consistency.
 *
 * This descriptor provides a convenient way to wrap database operations in PostgreSQL
 * transactions, ensuring ACID properties and automatic retry logic for version conflicts.
 * It integrates seamlessly with the repository pattern and provides built-in handling
 * for optimistic locking scenarios with automatic retry on version mismatches.
 *
 * **Key Features**
 *
 * - **ACID Compliance**: Full transaction support with commit/rollback functionality
 * - **Automatic Retry Logic**: Built-in retry for optimistic locking conflicts
 * - **Type Safety**: Full TypeScript support with generic parameters
 * - **Isolation Levels**: Configurable transaction isolation levels
 * - **Error Handling**: Automatic rollback on errors with proper error propagation
 * - **Repository Integration**: Seamless integration with $repository operations
 * - **Performance**: Efficient transaction management with connection reuse
 *
 * **Use Cases**
 *
 * Essential for operations requiring atomicity and consistency:
 * - Financial transactions and accounting operations
 * - Complex business workflows with multiple database operations
 * - Data migrations and bulk operations
 * - E-commerce order processing with inventory updates
 * - User registration with related data creation
 * - Audit trail creation with business operations
 *
 * @example
 * **Basic transaction for financial operations:**
 * ```ts
 * import { $transaction } from "alepha/postgres";
 *
 * class BankingService {
 *   transfer = $transaction({
 *     handler: async (tx, fromAccountId: string, toAccountId: string, amount: number) => {
 *       // All operations within this transaction are atomic
 *       console.log(`Processing transfer: $${amount} from ${fromAccountId} to ${toAccountId}`);
 *
 *       // Get current account balances
 *       const fromAccount = await this.accounts.findById(fromAccountId, { tx });
 *       const toAccount = await this.accounts.findById(toAccountId, { tx });
 *
 *       // Validate sufficient balance
 *       if (fromAccount.balance < amount) {
 *         throw new Error(`Insufficient funds. Balance: $${fromAccount.balance}, Required: $${amount}`);
 *       }
 *
 *       // Update account balances atomically
 *       const updatedFromAccount = await this.accounts.updateById(
 *         fromAccountId,
 *         { balance: fromAccount.balance - amount },
 *         { tx }
 *       );
 *
 *       const updatedToAccount = await this.accounts.updateById(
 *         toAccountId,
 *         { balance: toAccount.balance + amount },
 *         { tx }
 *       );
 *
 *       // Create transaction record
 *       const transactionRecord = await this.transactions.create({
 *         id: generateUUID(),
 *         fromAccountId,
 *         toAccountId,
 *         amount,
 *         type: 'transfer',
 *         status: 'completed',
 *         processedAt: new Date().toISOString()
 *       }, { tx });
 *
 *       console.log(`Transfer completed successfully: ${transactionRecord.id}`);
 *
 *       return {
 *         transactionId: transactionRecord.id,
 *         fromBalance: updatedFromAccount.balance,
 *         toBalance: updatedToAccount.balance
 *       };
 *     }
 *   });
 *
 *   async transferFunds(fromAccountId: string, toAccountId: string, amount: number) {
 *     // This will automatically retry if there's a version mismatch (optimistic locking)
 *     return await this.transfer.run(fromAccountId, toAccountId, amount);
 *   }
 * }
 * ```
 *
 * @example
 * **E-commerce order processing with inventory management:**
 * ```ts
 * class OrderService {
 *   processOrder = $transaction({
 *     config: {
 *       isolationLevel: 'serializable'  // Highest isolation for critical operations
 *     },
 *     handler: async (tx, orderData: {
 *       customerId: string;
 *       items: Array<{ productId: string; quantity: number; price: number }>;
 *       shippingAddress: Address;
 *       paymentMethodId: string;
 *     }) => {
 *       console.log(`Processing order for customer ${orderData.customerId}`);
 *
 *       let totalAmount = 0;
 *       const orderItems = [];
 *
 *       // Process each item and update inventory atomically
 *       for (const itemData of orderData.items) {
 *         const product = await this.products.findById(itemData.productId, { tx });
 *
 *         // Check inventory availability
 *         if (product.stockQuantity < itemData.quantity) {
 *           throw new Error(`Insufficient stock for ${product.name}. Available: ${product.stockQuantity}, Requested: ${itemData.quantity}`);
 *         }
 *
 *         // Update product inventory with optimistic locking
 *         await this.products.save({
 *           ...product,
 *           stockQuantity: product.stockQuantity - itemData.quantity
 *         }, { tx });
 *
 *         // Calculate totals
 *         const lineTotal = itemData.price * itemData.quantity;
 *         totalAmount += lineTotal;
 *
 *         orderItems.push({
 *           id: generateUUID(),
 *           productId: itemData.productId,
 *           quantity: itemData.quantity,
 *           unitPrice: itemData.price,
 *           lineTotal
 *         });
 *       }
 *
 *       // Create the main order record
 *       const order = await this.orders.create({
 *         id: generateUUID(),
 *         customerId: orderData.customerId,
 *         status: 'pending',
 *         totalAmount,
 *         shippingAddress: orderData.shippingAddress,
 *         createdAt: new Date().toISOString()
 *       }, { tx });
 *
 *       // Create order items
 *       for (const itemData of orderItems) {
 *         await this.orderItems.create({
 *           ...itemData,
 *           orderId: order.id
 *         }, { tx });
 *       }
 *
 *       // Process payment
 *       const paymentResult = await this.paymentService.processPayment({
 *         orderId: order.id,
 *         amount: totalAmount,
 *         paymentMethodId: orderData.paymentMethodId,
 *         customerId: orderData.customerId
 *       }, { tx });
 *
 *       if (!paymentResult.success) {
 *         throw new Error(`Payment failed: ${paymentResult.error}`);
 *       }
 *
 *       // Update order status
 *       const completedOrder = await this.orders.updateById(
 *         order.id,
 *         {
 *           status: 'paid',
 *           paymentId: paymentResult.paymentId,
 *           paidAt: new Date().toISOString()
 *         },
 *         { tx }
 *       );
 *
 *       console.log(`Order processed successfully: ${order.id}`);
 *
 *       return {
 *         orderId: order.id,
 *         totalAmount,
 *         paymentId: paymentResult.paymentId,
 *         itemCount: orderItems.length
 *       };
 *     }
 *   });
 * }
 * ```
 *
 * @example
 * **User registration with related data creation:**
 * ```ts
 * class UserService {
 *   registerUser = $transaction({
 *     handler: async (tx, registrationData: {
 *       email: string;
 *       password: string;
 *       profile: {
 *         firstName: string;
 *         lastName: string;
 *         dateOfBirth: string;
 *       };
 *       preferences: {
 *         notifications: boolean;
 *         newsletter: boolean;
 *       };
 *     }) => {
 *       console.log(`Registering new user: ${registrationData.email}`);
 *
 *       // Check if email already exists
 *       const existingUser = await this.users.find(
 *         { where: { email: registrationData.email } },
 *         { tx }
 *       );
 *
 *       if (existingUser.length > 0) {
 *         throw new Error(`User with email ${registrationData.email} already exists`);
 *       }
 *
 *       // Hash password
 *       const hashedPassword = await this.hashPassword(registrationData.password);
 *
 *       // Create user record
 *       const user = await this.users.create({
 *         id: generateUUID(),
 *         email: registrationData.email,
 *         passwordHash: hashedPassword,
 *         isActive: true,
 *         emailVerified: false
 *       }, { tx });
 *
 *       // Create user profile
 *       const profile = await this.userProfiles.create({
 *         id: generateUUID(),
 *         userId: user.id,
 *         firstName: registrationData.profile.firstName,
 *         lastName: registrationData.profile.lastName,
 *         dateOfBirth: registrationData.profile.dateOfBirth
 *       }, { tx });
 *
 *       // Create user preferences
 *       const preferences = await this.userPreferences.create({
 *         id: generateUUID(),
 *         userId: user.id,
 *         notifications: registrationData.preferences.notifications,
 *         newsletter: registrationData.preferences.newsletter
 *       }, { tx });
 *
 *       // Create audit log entry
 *       await this.auditLogs.create({
 *         id: generateUUID(),
 *         userId: user.id,
 *         action: 'user_registered',
 *         details: { email: user.email },
 *         timestamp: new Date().toISOString()
 *       }, { tx });
 *
 *       console.log(`User registration completed: ${user.id}`);
 *
 *       return {
 *         userId: user.id,
 *         email: user.email,
 *         profile: {
 *           firstName: profile.firstName,
 *           lastName: profile.lastName
 *         }
 *       };
 *     }
 *   });
 * }
 * ```
 *
 * @example
 * **Data migration with progress tracking:**
 * ```ts
 * class MigrationService {
 *   migrateUserData = $transaction({
 *     config: {
 *       isolationLevel: 'read_committed',
 *       accessMode: 'read_write'
 *     },
 *     handler: async (tx, batchSize: number = 1000) => {
 *       console.log(`Starting data migration with batch size ${batchSize}`);
 *
 *       let totalMigrated = 0;
 *       let hasMore = true;
 *       let offset = 0;
 *
 *       while (hasMore) {
 *         // Get batch of users to migrate
 *         const users = await this.legacyUsers.find({
 *           limit: batchSize,
 *           offset,
 *           sort: { id: 'asc' }
 *         }, { tx });
 *
 *         if (users.length === 0) {
 *           hasMore = false;
 *           break;
 *         }
 *
 *         // Process each user in the batch
 *         for (const legacyUser of users) {
 *           try {
 *             // Transform legacy data to new format
 *             const newUser = {
 *               id: generateUUID(),
 *               email: legacyUser.email_address,
 *               firstName: legacyUser.first_name,
 *               lastName: legacyUser.last_name,
 *               createdAt: legacyUser.created_date,
 *               isActive: legacyUser.status === 'active'
 *             };
 *
 *             // Create new user record
 *             await this.users.create(newUser, { tx });
 *
 *             // Mark legacy user as migrated
 *             await this.legacyUsers.updateById(
 *               legacyUser.id,
 *               {
 *                 migrated: true,
 *                 migratedAt: new Date().toISOString(),
 *                 newUserId: newUser.id
 *               },
 *               { tx }
 *             );
 *
 *             totalMigrated++;
 *
 *           } catch (error) {
 *             console.error(`Failed to migrate user ${legacyUser.id}:`, error.message);
 *
 *             // Log failed migration
 *             await this.migrationErrors.create({
 *               id: generateUUID(),
 *               legacyUserId: legacyUser.id,
 *               error: error.message,
 *               attemptedAt: new Date().toISOString()
 *             }, { tx });
 *           }
 *         }
 *
 *         offset += batchSize;
 *         console.log(`Migrated ${totalMigrated} users so far...`);
 *       }
 *
 *       // Update migration status
 *       await this.migrationStatus.updateById(
 *         'user_migration',
 *         {
 *           totalMigrated,
 *           completedAt: new Date().toISOString(),
 *           status: 'completed'
 *         },
 *         { tx }
 *       );
 *
 *       console.log(`Migration completed. Total migrated: ${totalMigrated}`);
 *
 *       return { totalMigrated };
 *     }
 *   });
 * }
 * ```
 *
 * **Important Notes**:
 * - All operations within the transaction handler are atomic
 * - Automatic retry on `PgVersionMismatchError` for optimistic locking
 * - Pass `{ tx }` option to all repository operations within the transaction
 * - Transactions are automatically rolled back on any unhandled error
 * - Use appropriate isolation levels based on your consistency requirements
 *
 * @stability 2
 */
export const $transaction = <T extends any[], R>(
	opts: TransactionDescriptorOptions<T, R>,
) => {
	const { context } = $cursor();
	const provider = context.inject(PostgresProvider);

	return $retry({
		when: (err) => err instanceof PgVersionMismatchError,
		handler: (...args: T) =>
			provider.db.transaction(
				async (tx) => opts.handler(tx, ...args),
				opts.config,
			),
	});
};

// ---------------------------------------------------------------------------------------------------------------------

export interface TransactionDescriptorOptions<T extends any[], R> {
	/**
	 * Transaction handler function that contains all database operations to be executed atomically.
	 *
	 * This function:
	 * - Receives a transaction object as the first parameter
	 * - Should pass the transaction to all repository operations via `{ tx }` option
	 * - All operations within are automatically rolled back if any error occurs
	 * - Has access to the full Alepha dependency injection container
	 * - Will be automatically retried if a `PgVersionMismatchError` occurs
	 *
	 * **Transaction Guidelines**:
	 * - Keep transactions as short as possible to minimize lock contention
	 * - Always pass the `tx` parameter to repository operations
	 * - Handle expected business errors gracefully
	 * - Log important operations for debugging and audit trails
	 * - Consider the impact of long-running transactions on performance
	 *
	 * **Error Handling**:
	 * - Throwing any error will automatically roll back the transaction
	 * - `PgVersionMismatchError` triggers automatic retry logic
	 * - Other database errors will be propagated after rollback
	 * - Use try-catch within the handler for business-specific error handling
	 *
	 * @param tx - The PostgreSQL transaction object to use for all database operations
	 * @param ...args - Additional arguments passed to the transaction function
	 * @returns Promise resolving to the transaction result
	 *
	 * @example
	 * ```ts
	 * handler: async (tx, orderId: string, newStatus: string) => {
	 *   // Get the current order (with transaction)
	 *   const order = await this.orders.findById(orderId, { tx });
	 *
	 *   // Validate business rules
	 *   if (!this.isValidStatusTransition(order.status, newStatus)) {
	 *     throw new Error(`Invalid status transition: ${order.status} -> ${newStatus}`);
	 *   }
	 *
	 *   // Update order status (with transaction)
	 *   const updatedOrder = await this.orders.updateById(
	 *     orderId,
	 *     { status: newStatus },
	 *     { tx }
	 *   );
	 *
	 *   // Create audit log (with transaction)
	 *   await this.auditLogs.create({
	 *     id: generateUUID(),
	 *     entityId: orderId,
	 *     action: 'status_change',
	 *     oldValue: order.status,
	 *     newValue: newStatus,
	 *     timestamp: new Date().toISOString()
	 *   }, { tx });
	 *
	 *   return updatedOrder;
	 * }
	 * ```
	 */
	handler: (tx: PgTransaction<any, any, any>, ...args: T) => Promise<R>;

	/**
	 * PostgreSQL transaction configuration options.
	 *
	 * This allows you to customize transaction behavior including:
	 * - **Isolation Level**: Controls visibility of concurrent transaction changes
	 * - **Access Mode**: Whether the transaction is read-only or read-write
	 * - **Deferrable**: For serializable transactions, allows deferring to avoid conflicts
	 *
	 * **Isolation Levels**:
	 * - **read_uncommitted**: Lowest isolation, allows dirty reads (rarely used)
	 * - **read_committed**: Default level, prevents dirty reads
	 * - **repeatable_read**: Prevents dirty and non-repeatable reads
	 * - **serializable**: Highest isolation, full ACID compliance
	 *
	 * **Access Modes**:
	 * - **read_write**: Default, allows both read and write operations
	 * - **read_only**: Only allows read operations, can provide performance benefits
	 *
	 * **When to Use Different Isolation Levels**:
	 * - **read_committed**: Most common operations, good balance of consistency and performance
	 * - **repeatable_read**: When you need consistent reads throughout the transaction
	 * - **serializable**: Critical financial operations, when absolute consistency is required
	 *
	 * @example
	 * ```ts
	 * config: {
	 *   isolationLevel: 'serializable',  // Highest consistency for financial operations
	 *   accessMode: 'read_write'
	 * }
	 * ```
	 *
	 * @example
	 * ```ts
	 * config: {
	 *   isolationLevel: 'read_committed', // Default level for most operations
	 *   accessMode: 'read_only'          // Performance optimization for read-only operations
	 * }
	 * ```
	 */
	config?: PgTransactionConfig;
}

export type TransactionContext = PgTransaction<any, any, any>;
