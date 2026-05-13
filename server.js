require('dotenv').config();
const express = require('express');
const AgentManager = require('./agentManager');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const TIMEOUT = parseInt(process.env.AGENT_TIMEOUT || '30');

let agentManager = null;
let startTime = Date.now();
let proactiveQueue = [];

async function initialize() {
  agentManager = new AgentManager();
  await agentManager.initialize();
}

// Capture only user-triggered responses
let userResponseBuffer = [];
let isUserMessage = false;

const captureResponse = async function(text, emotionAfter) {
  const now = Date.now();
  if (now - this.lastMessageTime < 1500) return;
  
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
  
  // Only capture if this is from a user message (not agent-to-agent chat)
  if (isUserMessage) {
    userResponseBuffer.push({
      agent: this.name,
      messages: text.split(' ').filter(m => m),
      should_reply: true,
      emotion_after: emotionAfter || 'neutral'
    });
  }
  
  this.lastMessageTime = Date.now();
  this.lastActivityTime = Date.now();
  
  return new Promise(r => setTimeout(r, 1500));
};

app.get('/status', (req, res) => {
  res.json({
    online: true,
    agents: 10,
    uptime: Math.floor((Date.now() - startTime) / 1000)
  });
});

app.post('/reset', (req, res) => {
  startTime = Date.now();
  res.json({ reset: true });
});

app.get('/pending', (req, res) => {
  const pending = [...proactiveQueue];
  proactiveQueue = [];
  res.json({ responses: pending });
});

// Only return responses triggered by human user
app.post('/chat', async (req, res) => {
  const { message, username } = req.body;
  
  if (!message || !username) {
    return res.status(400).json({ error: 'Missing message or username' });
  }
  
  userResponseBuffer = [];
  isUserMessage = true;
  
  // Hook up response capture
  for (const agent of agentManager.agents) {
    agent.sendResponse = captureResponse;
  }
  
  // Handle user message - this triggers agent responses
  await agentManager.handleUserMessage(message);
  
  // Wait for all agents to respond
  await new Promise(r => setTimeout(r, TIMEOUT * 1000));
  
  isUserMessage = false;
  
  // Only return responses that were triggered by user
  const responses = [...userResponseBuffer];
  userResponseBuffer = [];
  
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