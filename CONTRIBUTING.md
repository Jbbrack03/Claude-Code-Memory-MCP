# Contributing to Claude Code Memory MCP Server

We welcome contributions to the Claude Code Memory MCP Server! This document provides guidelines for contributing to the project.

## Code of Conduct

By participating in this project, you agree to abide by our Code of Conduct. Please be respectful and constructive in all interactions.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/yourusername/claude-memory-mcp.git`
3. Create a feature branch: `git checkout -b feature/your-feature-name`
4. Install dependencies: `npm install`
5. Make your changes
6. Run tests: `npm test`
7. Commit your changes: `git commit -m "feat: add new feature"`
8. Push to your fork: `git push origin feature/your-feature-name`
9. Create a Pull Request

## Development Setup

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Run tests
npm test

# Run linting
npm run lint

# Type checking
npm run typecheck
```

## Commit Convention

We use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` New features
- `fix:` Bug fixes
- `docs:` Documentation changes
- `style:` Code style changes (formatting, etc)
- `refactor:` Code refactoring
- `test:` Test additions or modifications
- `chore:` Build process or auxiliary tool changes

## Testing

- Write tests for all new features
- Ensure all tests pass before submitting PR
- Maintain or increase code coverage
- Include integration tests for complex features

## Pull Request Process

1. Update documentation for any API changes
2. Add tests for new functionality
3. Ensure all tests pass
4. Update the README.md if needed
5. Request review from maintainers

## Development Guidelines

### Code Style
- Use TypeScript for all new code
- Follow existing code patterns
- Use meaningful variable and function names
- Add JSDoc comments for public APIs

### Error Handling
- Always use defensive programming
- Handle all error cases explicitly
- Provide meaningful error messages
- Log errors appropriately

### Performance
- Consider performance implications
- Add benchmarks for critical paths
- Avoid blocking operations
- Use caching where appropriate

### Security
- Never store sensitive data in plain text
- Validate all inputs
- Use sandboxing for untrusted code
- Follow security best practices

## Architecture Decisions

When proposing significant changes:

1. Create an issue for discussion
2. Document the rationale
3. Consider backward compatibility
4. Plan migration strategy if needed

## Questions?

Feel free to open an issue for any questions about contributing!