#!/bin/bash

# Generate Coverage Report Script
# Claude Code Memory MCP Server

set -e  # Exit on any error

echo "🧪 Generating test coverage report..."

# Clean previous coverage
echo "📁 Cleaning previous coverage data..."
rm -rf coverage node_modules/.cache/jest

# Ensure scripts directory exists and has proper permissions
chmod +x "$0"

# Run tests with coverage
echo "🚀 Running tests with coverage..."
NODE_OPTIONS='--experimental-vm-modules' npm run test:coverage -- --detectOpenHandles --forceExit

# Verify coverage directory was created
if [ ! -d "coverage" ]; then
    echo "❌ Coverage directory not found. Tests may have failed."
    exit 1
fi

# Generate coverage badge if coverage-badge-creator is available
if command -v npx coverage-badge-creator &> /dev/null; then
    echo "🏷️  Generating coverage badge..."
    npx coverage-badge-creator || echo "⚠️  Coverage badge generation failed, continuing..."
fi

# Update timestamp
echo "📅 Updating coverage timestamp..."
echo "Coverage generated on $(date)" > coverage/.timestamp
echo "Test run completed on $(date)" >> coverage/.timestamp
echo "Node version: $(node --version)" >> coverage/.timestamp
echo "NPM version: $(npm --version)" >> coverage/.timestamp

# Display coverage summary if lcov-report exists
if [ -f "coverage/lcov-report/index.html" ]; then
    echo "✅ Coverage report generated successfully!"
    echo "📊 Coverage report available at: coverage/lcov-report/index.html"
    
    # Try to open coverage report (macOS/Linux compatible)
    if command -v open &> /dev/null; then
        echo "🌐 Opening coverage report..."
        open coverage/lcov-report/index.html
    elif command -v xdg-open &> /dev/null; then
        echo "🌐 Opening coverage report..."
        xdg-open coverage/lcov-report/index.html
    else
        echo "💡 To view the report, open: coverage/lcov-report/index.html"
    fi
fi

# Display coverage summary from terminal
if [ -f "coverage/lcov.info" ]; then
    echo ""
    echo "📈 Coverage Summary:"
    echo "==================="
    
    # Extract and display key metrics
    if command -v grep &> /dev/null; then
        echo "Lines covered: $(grep -c 'DA:.*,1' coverage/lcov.info 2>/dev/null || echo 'N/A')"
        echo "Lines total: $(grep -c 'DA:' coverage/lcov.info 2>/dev/null || echo 'N/A')"
        echo "Functions covered: $(grep -c 'FNDA:.*,' coverage/lcov.info 2>/dev/null || echo 'N/A')"
        echo "Branches covered: $(grep -c 'BDA:.*,1' coverage/lcov.info 2>/dev/null || echo 'N/A')"
    fi
fi

echo ""
echo "✨ Coverage generation complete!"
echo "📁 Reports available in the 'coverage' directory"