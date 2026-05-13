const axios = require('axios');

const QWEN_API_URL = process.env.QWEN_API_URL || 'https://qwen.aikit.club/v1/chat/completions';
const QWEN_TOKEN = process.env.QWEN_TOKEN;

async function callQwen(messages, options = {}) {
  if (!QWEN_TOKEN) {
    throw new Error('QWEN_TOKEN not configured');
  }

  const body = {
    model: 'qwen3.6-plus',
    messages: messages,
    temperature: options.temperature || 0.9,
    max_tokens: options.max_tokens || 150
  };

  const headers = {
    'Authorization': `Bearer ${QWEN_TOKEN}`,
    'Content-Type': 'application/json'
  };

  try {
    const response = await axios.post(QWEN_API_URL, body, { headers, timeout: 30000 });
    
    if (!response.data || !response.data.choices || response.data.choices.length === 0) {
      throw new Error('Invalid response from Qwen API');
    }

    let content = response.data.choices[0].message.content;
    const rawContent = content;
    
    // Strip markdown code blocks and extra content
    if (typeof content === 'string') {
      // Remove markdown code block markers and any trailing markdown
      content = content.replace(/^```json?\s*/i, '').replace(/```$/, '').trim();
      // Remove <details> tags and content
      content = content.replace(/<details>.*<\/details>/s, '').trim();
      
      try {
        content = JSON.parse(content);
      } catch (e) {
        // Try to extract just the JSON portion if there's extra text
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            content = JSON.parse(jsonMatch[0]);
          } catch (e2) {
            return { raw: rawContent, parsed: null };
          }
        } else {
          return { raw: rawContent, parsed: null };
        }
      }
    }

    return { raw: rawContent, parsed: content };
  } catch (error) {
    // Retry once on network errors and timeouts
    const isRetryable = error.code === 'ECONNREFUSED' || 
                        error.code === 'ETIMEDOUT' || 
                        error.code === 'ECONNABORTED' ||  // axios timeout
                        error.message?.includes('timeout') ||
                        error.response?.status >= 500 ||
                        error.response?.status === 400;  // sometimes 400 is transient
    
    if (isRetryable) {
      console.error(`Qwen API error (${error.response?.status || error.code}), retrying once...`, error.message);
      try {
        const retryResponse = await axios.post(QWEN_API_URL, body, { headers, timeout: 30000 });
        let content = retryResponse.data.choices[0].message.content;
        const rawContent = content;
        
        if (typeof content === 'string') {
          content = content.replace(/^```json?\s*/i, '').replace(/```$/, '').trim();
          content = content.replace(/<details>.*<\/details>/s, '').trim();
          
          try {
            content = JSON.parse(content);
          } catch (e) {
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              try {
                content = JSON.parse(jsonMatch[0]);
              } catch (e2) {
                return { raw: rawContent, parsed: null };
              }
            } else {
              return { raw: rawContent, parsed: null };
            }
          }
        }
        return { raw: rawContent, parsed: content };
      } catch (retryError) {
        console.error('Qwen API retry failed:', retryError.message);
        throw retryError;
      }
    }
    console.error('Qwen API error:', error.message);
    throw error;
  }
}

module.exports = { callQwen };