require('dotenv').config();
const readline = require('readline');
const chalk = require('chalk');
const AgentManager = require('./agentManager');

const USER_NAME = process.env.USER_NAME || 'User';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: chalk.cyan(`${USER_NAME}: `)
});

const agentManager = new AgentManager();

async function initialize() {
  await agentManager.initialize();
  
  console.log(chalk.yellow('╔════════════════════════════════════════╗'));
  console.log(chalk.yellow('║     10-AGENT GROUP CHAT ONLINE         ║'));
  console.log(chalk.yellow('║     Type to chat with the group        ║'));
  console.log(chalk.yellow('║     (Ctrl+C to exit)                  ║'));
  console.log(chalk.yellow('╚════════════════════════════════════════╝\n'));
  
  rl.prompt();
}

rl.on('line', async (input) => {
  const message = input.trim();
  if (message) {
    await agentManager.handleUserMessage(message);
  }
  rl.prompt();
});

rl.on('SIGINT', () => {
  console.log(chalk.yellow('\n\n👋 Group going offline. Bye!'));
  agentManager.cleanup();
  process.exit(0);
});

initialize();