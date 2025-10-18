# Alepha Email

Email sending interface with multiple provider implementations (memory, local file, nodemailer).

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

## Module

Provides email sending capabilities for Alepha applications with multiple provider backends.

The email module enables declarative email sending through the `$email` descriptor, allowing you to send
emails through different providers: memory (for testing), local file system, or SMTP via Nodemailer.
It supports HTML email content and automatic provider selection based on environment configuration.

This module can be imported and used as follows:

```typescript
import { Alepha, run } from "alepha";
import { AlephaEmail } from "alepha/email";

const alepha = Alepha.create()
	.with(AlephaEmail);

run(alepha);
```

## API Reference

### Descriptors

Descriptors are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured descriptor instances.

For more details, see the [Descriptors documentation](/docs/descriptors).

#### $email()

Creates an email descriptor for sending type-safe templated emails.

The $email descriptor provides a powerful templating system for creating and sending emails
with full type safety and validation. It supports multiple email providers, template variable
validation, and automatic HTML rendering.

**Template Engine**
- Simple {{variable}} or {{ variable }} syntax for dynamic content
- Automatic template variable validation at runtime
- Support for nested object properties in templates
- HTML email support with rich formatting

**Type Safety**
- Full TypeScript support with schema validation using TypeBox
- Compile-time type checking for template variables
- Runtime validation of email data before sending
- Automatic type inference from schema definitions

**Provider Flexibility**
- Memory provider for development and testing
- Support for SMTP, SendGrid, AWS SES, and other providers
- Custom provider implementation for specialized services
- Automatic fallback and error handling

**Template Management**
- Reusable email templates across your application
- Centralized template configuration and maintenance
- Template variable documentation through schemas
- Easy testing and preview capabilities

**Development Experience**
- Clear error messages for missing template variables
- Comprehensive logging for debugging email delivery
- Memory provider captures emails for testing
- Template validation before sending

```typescript
const welcomeEmail = $email({
  subject: "Welcome to {{companyName}}, {{firstName}}!",
  body: `
    <h1>Welcome {{firstName}} {{lastName}}!</h1>
    <p>Thank you for joining {{companyName}}.</p>
    <p>Your account role is: <strong>{{role}}</strong></p>
    <p>Get started by visiting your <a href="{{dashboardUrl}}">dashboard</a>.</p>
  `,
  schema: t.object({
    firstName: t.text(),
    lastName: t.text(),
    companyName: t.text(),
    role: t.enum(["admin", "user", "manager"]),
    dashboardUrl: t.text()
  })
});

// Send with full type safety
await welcomeEmail.send("user@example.com", {
  firstName: "John",
  lastName: "Doe",
  companyName: "Acme Corp",
  role: "user",
  dashboardUrl: "https://app.acme.com/dashboard"
});
```

```typescript
const orderConfirmation = $email({
  subject: "Order #{{orderNumber}} confirmed - {{totalAmount}}",
  body: `
    <h1>Order Confirmed!</h1>
    <p>Hi {{customerName}},</p>
    <p>Your order #{{orderNumber}} has been confirmed.</p>
    <h2>Order Details:</h2>
    <p><strong>Total: {{totalAmount}}</strong></p>
    <p>Estimated delivery: {{deliveryDate}}</p>
  `,
  schema: t.object({
    customerName: t.text(),
    orderNumber: t.text(),
    totalAmount: t.text(),
    deliveryDate: t.text()
  })
});
```

```typescript
const testEmail = $email({
  subject: "Test: {{subject}}",
  body: "<p>{{message}}</p>",
  provider: "memory", // Captures emails for testing
  schema: t.object({
    subject: t.text(),
    message: t.text()
  })
});

// In tests - emails are captured, not actually sent
await testEmail.send("test@example.com", {
  subject: "Unit Test",
  message: "This email was captured for testing"
});
```
