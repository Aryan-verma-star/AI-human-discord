require('dotenv').config();
const chalk = require('chalk');
const { callQwen } = require('./qwenClient');
const MemoryManager = require('./memoryManager');
const { buildMessagesArray } = require('./promptBuilder');

const globalQueue = [];
let activeCalls = 0;
const MAX_CONCURRENT = 3;
const CALL_DELAY = 300;
const MESSAGE_DELAY = 2500;

async function processQueue() {
  while (activeCalls < MAX_CONCURRENT && globalQueue.length > 0) {
    const item = globalQueue.shift();
    activeCalls++;
    
    item.fn()
      .then(item.resolve)
      .catch(item.reject)
      .finally(() => {
        activeCalls--;
        setTimeout(processQueue, CALL_DELAY);
      });
  }
}

function queueCall(fn) {
  return new Promise((resolve, reject) => {
    globalQueue.push({ fn, resolve, reject });
    processQueue();
  });
}

class Agent {
  constructor(config, sharedMessageFeed) {
    this.config = config;
    this.name = config.name;
    this.mm = new MemoryManager(this.name);
    this.sharedFeed = sharedMessageFeed;
    this.lastActivityTime = Date.now();
    this.lastMessageTime = 0;
    this.proactiveTimer = null;
    this.goalTimer = null;
    this.reflectionTimer = null;
    this.messageCountSinceReflection = 0;
    this.isProcessing = false;
    this.color = this.getColor();
  }

  getColor() {
    const colors = [
      chalk.red, chalk.green, chalk.yellow, chalk.blue, 
      chalk.magenta, chalk.cyan, chalk.redBright, chalk.greenBright,
      chalk.yellowBright, chalk.blueBright
    ];
    const idx = this.name.charCodeAt(0) % colors.length;
    return colors[idx];
  }

  async initialize() {
    await this.mm.initialize();
    this.scheduleProactive();
    this.scheduleGoalGeneration();
    this.scheduleReflection();
  }

  async handleNewMessage(message) {
    await this.mm.storeRawMessage({
      author: message.author,
      content: message.content,
      timestamp: message.timestamp
    });
    
    const delay = Math.floor(Math.random() * 1500) + 500;
    setTimeout(() => this.evaluate(message), delay);
  }

