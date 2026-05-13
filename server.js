require('dotenv').config();
const express = require('express');
const AgentManager = require('./agentManager');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const TIMEOUT = parseInt(process.env.AGENT_TIMEOUT || '25');
const SILENT_MODE = process.env.SILENT_MODE === 'true';

let agentManager = null;
let startTime = Date.now();
let proactiveQueue = [];

async function initialize() {
  agentManager = new AgentManager();
  await agentManager.initialize();
}

let responseBuffer = [];
let capturing = false;

const originalSendResponse = async function(text, emotionAfter) {
  const now = Date.now();
  if (now - this.lastMessageTime < 1500) return;
  
  const response = {
    agent: this.name,
    messages: text.split(' ').filter(m => m),
    should_reply: true,
    emotion_after: emotionAfter || 'neutral',
    proactive: false
  };
  
  if (capturing) {
    responseBuffer.push(response);
  }
  
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
  
  this.lastMessageTime = Date.now();
  this.lastActivityTime = Date.now();
  this.messageCountSinceReflection++;
  
  return new Promise(resolve => setTimeout(resolve, 1500));
};

app.get('/status', (req, res) => {
  res.json({
    online: true,
    agents: 10,
    uptime: Math.floor((Date.now() - startTime) / 1000)
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
  
  responseBuffer = [];
  capturing = true;
  
  for (const agent of agentManager.agents) {
    agent.sendResponse = originalSendResponse;
  }
  
  await agentManager.handleUserMessage(message);
  
  await new Promise(r => setTimeout(r, TIMEOUT * 1000));
  
  capturing = false;
  
  const responses = [...responseBuffer];
  responseBuffer = [];
  
  if (proactiveQueue.length > 0) {
    for (const p of proactiveQueue) {
      p.proactive = true;
    }
    responses.push(...proactiveQueue);
    proactiveQueue = [];
  }
  
  res.json({ responses });
});

const server = app.listen(PORT, async () => {
  await initialize();
  console.log(`Agent HTTP Server running on port ${PORT}`);
});

process.on('SIGTERM', () => {
  if (agentManager) agentManager.cleanup();
  server.close(() => process.exit(0));
});

module.exports = { app, agentManager };