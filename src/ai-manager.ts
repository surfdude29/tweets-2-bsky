import { GoogleGenerativeAI } from '@google/generative-ai';
import axios from 'axios';
import { getConfig } from './config-manager.js';

export async function generateAltText(buffer: Buffer, mimeType: string, contextText: string): Promise<string | undefined> {
  const config = getConfig();
  
  // 1. Determine Provider and Credentials
  // Priority: AI Config > Legacy Gemini Config > Environment Variables
  
  let provider = config.ai?.provider || 'gemini';
  let apiKey = config.ai?.apiKey;
  let model = config.ai?.model;
  let baseUrl = config.ai?.baseUrl;

  // Fallbacks for Environment Variables
  if (!apiKey) {
    if (process.env.AI_API_KEY) apiKey = process.env.AI_API_KEY;
    else if (provider === 'gemini') apiKey = config.geminiApiKey || process.env.GEMINI_API_KEY;
    else if (provider === 'openai') apiKey = process.env.OPENAI_API_KEY;
    else if (provider === 'anthropic') apiKey = process.env.ANTHROPIC_API_KEY;
  }

  // Fallback for Gemini specific legacy env var if provider is implicitly gemini
  if (!apiKey && provider === 'gemini') {
      apiKey = process.env.GEMINI_API_KEY;
  }

  if (!apiKey) {
     // If no API key found, we can't do anything.
     // Silently fail or log warning? The original code returned undefined.
     return undefined;
  }

  // Default Models
  if (!model) {
    if (provider === 'gemini') model = 'models/gemini-2.5-flash';
    else if (provider === 'openai') model = 'gpt-4o';
    else if (provider === 'anthropic') model = 'claude-3-5-sonnet-20241022';
  }

  try {
    switch (provider) {
      case 'gemini':
        return await callGemini(apiKey, model || 'models/gemini-2.5-flash', buffer, mimeType, contextText);
      case 'openai':
      case 'custom':
        return await callOpenAICompatible(apiKey, model || 'gpt-4o', baseUrl, buffer, mimeType, contextText);
      case 'anthropic':
        return await callAnthropic(apiKey, model || 'claude-3-5-sonnet-20241022', baseUrl, buffer, mimeType, contextText);
      default:
        console.warn(`[AI] ⚠️ Unknown provider: ${provider}`);
        return undefined;
    }
  } catch (err) {
    console.warn(`[AI] ⚠️ Failed to generate alt text with ${provider}: ${(err as Error).message}`);
    return undefined;
  }
}

async function callGemini(apiKey: string, modelName: string, buffer: Buffer, mimeType: string, contextText: string): Promise<string | undefined> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelName });

  const prompt = `Describe this image for alt text. Be concise but descriptive. 
    Context from the tweet text: "${contextText}". 
    Use the context to identify specific people, objects, or context mentioned, but describe what is visually present in the image.`;

  const result = await model.generateContent([
    prompt,
    {
      inlineData: {
        data: buffer.toString('base64'),
        mimeType
      }
    }
  ]);
  const response = await result.response;
  return response.text();
}

async function callOpenAICompatible(apiKey: string, model: string, baseUrl: string | undefined, buffer: Buffer, mimeType: string, contextText: string): Promise<string | undefined> {
  const url = baseUrl ? `${baseUrl.replace(/\/+$/, '')}/chat/completions` : 'https://api.openai.com/v1/chat/completions';
  
  const base64Image = `data:${mimeType};base64,${buffer.toString('base64')}`;

  const payload = {
    model: model,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Describe this image for alt text. Be concise but descriptive. Context from the tweet text: "${contextText}".`
          },
          {
            type: "image_url",
            image_url: {
              url: base64Image
            }
          }
        ]
      }
    ],
    max_tokens: 300
  };

  const response = await axios.post(url, payload, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      // OpenRouter specific headers (optional but good practice)
      ...(url.includes('openrouter.ai') ? {
          'HTTP-Referer': 'https://github.com/tweets-2-bsky',
          'X-Title': 'Tweets to Bluesky'
      } : {})
    }
  });

  return response.data.choices[0]?.message?.content || undefined;
}

async function callAnthropic(apiKey: string, model: string, baseUrl: string | undefined, buffer: Buffer, mimeType: string, contextText: string): Promise<string | undefined> {
  const url = baseUrl ? `${baseUrl.replace(/\/+$/, '')}/v1/messages` : 'https://api.anthropic.com/v1/messages';
  
  const base64Data = buffer.toString('base64');

  const payload = {
    model: model,
    max_tokens: 300,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mimeType,
              data: base64Data
            }
          },
          {
            type: "text",
            text: `Describe this image for alt text. Be concise but descriptive. Context from the tweet text: "${contextText}".`
          }
        ]
      }
    ]
  };

  const response = await axios.post(url, payload, {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    }
  });

  return response.data.content[0]?.text || undefined;
}
