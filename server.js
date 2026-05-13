require('dotenv').config();
const express = require('express');
const AgentManager = require('./agentManager');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const TIMEOUT = parseInt(process.env.AGENT_TIMEOUT || '20');
const SILENT_MODE = process.env.SILENT_MODE === 'true';

if (SILENT_MODE) {
  console.log = () => {};
  console.error = () => {};
}

let agentManager = null;
let startTime = Date.now();
let proactiveQueue = [];

async function initialize() {
  if (!SILENT_MODE) console.log('=== Initializing Agent HTTP Server ===');
  agentManager = new AgentManager();
  await agentManager.initialize();
  if (!SILENT_MODE) console.log('=== All agents ready ===');
}

const originalSendResponse = async function(text, emotionAfter) {
  const now = Date.now();
  if (now - this.lastMessageTime < 2000) return;
  
  const response = {
    agent: this.name,
    messages: text.split(' ').filter(m => m),
    should_reply: true,
    emotion_after: emotionAfter,
    proactive: false
  };
  
  if (!global._currentResponse) global._currentResponse = [];
  global._currentResponse.push(response);
  
  await this.mm.storeRawMessage({
    author: this.name,
    content: text,
    timestamp: new Date().toISOString()
  });
  
  this.sharedFeed.push({
    author: this.name,
    content: text,
    timestamp: new Date().toISOString()
  });
  
  if (!SILENT_MODE) console.log(`  ${this.name}: ${text}`);
  
  if (emotionAfter) {
    await this.mm.updateSelf('mood', emotionAfter);
  }
  
  this.lastMessageTime = Date.now();
  this.lastActivityTime = Date.now();
  this.messageCountSinceReflection++;
  
  return new Promise(resolve => setTimeout(resolve, 2500));
};

app.get('/status', (req, res) => {
  res.json({
    online: true,
    agents: 10,
    uptime: Math.floor((Date.now() - startTime) / 1000),
    proactiveQueue: proactiveQueue.length
  });
});

app.post('/reset', async (req, res) => {
  proactiveQueue = [];
  startTime = Date.now();
  res.json({ reset: true });
});

app.get('/pending', (req, res) => {
  const pending = [...proactiveQueue];
  proactiveQueue = [];
  res.json({ responses: pending });
});

app.post('/chat', async (req, res) => {
  const { message, username } = req.body;
  
  if (!message || !username) {
    return res.status(400).json({ error: 'Missing message or username' });
  }
  
  const timestamp = new Date().toISOString();
  if (!SILENT_MODE) console.log(`[${timestamp}] POST /chat - ${username}: ${message}`);
  
  const userMessage = {
    author: username,
    content: message,
    timestamp: timestamp
  };
  
  global._currentResponse = [];
  
  for (const agent of agentManager.agents) {
    agent.sendResponse = originalSendResponse;
  }
  
  await agentManager.handleUserMessage(message);
  
  const checkInterval = setInterval(() => {
    const responses = global._currentResponse || [];
    if (responses.length > 0) {
      clearInterval(checkInterval);
    }
  }, 500);
  
  await new Promise(r => setTimeout(r, TIMEOUT * 1000));
  
  const responses = global._currentResponse || [];
  global._currentResponse = [];
  
  if (proactiveQueue.length > 0) {
    for (const p of proactiveQueue) {
      p.proactive = true;
    }
    responses.push(...proactiveQueue);
    proactiveQueue = [];
  }
  
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

module.exports = { app, agentManager };