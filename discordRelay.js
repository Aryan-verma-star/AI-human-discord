require('dotenv').config();
const { Client, GatewayIntentBits, WebhookClient, DiscordAPIError } = require('discord.js');
const axios = require('axios');

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const AGENT_API_URL = process.env.AGENT_API_URL || 'http://localhost:3000';
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
let webhookIds = {};

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
      webhookIds[agentName] = webhook.id;
      console.log(`✅ Webhook ready for ${agentName}`);
    }
    
    console.log('✅ All webhooks ready!');
  } catch (error) {
    console.error('❌ Webhook setup error:', error.message);
  }
}

async function sendToWebhook(agentName, text) {
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
    console.log(`📤 Posted ${agentName}: ${text.substring(0, 40)}...`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to post ${agentName}:`, error.message);
    return false;
  }
}

async function forwardToAgents(message) {
  const username = message.author.username;
  const content = message.content;
  
  console.log(`📥 ${username}: ${content}`);
  
  try {
    const response = await axios.post(`${AGENT_API_URL}/chat`, {
      message: content,
      username: username
    }, { timeout: 25000 });
    
    const responses = response.data.responses || [];
    
    if (responses.length === 0) {
      console.log('⚠️ No responses from agents');
      return;
    }
    
    console.log(`📬 Got ${responses.length} responses`);
    
    let delay = 0;
    for (const resp of responses) {
      const agentName = resp.agent;
      const messages = resp.messages;
      const isProactive = resp.proactive;
      
      const msgText = messages.join(' ');
      
      setTimeout(() => {
        sendToWebhook(agentName, msgText);
      }, delay);
      
      delay += 800;
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

async function pollPendingMessages() {
  try {
    const response = await axios.get(`${AGENT_API_URL}/pending`, { timeout: 5000 });
    const pending = response.data.responses || [];
    
    for (const resp of pending) {
      const agentName = resp.agent;
      const messages = resp.messages;
      const msgText = messages.join(' ');
      
      sendToWebhook(agentName, msgText);
    }
  } catch (error) {
    // Silent fail on polling
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
  
  setInterval(pollPendingMessages, 5000);
  
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