# Alepha - Email

## Installation

```bash
npm install alepha
```

## Overview

Provides email sending capabilities for Alepha applications with multiple provider backends.

The email module enables declarative email sending through the `$email` descriptor, allowing you to send
emails through different providers: memory (for testing), local file system, or SMTP via Nodemailer.
It supports HTML email content and automatic provider selection based on environment configuration.

