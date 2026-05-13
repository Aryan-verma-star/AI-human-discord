require('dotenv').config();
const express = require('express');
const { EventEmitter } = require('events');
const AgentManager = require('./agentManager');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 7860;
const TIMEOUT = parseInt(process.env.AGENT_TIMEOUT || '20');
const SILENT_MODE = process.env.SILENT_MODE === 'true';

// Event emitter for agent messages
const agentEventBus = new EventEmitter();

if (SILENT_MODE) {
  console.log = () => {};
  console.error = () => {};
}

let agentManager = null;
let startTime = Date.now();
let messageIdCounter = 0;
let sseClients = [];

function broadcastAgentMessage(agentMessage) {
  const id = ++messageIdCounter;
  const eventData = JSON.stringify({
    id,
    agent: agentMessage.agent,
    messages: agentMessage.messages,
    timestamp: agentMessage.timestamp,
    proactive: agentMessage.proactive || false
  });
  
  for (const client of sseClients) {
    client.write(`id: ${id}\ndata: ${eventData}\n\n`);
  }
  
  // Log broadcast (unless SILENT_MODE)
  const type = agentMessage.proactive ? '🔔 PROACTIVE' : '💬 REACTIVE';
  console.log(`[SSE BROADCAST] ${type} ${agentMessage.agent}: ${agentMessage.messages.join(' ').substring(0, 50)}...`);
}

// Listen for agent events from agent.js
agentEventBus.on('agentMessage', (msg) => {
  broadcastAgentMessage(msg);
});

async function initialize() {
  if (!SILENT_MODE) console.log('=== Initializing Agent HTTP Server ===');
  agentManager = new AgentManager();
  await agentManager.initialize();
  
  // Inject event bus into all agents
  for (const agent of agentManager.agents) {
    agent.eventBus = agentEventBus;
  }
  
  if (!SILENT_MODE) console.log('=== All agents ready ===');
}

app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  
  res.write(': connected\n\n');
  
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 30000);
  
  sseClients.push(res);
  
  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients = sseClients.filter(client => client !== res);
  });
});

app.get('/status', (req, res) => {
  res.json({
    online: true,
    agents: 10,
    uptime: Math.floor((Date.now() - startTime) / 1000),
    sseClients: sseClients.length
  });
});

app.post('/reset', async (req, res) => {
  startTime = Date.now();
  res.json({ reset: true });
});

app.post('/chat', async (req, res) => {
  const { message, username } = req.body;
  
  if (!message || !username) {
    return res.status(400).json({ error: 'Missing message or username' });
  }
  
  const timestamp = new Date().toISOString();
  if (!SILENT_MODE) console.log(`[${timestamp}] POST /chat - ${username}: ${message}`);
  
  global._currentResponse = [];
  
  await agentManager.handleUserMessage(message);
  
  await new Promise(r => setTimeout(r, TIMEOUT * 1000));
  
  const responses = global._currentResponse || [];
  global._currentResponse = [];
  
  if (!SILENT_MODE) console.log(`[${timestamp}] Response: ${responses.length} agents responded`);
  
  res.json({ responses });
});

const server = app.listen(PORT, async () => {
  await initialize();
  console.log(`Agent HTTP Server running on port ${PORT}`);
});

process.on('SIGTERM', () => {
  console.log('Shutting down...');
  if (agentManager) agentManager.cleanup();
  server.close(() => process.exit(0));
});

module.exports = { app, agentManager, agentEventBus };