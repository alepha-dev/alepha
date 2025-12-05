# Security Policy

## Reporting a Vulnerability

**Do not open a public issue for security vulnerabilities.**

Instead, email security concerns directly to the maintainers. You can find contact information in the repository or reach out via GitHub's private vulnerability reporting feature.

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested fixes (if you have them)

## What Happens Next

1. We'll acknowledge your report within 48 hours
2. We'll investigate and keep you updated
3. Once fixed, we'll credit you (unless you prefer to stay anonymous)
4. We'll publish a security advisory if needed

## Supported Versions

We provide security updates for:

| Version | Supported |
|---------|-----------|
| Latest  | Yes       |
| < Latest | Best effort |

## Security Best Practices

When using Alepha:

- Keep dependencies updated
- Use environment variables for secrets (never commit them)
- Enable HTTPS in production
- Use the built-in security features (`alepha/server/helmet`, `alepha/server/security`)
- Validate all user input (Alepha's schemas do this automatically)

## Thanks

We appreciate responsible disclosure. Security researchers who report vulnerabilities responsibly will be acknowledged in our release notes.
