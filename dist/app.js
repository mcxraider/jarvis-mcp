"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/app.ts
require("dotenv/config"); // loads .env variables at startup
const express_1 = __importDefault(require("express"));
const logger_1 = require("./utils/logger");
const telegram_bot_service_1 = require("./services/telegram/telegram-bot.service");
const message_processor_service_1 = require("./services/telegram/message-processor.service");
const webhook_controller_1 = require("./controllers/webhook.controller");
const mcp_manager_service_1 = require("./services/mcp/mcp-manager.service");
const mcp_config_1 = require("./config/mcp.config");
const tool_call_dispatcher_service_1 = require("./services/mcp/tool-call-dispatcher.service");
// 1. Load configuration from .env
const BOT_TOKEN = process.env.BOT_TOKEN;
const NGROK_URL = process.env.NGROK_URL; // Use this as your webhook base (can be set at runtime)
const TELEGRAM_SECRET_TOKEN = process.env.TELEGRAM_SECRET_TOKEN;
// 2. Initialize services
const messageProcessor = new message_processor_service_1.MessageProcessorService();
const mcpManager = new mcp_manager_service_1.MCPManagerService(); // Manages MCP servers
const toolDispatcher = new tool_call_dispatcher_service_1.ToolCallDispatcher(mcpManager); // Routes function calls
const telegramConfig = {
    token: BOT_TOKEN,
    webhookUrl: NGROK_URL,
    secretToken: TELEGRAM_SECRET_TOKEN
};
const botService = new telegram_bot_service_1.TelegramBotService(telegramConfig, messageProcessor);
/**
 * Initializes the application by starting all MCP servers
 */
async function initializeMCP() {
    try {
        // Start all configured MCP servers
        await mcpManager.initializeServers(mcp_config_1.mcpConfig);
        console.log('All MCP servers initialized successfully');
    }
    catch (error) {
        console.error('Failed to initialize MCP servers:', error);
    }
}
// Graceful shutdown handling
process.on('SIGTERM', async () => {
    console.log('Shutting down gracefully...');
    await mcpManager.shutdown(); // Stop all MCP servers
    process.exit(0);
});
initializeMCP();
// 3. (Optional, for development) Setup webhook to point Telegram to your ngrok URL
// This only needs to be run ONCE per new URL.
// You may want to protect this behind an env variable or CLI command in production.
(async () => {
    try {
        await botService.setupWebhook(NGROK_URL, TELEGRAM_SECRET_TOKEN);
    }
    catch (err) {
        logger_1.logger.error('Error setting up webhook:', err);
    }
})();
// 4. Create Express app and mount routes
const app = (0, express_1.default)();
app.use(express_1.default.json());
// Health check endpoint
app.get('/ping', (_req, res, _next) => {
    res.json({ status: 'ok' });
});
// Telegram webhook endpoint (secured by secret)
app.use((0, webhook_controller_1.createWebhookRouter)(botService));
// 5. Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    logger_1.logger.info(`Server started at http://localhost:${PORT}`);
    logger_1.logger.info(`Waiting for Telegram updates on /webhook/:secret`);
});
