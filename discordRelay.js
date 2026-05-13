require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const AGENT_API_URL = process.env.AGENT_API_URL;
const HUMAN_USERNAMES = (process.env.HUMAN_USERNAMES || '').split(',').map(s => s.trim()).filter(Boolean);

console.log('🔧 Discord Relay Starting...');
console.log('📡 API:', AGENT_API_URL);
console.log('👥 Humans:', HUMAN_USERNAMES);

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

let webhookCache = {};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

async function getWebhook(channel, agentName) {
  if (webhookCache[agentName]) return webhookCache[agentName];
  
  const config = AGENT_WEBHOOKS[agentName];
  const webhooks = await channel.fetchWebhooks();
  
  let webhook = webhooks.find(w => w.name === config.name);
  
  if (!webhook) {
    webhook = await channel.createWebhook({
      name: config.name,
      avatar: config.avatar
    });
  }
  
  webhookCache[agentName] = webhook;
  return webhook;
}

async function sendMessage(webhook, agentName, text) {
  const config = AGENT_WEBHOOKS[agentName];
  
  try {
    await webhook.send({
      content: text,
      username: config.name,
      avatarURL: config.avatar
    });
    console.log(`✅ ${agentName}: ${text.substring(0, 40)}...`);
    return true;
  } catch (error) {
    console.error(`❌ ${agentName} failed:`, error.message);
    return false;
  }
}

async function forwardToAgents(message) {
  const username = message.author.username;
  const content = message.content;
  
  console.log(`\n📥 ${username}: ${content}`);
  
  try {
    const response = await axios.post(`${AGENT_API_URL}/chat`, {
      message: content,
      username: username
    }, { timeout: 60000 });
    
    const responses = response.data.responses || [];
    
    if (responses.length === 0) {
      console.log('⚠️ No responses');
      return;
    }
    
    console.log(`📬 Got ${responses.length} responses, posting...\n`);
    
    // Post each response one by one, waiting for each to succeed
    for (const resp of responses) {
      const agentName = resp.agent;
      const messages = resp.messages;
      const msgText = messages.join(' ');
      
      const channel = await client.channels.fetch(DISCORD_CHANNEL_ID);
      const webhook = await getWebhook(channel, agentName);
      
      // Wait for this message to be sent before next
      await sendMessage(webhook, agentName, msgText);
      
      // Wait 1 second before next agent
      await new Promise(r => setTimeout(r, 1000));
    }
    
    console.log('\n✅ All messages relayed!\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

async function pollPending() {
  try {
    const response = await axios.get(`${AGENT_API_URL}/pending`, { timeout: 5000 });
    const pending = response.data.responses || [];
    
    if (pending.length > 0) {
      console.log(`📤 Proactive: ${pending.length} messages`);
      const channel = await client.channels.fetch(DISCORD_CHANNEL_ID);
      
      for (const resp of pending) {
        const agentName = resp.agent;
        const msgText = resp.messages.join(' ');
        const webhook = await getWebhook(channel, agentName);
        await sendMessage(webhook, agentName, msgText);
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  } catch (error) {
    // Silent
  }
}

client.once('ready', async () => {
  console.log(`✅ Bot: ${client.user.tag}`);
  
  const channel = await client.channels.fetch(DISCORD_CHANNEL_ID);
  console.log(`📢 Channel: #${channel.name}`);
  
  setInterval(pollPending, 5000);
  
  console.log('🚀 Ready!\n');
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || message.webhookId) return;
  
  if (!HUMAN_USERNAMES.includes(message.author.username)) {
    return;
  }
  
  await forwardToAgents(message);
});

if (!DISCORD_BOT_TOKEN || !DISCORD_CHANNEL_ID || !AGENT_API_URL) {
  console.error('❌ Missing env vars!');
  process.exit(1);
}

client.login(DISCORD_BOT_TOKEN);

process.on('SIGINT', () => {
  client.destroy();
  process.exit(0);
});