import winston from "winston";
import path from "path";
import { config } from "../config/index.js";

// Create logger instance
export const logger = winston.createLogger({
  level: config.server.logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  defaultMeta: { 
    service: config.server.name,
    version: config.server.version
  },
  transports: [
    // Console transport
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

// Add file transport in production
if (config.server.mode === "production") {
  logger.add(new winston.transports.File({ 
    filename: path.join(".claude-memory", "logs", "error.log"), 
    level: "error" 
  }));
  
  logger.add(new winston.transports.File({ 
    filename: path.join(".claude-memory", "logs", "combined.log") 
  }));
}

// Create child loggers for different modules
export function createLogger(module: string) {
  return logger.child({ module });
}