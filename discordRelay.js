require('dotenv').config();
const { Client, GatewayIntentBits, WebhookClient } = require('discord.js');
const axios = require('axios');
const EventSource = require('eventsource');

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const AGENT_API_URL = process.env.AGENT_API_URL || 'http://localhost:7860';
const HUMAN_USERNAMES = (process.env.HUMAN_USERNAMES || '').split(',').map(s => s.trim()).filter(Boolean);

const AGENT_WEBHOOKS = {
  'Aarohi': { name: 'Aarohi 🗿', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Aarohi' },
  'Kiara': { name: 'Kiara 💀', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Kiara' },
  'Myra': { name: 'Myra', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Myra' },
  'Zara': { name: 'Zara 🤡', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Zara' },
  'Ananya': { name: 'Ananya ✨', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Ananya' },
  'Riya': { name: 'Riya 🌌', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Riya' },
  'Tanya': { name: 'Tanya 📋', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Tanya' },
  'Nysa': { name: 'Nysa 🗿', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Nysa' },
  'Kavya': { name: 'Kavya 👻', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Kavya' },
  'Simran': { name: 'Simran 🤨', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Simran' }
};

let webhookClients = {};
let processedIds = new Set();
const MAX_PROCESSED = 1000;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

async function createOrGetWebhooks(channel) {
  console.log('⚙️ Setting up webhooks...');
  
  try {
    const existingWebhooks = await channel.fetchWebhooks().catch(() => []);
    
    for (const [agentName, config] of Object.entries(AGENT_WEBHOOKS)) {
      let webhook = existingWebhooks.find(w => w.name === config.name);
      
      if (!webhook) {
        console.log(`➕ Creating webhook for ${agentName}...`);
        webhook = await channel.createWebhook({
          name: config.name,
          avatar: config.avatar
        });
      }
      
      webhookClients[agentName] = new WebhookClient({ id: webhook.id, token: webhook.token });
      console.log(`✅ Webhook ready for ${agentName}`);
    }
    
    console.log('✅ All webhooks ready!');
  } catch (error) {
    console.error('❌ Webhook setup error:', error.message);
  }
}

async function sendToDiscord(agentName, text) {
  if (!webhookClients[agentName]) {
    console.log(`❌ No webhook for ${agentName}`);
    return false;
  }
  
  try {
    await webhookClients[agentName].send({
      content: text,
      username: AGENT_WEBHOOKS[agentName].name,
      avatarURL: AGENT_WEBHOOKS[agentName].avatar
    });
    console.log(`📤 [${agentName}]: ${text.substring(0, 50)}...`);
    return true;
  } catch (error) {
    console.error(`❌ ${agentName} post failed:`, error.message);
    return false;
  }
}

function connectSSE() {
  console.log(`🔗 Connecting to SSE: ${AGENT_API_URL}/events`);
  
  const es = new EventSource(`${AGENT_API_URL}/events`);
  
  es.onopen = () => {
    console.log('✅ SSE connected!');
  };
  
  es.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      
      if (processedIds.has(data.id)) {
        return;
      }
      
      processedIds.add(data.id);
      if (processedIds.size > MAX_PROCESSED) {
        const arr = Array.from(processedIds);
        processedIds = new Set(arr.slice(-500));
      }
      
      const msgText = data.messages.join(' ');
      console.log(`📬 [SSE] ${data.agent}: ${msgText.substring(0, 50)}...`);
      
      sendToDiscord(data.agent, msgText);
      
    } catch (error) {
      console.error('❌ SSE parse error:', error.message);
    }
  };
  
  es.onerror = (error) => {
    console.error('❌ SSE error:', error);
    console.log('🔄 Reconnecting in 5s...');
    setTimeout(connectSSE, 5000);
  };
  
  return es;
}

async function forwardToAgents(message) {
  const username = message.author.username;
  const content = message.content;
  
  console.log(`📥 [User] ${username}: ${content}`);
  
  try {
    const response = await axios.post(`${AGENT_API_URL}/chat`, {
      message: content,
      username: username
    }, { timeout: 25000 });
    
    const responses = response.data.responses || [];
    
    if (responses.length === 0) {
      console.log('⚠️ No responses');
      return;
    }
    
    console.log(`📬 Got ${responses.length} responses via /chat`);
    
  } catch (error) {
    console.error('❌ /chat error:', error.message);
  }
}

client.once('ready', async () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
  
  const channel = await client.channels.fetch(DISCORD_CHANNEL_ID);
  if (!channel) {
    console.error('❌ Channel not found!');
    return;
  }
  
  console.log(`📢 Monitoring: #${channel.name}`);
  
  await createOrGetWebhooks(channel);
  
  connectSSE();
  
  console.log('🚀 Discord relay online!');
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.webhookId) return;
  
  if (!HUMAN_USERNAMES.includes(message.author.username)) {
    console.log(`👤 Ignoring ${message.author.username} (not in human list)`);
    return;
  }
  
  await forwardToAgents(message);
});

client.on('error', (error) => {
  console.error('❌ Discord error:', error.message);
});

client.login(DISCORD_BOT_TOKEN);

process.on('SIGINT', () => {
  console.log('👋 Shutting down...');
  client.destroy();
  process.exit(0);
});