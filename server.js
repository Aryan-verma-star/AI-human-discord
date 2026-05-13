require('dotenv').config();
const express = require('express');
const AgentManager = require('./agentManager');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const TIMEOUT = parseInt(process.env.AGENT_TIMEOUT || '30');

let agentManager = null;
let startTime = Date.now();

async function initialize() {
  agentManager = new AgentManager();
  await agentManager.initialize();
}

const originalSendResponse = async function(text, emotionAfter) {
  const now = Date.now();
  if (now - this.lastMessageTime < 1500) return;
  
  // Immediately store in memory and shared feed
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
  
  // Emit the response immediately via callback
  if (this.onResponse) {
    await this.onResponse(this.name, text, emotionAfter);
  }
  
  this.lastMessageTime = Date.now();
  this.lastActivityTime = Date.now();
  
  return new Promise(resolve => setTimeout(resolve, 1500));
};

// Queue for real-time responses
let responseQueue = [];
let processingQueue = false;

async function processQueue(res) {
  if (processingQueue || responseQueue.length === 0) return;
  processingQueue = true;
  
  while (responseQueue.length > 0) {
    const item = responseQueue.shift();
    res.write(`data: ${JSON.stringify(item)}\n\n`);
    await new Promise(r => setTimeout(r, 800)); // Wait between each message
  }
  
  processingQueue = false;
}

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
  res.json({ responses: [] });
});

// SSE endpoint for real-time streaming
app.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  // Store responses in queue for this connection
  responseQueue = [];
  
  const timeout = setTimeout(() => {
    res.end();
  }, TIMEOUT * 1000);
  
  req.on('close', () => {
    clearTimeout(timeout);
  });
});

// POST /chat - triggers all agents and streams responses as they come
app.post('/chat', async (req, res) => {
  const { message, username } = req.body;
  
  if (!message || !username) {
    return res.status(400).json({ error: 'Missing message or username' });
  }
  
  responseQueue = [];
  
  // Set up callback for each agent to queue responses in real-time
  for (const agent of agentManager.agents) {
    agent.sendResponse = async function(text, emotionAfter) {
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
      
      // Add to response queue immediately
      responseQueue.push({
        agent: this.name,
        messages: text.split(' ').filter(m => m),
        should_reply: true,
        emotion_after: emotionAfter || 'neutral'
      });
      
      this.lastMessageTime = Date.now();
      this.lastActivityTime = Date.now();
      
      return new Promise(r => setTimeout(r, 1500));
    };
  }
  
  // Trigger all agents to process the message
  await agentManager.handleUserMessage(message);
  
  // Wait for agents to respond, collecting as they come
  await new Promise(r => setTimeout(r, TIMEOUT * 1000));
  
  // Return all collected responses
  const responses = [...responseQueue];
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