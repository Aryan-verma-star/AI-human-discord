require('dotenv').config();
const { Client, GatewayIntentBits, WebhookClient } = require('discord.js');
const axios = require('axios');

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const AGENT_API_URL = process.env.AGENT_API_URL;
const HUMAN_USERNAMES = (process.env.HUMAN_USERNAMES || '').split(',').map(s => s.trim()).filter(Boolean);

console.log('🔧 Discord Relay Starting...');
console.log('📡 AGENT_API_URL:', AGENT_API_URL);
console.log('👥 Human users:', HUMAN_USERNAMES);

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
  console.log('⚙️ Creating webhooks...');
  
  try {
    const existingWebhooks = await channel.fetchWebhooks();
    console.log(`📋 Found ${existingWebhooks.size} existing webhooks`);
    
    for (const [agentName, config] of Object.entries(AGENT_WEBHOOKS)) {
      let webhook = existingWebhooks.find(w => w.name === config.name);
      
      if (!webhook) {
        console.log(`➕ Creating ${agentName}...`);
        webhook = await channel.createWebhook({
          name: config.name,
          avatar: config.avatar
        });
      } else {
        console.log(`✅ Found ${agentName}`);
      }
      
      webhookClients[agentName] = {
        id: webhook.id,
        token: webhook.token,
        send: async (opts) => {
          return await webhook.send(opts);
        }
      };
    }
    
    console.log('✅ All webhooks ready!');
  } catch (error) {
    console.error('❌ Webhook setup failed:', error.message);
  }
}

async function forwardToAgents(message) {
  const username = message.author.username;
  const content = message.content;
  
  console.log(`📥 ${username}: ${content}`);
  
  try {
    console.log('📤 Sending to agent API...');
    const response = await axios.post(`${AGENT_API_URL}/chat`, {
      message: content,
      username: username
    }, { timeout: 60000 });
    
    console.log('📬 Response received');
    const responses = response.data.responses || [];
    
    if (responses.length === 0) {
      console.log('⚠️ No agent responses');
      return;
    }
    
    console.log(`📬 ${responses.length} agent responses received`);
    
    for (let i = 0; i < responses.length; i++) {
      const resp = responses[i];
      const agentName = resp.agent;
      const messages = resp.messages;
      const msgText = messages.join(' ');
      
      console.log(`  → ${agentName}: ${msgText.substring(0, 50)}`);
      
      if (webhookClients[agentName]) {
        try {
          await webhookClients[agentName].send({
            content: msgText,
            username: AGENT_WEBHOOKS[agentName].name,
            avatarURL: AGENT_WEBHOOKS[agentName].avatar
          });
          console.log(`✅ Posted ${agentName}`);
        } catch (e) {
          console.error(`❌ Failed ${agentName}:`, e.message);
        }
      } else {
        console.log(`⚠️ No webhook for ${agentName}`);
      }
      
      await new Promise(r => setTimeout(r, 500));
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('Response:', error.response.data);
    }
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
      
      if (webhookClients[agentName]) {
        await webhookClients[agentName].send({
          content: msgText,
          username: AGENT_WEBHOOKS[agentName].name,
          avatarURL: AGENT_WEBHOOKS[agentName].avatar
        });
        console.log(`📤 Proactive: ${agentName}`);
      }
    }
  } catch (error) {
    // Silent
  }
}

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  
  const channel = await client.channels.fetch(DISCORD_CHANNEL_ID);
  if (!channel) {
    console.error('❌ Channel not found! Check DISCORD_CHANNEL_ID');
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
    console.log(`👤 Ignoring ${message.author.username} (not in list)`);
    return;
  }
  
  await forwardToAgents(message);
});

client.on('error', (error) => {
  console.error('❌ Discord error:', error.message);
});

if (!DISCORD_BOT_TOKEN || !DISCORD_CHANNEL_ID || !AGENT_API_URL) {
  console.error('❌ Missing required env vars!');
  console.error('DISCORD_BOT_TOKEN:', DISCORD_BOT_TOKEN ? 'set' : 'MISSING');
  console.error('DISCORD_CHANNEL_ID:', DISCORD_CHANNEL_ID ? 'set' : 'MISSING');
  console.error('AGENT_API_URL:', AGENT_API_URL ? 'set' : 'MISSING');
  process.exit(1);
}

client.login(DISCORD_BOT_TOKEN);

process.on('SIGINT', () => {
  console.log('👋 Shutting down...');
  client.destroy();
  process.exit(0);
});