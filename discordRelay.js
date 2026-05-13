require('dotenv').config();
const { Client, GatewayIntentBits, WebhookClient } = require('discord.js');
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

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

async function createOrGetWebhooks(channel) {
  console.log('Setting up webhooks for agents...');
  
  const existingWebhooks = await channel.fetchWebhooks();
  
  for (const [agentName, config] of Object.entries(AGENT_WEBHOOKS)) {
    let webhook = existingWebhooks.find(w => w.name === config.name);
    
    if (!webhook) {
      console.log(`Creating webhook for ${agentName}...`);
      webhook = await channel.createWebhook({
        name: config.name,
        avatar: config.avatar
      });
    } else {
      console.log(`Found existing webhook for ${agentName}`);
    }
    
    webhookClients[agentName] = new WebhookClient({
      url: webhook.url
    });
  }
  
  console.log('All webhooks ready!');
}

async function forwardToAgents(message) {
  const username = message.author.username;
  const content = message.content;
  
  console.log(`[${new Date().toISOString()}] Forwarding to agents: ${username}: ${content}`);
  
  try {
    const response = await axios.post(`${AGENT_API_URL}/chat`, {
      message: content,
      username: username
    }, { timeout: 20000 });
    
    const responses = response.data.responses || [];
    
    if (responses.length === 0) {
      console.log('No agent responses');
      return;
    }
    
    console.log(`Got ${responses.length} agent responses`);
    
    for (const resp of responses) {
      const agentName = resp.agent;
      const messages = resp.messages;
      const isProactive = resp.proactive;
      
      if (!webhookClients[agentName]) {
        console.log(`No webhook for ${agentName}`);
        continue;
      }
      
      const delay = isProactive ? 2000 : 0;
      setTimeout(async () => {
        const msgText = messages.join(' ');
        await webhookClients[agentName].send({
          content: msgText,
          username: AGENT_WEBHOOKS[agentName].name,
          avatarURL: AGENT_WEBHOOKS[agentName].avatar
        });
        console.log(`Posted response from ${agentName}: ${msgText.substring(0, 50)}...`);
      }, delay);
    }
    
  } catch (error) {
    console.error('Error forwarding to agents:', error.message);
  }
}

async function pollPendingMessages() {
  try {
    const response = await axios.get(`${AGENT_API_URL}/pending`, { timeout: 5000 });
    const pending = response.data.responses || [];
    
    for (const resp of pending) {
      const agentName = resp.agent;
      const messages = resp.messages;
      
      if (!webhookClients[agentName]) continue;
      
      const msgText = messages.join(' ');
      await webhookClients[agentName].send({
        content: msgText,
        username: AGENT_WEBHOOKS[agentName].name,
        avatarURL: AGENT_WEBHOOKS[agentName].avatar
      });
      console.log(`[Proactive] Posted from ${agentName}: ${msgText.substring(0, 50)}...`);
    }
  } catch (error) {
    // Ignore polling errors
  }
}

client.once('ready', async () => {
  console.log(`Discord bot logged in as ${client.user.tag}`);
  
  const channel = await client.channels.fetch(DISCORD_CHANNEL_ID);
  if (!channel) {
    console.error('Channel not found!');
    return;
  }
  
  console.log(`Monitoring channel: ${channel.name}`);
  
  await createOrGetWebhooks(channel);
  
  setInterval(pollPendingMessages, 5000);
  
  console.log('Discord relay online!');
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.webhookId) return;
  
  if (!HUMAN_USERNAMES.includes(message.author.username)) {
    return;
  }
  
  await forwardToAgents(message);
});

client.on('error', (error) => {
  console.error('Discord client error:', error);
});

client.login(DISCORD_BOT_TOKEN);

process.on('SIGINT', () => {
  console.log('Shutting down Discord relay...');
  client.destroy();
  process.exit(0);
});