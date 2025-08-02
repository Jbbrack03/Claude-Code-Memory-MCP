#!/bin/bash
# Example hook script for Claude Code Memory MCP Server
# This script can be called from Claude Code hooks to capture events

# Get hook event data from environment or arguments
EVENT_TYPE="${1:-${HOOK_EVENT_TYPE}}"
TOOL_NAME="${2:-${TOOL_NAME}}"
TOOL_INPUT="${3:-${TOOL_INPUT}}"
TOOL_OUTPUT="${4:-${TOOL_OUTPUT}}"
SESSION_ID="${SESSION_ID:-default-session}"

# Function to capture memory
capture_memory() {
    local event_type="$1"
    local content="$2"
    local metadata="$3"
    
    claude-memory capture-event \
        --type="$event_type" \
        --content="$content" \
        --metadata="$metadata" \
        --session="$SESSION_ID"
}

# Function to inject context
inject_context() {
    local query="$1"
    local limit="${2:-10}"
    
    claude-memory inject-context \
        --query="$query" \
        --limit="$limit" \
        --session="$SESSION_ID"
}

# Handle different event types
case "$EVENT_TYPE" in
    "pre_tool_use")
        # Before using a tool, inject relevant context
        if [[ "$TOOL_NAME" =~ ^(Write|Edit|Read)$ ]]; then
            inject_context "Working with file: $TOOL_INPUT" 5
        fi
        ;;
        
    "post_tool_use")
        # After tool use, capture the event
        metadata=$(cat <<EOF
{
    "tool": "$TOOL_NAME",
    "input": "$TOOL_INPUT",
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
        )
        capture_memory "tool_use" "Used tool: $TOOL_NAME" "$metadata"
        ;;
        
    "file_write")
        # Capture file write events
        metadata=$(cat <<EOF
{
    "file": "$TOOL_INPUT",
    "operation": "write",
    "size": ${#TOOL_OUTPUT}
}
EOF
        )
        capture_memory "file_write" "$TOOL_OUTPUT" "$metadata"
        ;;
        
    "user_prompt")
        # Inject context based on user prompt
        inject_context "$TOOL_INPUT" 10
        ;;
        
    *)
        echo "Unknown event type: $EVENT_TYPE" >&2
        exit 1
        ;;
esac