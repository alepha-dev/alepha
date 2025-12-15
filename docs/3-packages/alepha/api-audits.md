# Alepha - Api Audits

## Installation

```bash
npm install alepha
```

## Overview

Provides audit logging API endpoints for Alepha applications.

This module includes:
- Audit log CRUD operations
- Filtering and searching audit events
- Audit statistics and analytics
- `$audit` primitive for domain-specific audit types


```ts
// In your app module
import { AlephaApiAudits } from "alepha/api/audits";

const App = $module({
  name: "app",
  services: [AlephaApiAudits, ...],
});

// Create domain-specific audit types
class PaymentAudits {
  audit = $audit({
    type: "payment",
    actions: ["create", "refund", "cancel"],
  });

  async onPaymentCreated(paymentId: string, userId: string) {
    await this.audit.log("create", {
      userId,
      resourceType: "payment",
      resourceId: paymentId,
    });
  }
}
```

## API Reference

### Primitives

Primitives are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured primitive instances.

For more details, see the [Primitives documentation](/docs/concepts-primitives).

#### $audit()

Options for creating an audit type primitive.
/
export interface AuditPrimitiveOptions {
  /**
  Unique audit type identifier (e.g., "auth", "payment", "order").
  /
  type: string;

  /**
  Human-readable description of this audit type.
  /
  description?: string;

  /**
  List of allowed actions for this audit type.
  /
  actions: string[];
}

/**
Audit type primitive for registering domain-specific audit events.

Provides a type-safe way to define and log audit events within a specific domain.

```ts
class PaymentAudits {
  audit = $audit({
    type: "payment",
    description: "Payment-related audit events",
    actions: ["create", "refund", "cancel", "dispute"],
  });

  async logPaymentCreated(paymentId: string, userId: string, amount: number) {
    await this.audit.log("create", {
      userId,
      resourceType: "payment",
      resourceId: paymentId,
      description: `Payment of ${amount} created`,
      metadata: { amount },
    });
  }
}
```
/
export class AuditPrimitive extends Primitive<AuditPrimitiveOptions> {
  protected readonly auditService = $inject(AuditService);

  /**
  The audit type identifier.
  /
  public get type(): string {
    return this.options.type;
  }

  /**
  The audit type description.
  /
  public get description(): string | undefined {
    return this.options.description;
  }

  /**
  The allowed actions for this audit type.
  /
  public get actions(): string[] {
    return this.options.actions;
  }

  /**
  Log an audit event for this type.
  /
  public async log(
    action: string,
    options: AuditLogOptions = {},
  ): Promise<void> {
    await this.auditService.record(this.options.type, action, options);
  }

  /**
  Log a successful audit event.
  /
  public async logSuccess(
    action: string,
    options: Omit<AuditLogOptions, "success"> = {},
  ): Promise<void> {
    await this.log(action, { ...options, success: true });
  }

  /**
  Log a failed audit event.
  /
  public async logFailure(
    action: string,
    errorMessage: string,
    options: Omit<AuditLogOptions, "success" | "errorMessage"> = {},
  ): Promise<void> {
    await this.log(action, { ...options, success: false, errorMessage });
  }

  /**
  Called during initialization to register this audit type.
  /
  protected onInit(): void {
    const definition: AuditTypeDefinition = {
      type: this.options.type,
      description: this.options.description,
      actions: this.options.actions,
    };
    this.auditService.registerType(definition);
  }
}

/**
Options for logging an audit event.
/
export interface AuditLogOptions {
  severity?: "info" | "warning" | "critical";
  userId?: string;
  userRealm?: string;
  userEmail?: string;
  resourceType?: string;
  resourceId?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  sessionId?: string;
  requestId?: string;
  success?: boolean;
  errorMessage?: string;
}

/**
Create an audit type primitive.

```ts
class OrderAudits {
  audit = $audit({
    type: "order",
    description: "Order management events",
    actions: ["create", "update", "cancel", "fulfill", "ship"],
  });
}
```
