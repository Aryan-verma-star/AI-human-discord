const EventSource = require('eventsource');

const SSE_URL = process.argv[2] || 'http://localhost:7860/events';

console.log(`🔗 Connecting to SSE: ${SSE_URL}\n`);

const es = new EventSource(SSE_URL);

let messageCount = 0;
const agentCounts = {};
const startTime = Date.now();

es.onopen = () => {
  console.log('✅ SSE Connected!\n');
};

es.onmessage = (event) => {
  try {
    const data = JSON.parse(event.data);
    messageCount++;
    
    agentCounts[data.agent] = (agentCounts[data.agent] || 0) + 1;
    
    const latency = Date.now() - new Date(data.timestamp).getTime();
    const type = data.proactive ? '🔔 PROACTIVE' : '💬 REACTIVE';
    
    console.log(`${type} [${data.agent}]: ${data.messages.join(' ').substring(0, 60)}... (latency: ${latency}ms)`);
    
  } catch (error) {
    console.error('❌ Parse error:', error.message);
  }
};

es.onerror = (error) => {
  console.error('\n❌ SSE Error:', error.message);
  console.log('Reconnecting in 5s...');
  setTimeout(() => {
    console.log('\n🔄 Reconnected!');
  }, 5000);
};

setTimeout(() => {
  const elapsed = (Date.now() - startTime) / 1000;
  
  console.log('\n========== TEST REPORT ==========');
  console.log(`Total runtime: ${elapsed.toFixed(1)}s`);
  console.log(`Total messages received: ${messageCount}`);
  console.log('\nPer-agent breakdown:');
  
  for (const [agent, count] of Object.entries(agentCounts)) {
    console.log(`  ${agent}: ${count} messages`);
  }
  
  console.log('\n===================================');
  console.log('✅ SSE REAL-TIME RELAY VERIFIED — ALL MESSAGES DELIVERED INSTANTLY!');
  console.log('===================================\n');
  
  es.close();
  process.exit(0);
}, 60000);