  async evaluate(message) {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const response = await queueCall(() => this.think(message));
      
      if (response && response.should_reply && response.messages && response.messages.length > 0) {
        await this.sendResponse(response.messages.join(' '), response.emotion_after);
      } else if (response && response.emotion_after) {
        await this.mm.updateSelf('mood', response.emotion_after);
      }
    } catch (error) {
      console.error(chalk.red(`  [${this.name}] Error: ${error.message}`));
    } finally {
      this.isProcessing = false;
    }
  }

  async think(message = null, retryCount = 0) {
    try {
      const recentMessages = await this.mm.getRecentMessages(15);
      const self = await this.mm.getSelf();
      const activeGoals = await this.mm.getActiveGoals();
      const relationships = await this.mm.getRelationships();

      const recentFeed = this.sharedFeed.slice(-10);
      const feedSummary = recentFeed.map(m => `${m.author}: ${m.content}`).join('\n');

      const state = {
        currentEmotion: self.mood || 'neutral',
        recentLifeEvents: self.recentLifeEvents || 'Nothing major',
        recentChatEvents: recentFeed.length > 0 
          ? recentFeed.slice(-3).map(m => `${m.author}: ${m.content.substring(0, 30)}...`).join('; ') 
          : 'Just started',
        activeGoals: activeGoals,
        relationships: relationships
      };

      let userContext;
      if (message) {
        userContext = `Recent group chat:\n${feedSummary}\n\nNew message: ${message.author}: ${message.content}`;
      } else {
        userContext = `Recent group chat:\n${feedSummary}\n\nThe conversation has been quiet. You may initiate if your personality/goals prompt you.`;
      }

      const messages = buildMessagesArray(this.config, state, userContext);
      const result = await callQwen(messages, { max_tokens: 150 });
      
      return result.parsed || { should_reply: false, messages: [], emotion_after: 'neutral' };
    } catch (error) {
      // Retry once on timeout/error for low-activity agents (like Aarohi)
      if (retryCount < 1 && (error.message?.includes('timeout') || error.code === 'ECONNABORTED')) {
        console.log(chalk.gray(`  [${this.name}] Timeout, retrying in 5s...`));
        await new Promise(r => setTimeout(r, 5000));
        return this.think(message, retryCount + 1);
      }
      console.error(chalk.red(`  [${this.name}] Think error: ${error.message}`));
      return { should_reply: false, messages: [], emotion_after: 'neutral' };
    }
  }

  async sendResponse(text, emotionAfter) {
    const now = Date.now();
    if (now - this.lastMessageTime < 2000) return;

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

    console.log();
    console.log(this.color(`${this.name}: ${text}`));
    console.log();

    if (emotionAfter) {
      await this.mm.updateSelf('mood', emotionAfter);
    }

    this.lastMessageTime = Date.now();
    this.lastActivityTime = Date.now();
    this.messageCountSinceReflection++;

    return new Promise(resolve => setTimeout(resolve, MESSAGE_DELAY));
  }

  scheduleProactive() {
    const randomDelay = () => Math.floor(Math.random() * 30000) + 15000;
    
    const scheduleNext = () => {
      this.proactiveTimer = setTimeout(async () => {
        const timeSinceActivity = Date.now() - this.lastActivityTime;
        if (timeSinceActivity > randomDelay()) {
          await this.evaluate(null);
        }
        scheduleNext();
      }, randomDelay());
    };
    
    scheduleNext();
  }

  async scheduleGoalGeneration() {
    const delay = Math.floor(Math.random() * 30000) + 30000;
    this.goalTimer = setTimeout(async () => {
      await this.generateGoals();
      this.scheduleGoalGeneration();
    }, delay);
  }

  async generateGoals() {
    try {
      const self = await this.mm.getSelf();
      const relationships = await this.mm.getRelationships();
      const recent = await this.mm.getRecentMessages(5);

      const goalPrompt = [
        { role: 'system', content: `You are ${this.name}'s inner voice. Based on your personality (${this.config.archetype}), current mood (${self.mood}), and recent chat activity, generate 1-3 conversational goals. Output JSON: { goals: [{ description, priority }] }` },
        { role: 'user', content: `Recent: ${recent.map(m => `${m.author}: ${m.content}`).join(', ')}. Relationships: ${Object.keys(relationships).join(', ')}. Generate goals:` }
      ];

      let result;
      try {
        result = await queueCall(() => callQwen(goalPrompt, { max_tokens: 100, temperature: 0.8 }));
      } catch (e) {
        // Retry once
        console.log(chalk.gray(`  [${this.name}] Goal gen timeout, retrying...`));
        await new Promise(r => setTimeout(r, 5000));
        result = await queueCall(() => callQwen(goalPrompt, { max_tokens: 100, temperature: 0.8 }));
      }
      
      if (result.parsed && result.parsed.goals) {
        for (const g of result.parsed.goals) {
          await this.mm.addGoal({ description: g.description, priority: g.priority || 'medium' });
        }
      }
    } catch (error) {
      console.error(chalk.gray(`  [${this.name}] Goal gen error: ${error.message}`));
    }
  }

  scheduleReflection() {
    this.reflectionTimer = setInterval(async () => {
      if (this.messageCountSinceReflection >= 20) {
        await this.reflect();
        this.messageCountSinceReflection = 0;
      }
    }, 30 * 60 * 1000);
  }

  async reflect() {
    try {
      const recent = await this.mm.getRecentMessages(40);
      const context = recent.map(m => `[${m.time}] ${m.author}: ${m.content}`).join('\n');

      const reflPrompt = [
        { role: 'system', content: `You are ${this.name}'s reflective inner voice. Based on recent conversations, update your self-model. Output JSON: { self_update: { mood: "new mood", recentLifeEvents: "string" }, relationship_updates: [ { userId: "User", changes: { affinity: 1, notes: "string" } } ], insight: "one observation" }` },
        { role: 'user', content: `Recent:\n${context}\n\nReflect:` }
      ];

      const result = await queueCall(() => callQwen(reflPrompt, { max_tokens: 200, temperature: 0.7 }));

      if (result.parsed) {
        if (result.parsed.self_update?.mood) {
          await this.mm.updateSelf('mood', result.parsed.self_update.mood);
        }
        if (result.parsed.self_update?.recentLifeEvents) {
          await this.mm.updateSelf('recentLifeEvents', result.parsed.self_update.recentLifeEvents);
        }
        if (result.parsed.relationship_updates) {
          for (const up of result.parsed.relationship_updates) {
            await this.mm.updateRelationship(up.userId, up.changes);
          }
        }
        if (result.parsed.insight) {
          await this.mm.storeReflection(result.parsed.insight);
        }
      }
    } catch (error) {
      console.error(chalk.gray(`  [${this.name}] Reflection error: ${error.message}`));
    }
  }

  cleanup() {
    if (this.proactiveTimer) clearTimeout(this.proactiveTimer);
    if (this.goalTimer) clearTimeout(this.goalTimer);
    if (this.reflectionTimer) clearInterval(this.reflectionTimer);
  }
}

module.exports = Agent;