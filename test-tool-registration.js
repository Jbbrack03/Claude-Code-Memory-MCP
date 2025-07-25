import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
const server = new McpServer({
    name: "test-server",
    version: "1.0.0"
});
// Test tool registration
server.registerTool("test-tool", {
    title: "Test Tool",
    description: "A test tool",
    inputSchema: z.object({
        message: z.string()
    })
}, async (args) => {
    console.log("Args type:", typeof args);
    console.log("Args value:", args);
    return {
        content: [{
                type: "text",
                text: `Received: ${args.message}`
            }]
    };
});
