# Security Policy

## Reporting Security Vulnerabilities

We take security seriously. If you discover a security vulnerability, please follow these steps:

1. **Do NOT** open a public issue
2. Email security details to: security@claude-memory-mcp.dev
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

We will acknowledge receipt within 48 hours and provide a detailed response within 5 business days.

## Security Measures

### Hook Execution Sandboxing
- All hooks run in isolated environments
- Resource limits enforced:
  - Memory: 100MB max
  - CPU: 1 core max
  - Execution time: 5 seconds max
- No network access permitted
- File system access restricted

### Data Protection
- Automatic secret detection and redaction
- Encryption at rest for sensitive data
- Secure memory wiping after use
- No storage of credentials or tokens

### Input Validation
- All inputs sanitized before processing
- Command injection prevention
- Path traversal protection
- SQL injection prevention

### Git Integration Security
- No execution of Git hooks
- Read-only Git operations by default
- Validation of all Git references
- No storage of Git credentials

## Best Practices for Users

1. **Hook Configuration**
   - Review all hook scripts before enabling
   - Use minimal permissions in hook scripts
   - Avoid storing secrets in hooks
   - Regularly audit hook configurations

2. **Access Control**
   - Limit MCP server access to trusted clients
   - Use environment-specific configurations
   - Rotate any API keys regularly
   - Monitor access logs

3. **Data Handling**
   - Configure memory size limits appropriately
   - Enable automatic data expiration
   - Regularly backup important data
   - Use workspace isolation features

## Security Updates

Security updates are released as soon as fixes are available. Users are encouraged to:

- Subscribe to security announcements
- Keep the server updated to latest version
- Review changelog for security fixes
- Test updates in non-production first

## Compliance

The Claude Code Memory MCP Server is designed to help with:

- GDPR compliance through data minimization
- SOC 2 compliance through audit trails
- HIPAA compliance through encryption
- PCI DSS through secure data handling

However, compliance is ultimately the responsibility of the user based on their specific use case.