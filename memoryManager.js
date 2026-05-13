const fs = require('fs-extra');
const path = require('path');

const AGENTS_DIR = 'agents';
const DEFAULT_AGENT = 'Kiara';

class MemoryManager {
  constructor(agentName = DEFAULT_AGENT) {
    this.agentName = agentName;
    this.basePath = path.join(AGENTS_DIR, agentName);
    this.rawPath = path.join(this.basePath, 'raw');
    this.wikiPath = path.join(this.basePath, 'wiki');
    this.selfPath = path.join(this.basePath, 'self.md');
    this.relationshipsPath = path.join(this.basePath, 'relationships.json');
    this.goalsPath = path.join(this.basePath, 'goals.json');
  }

  async initialize() {
    await fs.ensureDir(this.rawPath);
    await fs.ensureDir(this.wikiPath);
    
    if (!await fs.pathExists(this.selfPath)) {
      await fs.writeFile(this.selfPath, `name: ${this.agentName}\nmood: neutral\nrecentLifeEvents: \n`);
    }
    
    if (!await fs.pathExists(this.relationshipsPath)) {
      await fs.writeJson(this.relationshipsPath, {});
    }
    
    if (!await fs.pathExists(this.goalsPath)) {
      await fs.writeJson(this.goalsPath, []);
    }
  }

  getTodayFilename() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}.md`;
  }

  getYesterdayFilename() {
    const now = new Date();
    now.setDate(now.getDate() - 1);
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}.md`;
  }

  async storeRawMessage(messageObj) {
    const { author, content, timestamp } = messageObj;
    const date = new Date(timestamp);
    const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    const filename = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}.md`;
    const filePath = path.join(this.rawPath, filename);
    
    const line = `[${time}] ${author}: ${content}\n`;
    await fs.appendFile(filePath, line);
  }

  async getRecentMessages(limit = 20) {
    const messages = [];
    const todayFile = this.getTodayFilename();
    const yesterdayFile = this.getYesterdayFilename();
    
    const files = [todayFile, yesterdayFile];
    
    for (const file of files) {
      const filePath = path.join(this.rawPath, file);
      if (await fs.pathExists(filePath)) {
        const content = await fs.readFile(filePath, 'utf-8');
        const lines = content.split('\n').filter(line => line.trim());
        
        for (const line of lines) {
          const match = line.match(/^\[(\d{2}:\d{2})\] (\w+): (.+)$/);
          if (match) {
            messages.push({
              time: match[1],
              author: match[2],
              content: match[3]
            });
          }
        }
      }
    }
    
    return messages.slice(-limit);
  }

  async updateSelf(field, value) {
    let content = await fs.readFile(this.selfPath, 'utf-8');
    const lines = content.split('\n');
    let found = false;
    
    const newLines = lines.map(line => {
      if (line.startsWith(`${field}:`)) {
        found = true;
        return `${field}: ${value}`;
      }
      return line;
    });
    
    if (!found) {
      newLines.push(`${field}: ${value}`);
    }
    
    await fs.writeFile(this.selfPath, newLines.join('\n'));
  }

  async getSelf() {
    const content = await fs.readFile(this.selfPath, 'utf-8');
    const self = {};
    const lines = content.split('\n');
    
    for (const line of lines) {
      const match = line.match(/^(\w+): (.+)$/);
      if (match) {
        self[match[1]] = match[2].trim();
      }
    }
    
    return self;
  }

  async getRelationships() {
    return await fs.readJson(this.relationshipsPath);
  }

  async updateRelationship(userId, changes) {
    const rels = await this.getRelationships();
    
    if (!rels[userId]) {
      rels[userId] = {
        name: userId,
        affinity: 0,
        notes: '',
        lastInteraction: new Date().toISOString()
      };
    }
    
    if (changes.affinity) {
      rels[userId].affinity = (rels[userId].affinity || 0) + changes.affinity;
    }
    
    if (changes.notes) {
      const timestamp = new Date().toISOString();
      rels[userId].notes += `\n[${timestamp}] ${changes.notes}`;
    }
    
    rels[userId].lastInteraction = new Date().toISOString();
    
    if (changes.name) {
      rels[userId].name = changes.name;
    }
    
    await fs.writeJson(this.relationshipsPath, rels);
    return rels[userId];
  }

  async getActiveGoals() {
    const goals = await fs.readJson(this.goalsPath);
    return goals.filter(g => g.status === 'active');
  }

  async addGoal(goal) {
    const goals = await fs.readJson(this.goalsPath);
    const newGoal = {
      id: Date.now().toString(),
      description: goal.description,
      priority: goal.priority || 'medium',
      created: new Date().toISOString(),
      status: 'active'
    };
    goals.push(newGoal);
    await fs.writeJson(this.goalsPath, goals);
    return newGoal;
  }

  async removeGoal(id) {
    const goals = await fs.readJson(this.goalsPath);
    const idx = goals.findIndex(g => g.id === id);
    if (idx !== -1) {
      goals[idx].status = 'completed';
      await fs.writeJson(this.goalsPath, goals);
    }
  }

  async storeReflection(insight) {
    const filePath = path.join(this.wikiPath, 'synthesis.md');
    const timestamp = new Date().toISOString();
    const entry = `\n## ${timestamp}\n${insight}\n`;
    
    const existing = await fs.pathExists(filePath) ? await fs.readFile(filePath, 'utf-8') : '';
    await fs.writeFile(filePath, existing + entry);
  }
}

module.exports = MemoryManager;