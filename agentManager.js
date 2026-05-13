const chalk = require('chalk');
const Agent = require('./agent');
const { AGENTS_CONFIG } = require('./agentsConfig');

class AgentManager {
  constructor() {
    this.agents = [];
    this.sharedFeed = [];
    this.userName = 'User';
  }

  async initialize() {
    console.log(chalk.yellow('\n=== Initializing 10 Agents ===\n'));
    
    for (const config of AGENTS_CONFIG) {
      const agent = new Agent(config, this.sharedFeed);
      await agent.initialize();
      this.agents.push(agent);
      console.log(chalk.green(`  ✓ ${config.name} (${config.archetype}) ready`));
    }
    
    console.log(chalk.yellow('\n=== All Agents Online ===\n'));
  }

  async handleUserMessage(input) {
    const message = {
      author: this.userName,
      content: input.trim(),
      timestamp: new Date().toISOString()
    };

    console.log(chalk.gray(`[${message.timestamp.split('T')[1].split('.')[0]}] ${this.userName}: ${message.content}`));

    this.sharedFeed.push(message);

    for (const agent of this.agents) {
      await agent.handleNewMessage(message);
    }
  }

  async handleAgentMessage(agentName, content) {
    const message = {
      author: agentName,
      content: content,
      timestamp: new Date().toISOString()
    };

    this.sharedFeed.push(message);

    for (const agent of this.agents) {
      if (agent.name !== agentName) {
        await agent.handleNewMessage(message);
      }
    }
  }

  getAgent(name) {
    return this.agents.find(a => a.name === name);
  }

  getStats() {
    const stats = {};
    for (const agent of this.agents) {
      stats[agent.name] = {
        archetype: agent.config.archetype,
        mood: 'unknown'
      };
    }
    return stats;
  }

  cleanup() {
    for (const agent of this.agents) {
      agent.cleanup();
    }
  }
}

module.exports = AgentManager;