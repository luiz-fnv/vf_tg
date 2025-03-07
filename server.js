const { Telegraf } = require('telegraf');
const axios = require('axios');
require('dotenv').config();

const bot = new Telegraf(process.env.BOT_TOKEN);

/**
 * Updates the Voiceflow transcripts for a given user.
 * Uses the documented endpoint with a trailing slash.
 *
 * @param {number|string} chatID - Telegram chat ID (also used as the Voiceflow sessionID)
 * @param {Array} transcriptEntries - Array of transcript events
 */

const linkKeywords = {
  "https://partner.bybit.com/b/TIOMACK": "Cadastro Bybit",
  "https://www.bybit.com/pt-BR/sign-up?affiliate_id=100789&group_id=908451&group_type=1&ref_code=TIOMACK": "Cadastro Bybit",
  "https://www.bybit.com/pt-BR/help-center/article/How-to-Add-and-Check-Registered-Affiliate-Code": "Tutorial Código de Afiliado",
  "https://youtu.be/2RNdY6kYu8g": "Tutorial Transferência Titularidade"
};

function replaceLinksWithKeywords(messageText) {
  return messageText.replace(/\[(.*?)\]\((.*?)\)/g, (match, linkText, url) => {
    if (linkKeywords[url]) {
      return `<a href="${url}">${linkKeywords[url]}</a>`;
    }
    return url;  
  });
  
}

async function updateTranscripts(chatID, transcriptEntries) {
  const url = `https://api.voiceflow.com/v2/transcripts`;
  try {
    await axios.put(
      url,
      {
        projectID: process.env.VOICEFLOW_PROJECT_ID,
        sessionID: String(chatID), // using chatID as the sessionID
        transcripts: transcriptEntries
      },
      {
        headers: {
          Authorization: process.env.VOICEFLOW_API_KEY,
          "Content-Type": "application/json"
        }
      }
    );
    console.log(`Transcripts updated successfully for user ${chatID}`);
  } catch (error) {
    console.error("Error updating transcripts at URL:", url);
    console.error(error.response?.data || error.message);
  }
}

/**
 * Processes an interaction with Voiceflow:
 * 1. Optionally records the user’s input as a transcript event.
 * 2. Calls the Voiceflow interact endpoint.
 * 3. Processes each trace (replying and recording as transcript events).
 * 4. Finally, updates the transcripts via the Voiceflow transcripts endpoint.
 *
 * @param {Object} ctx - Telegraf context.
 * @param {number|string} chatID - Telegram chat ID (and Voiceflow sessionID)
 * @param {Object} request - Request payload for Voiceflow.
 * @param {string|null} userText - The user’s text message (if any)
 */
async function processInteraction(ctx, chatID, request, userText = null) {
  const transcriptEntries = [];

  // Add the user’s message (if any) to the transcript.
  if (userText !== null) {
    transcriptEntries.push({
      type: "text",
      payload: { message: userText },
      source: "user",
      timestamp: Date.now()
    });
  }

  // Call the Voiceflow interact endpoint.
  let response;
  try {
    response = await axios({
      method: "POST",
      url: `https://general-runtime.voiceflow.com/state/user/${chatID}/interact`,
      headers: { Authorization: process.env.VOICEFLOW_API_KEY },
      data: { request }
    });
  } catch (error) {
    console.error("Error calling interact endpoint:", error.response?.data || error.message);
    await ctx.reply("There was an error processing your request with Voiceflow.");
    return;
  }

  // Process each trace in the response.
  for (const trace of response.data) {
    switch (trace.type) {
      case "text":
      case "speak":
        let messageText = trace.payload.message;       
        messageText = replaceLinksWithKeywords(messageText);
        //disable_web_page_preview -> tira o bloco dos links
        await ctx.replyWithHTML(messageText, { disable_web_page_preview: true });
        transcriptEntries.push({
          type: trace.type,
          payload: { message: messageText },
          source: "voiceflow",
          timestamp: Date.now()
        });
        break;
      case "visual":
        await ctx.replyWithPhoto(trace.payload.image);
        transcriptEntries.push({
          type: trace.type,
          payload: { message: trace.payload.image },
          source: "voiceflow",
          timestamp: Date.now()
        });
        break;
      case "end":
        await ctx.reply("Conversation is over");
        transcriptEntries.push({
          type: trace.type,
          payload: { message: "Conversation is over" },
          source: "voiceflow",
          timestamp: Date.now()
        });
        break;
      default:
        // Handle other trace types if necessary.
        break;
    }
  }

  // Update transcripts on Voiceflow.
  await updateTranscripts(chatID, transcriptEntries);
}

// /start command: initiates a "launch" request.
bot.start(async (ctx) => {
  let chatID = ctx.message.chat.id;
  await processInteraction(ctx, chatID, { type: "launch" });
});

// Listen for any text message.
bot.hears(/(.+)/i, async (ctx) => {
  let chatID = ctx.message.chat.id;
  await processInteraction(
    ctx,
    chatID,
    { type: "text", payload: ctx.message.text },
    ctx.message.text
  );
});

bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
