import ModelClient, { isUnexpected } from "@azure-rest/ai-inference";
import { AzureKeyCredential } from "@azure/core-auth";
import dotenv from "dotenv";
dotenv.config();

const token = process.env.GITHUB_TOKEN;
const endpoint = "https://models.github.ai/inference";
const model = "openai/gpt-4.1";

if (!token) {
  console.error("❌ Missing GITHUB_TOKEN in environment variables");
  process.exit(1);
}

const client = ModelClient(
  endpoint,
  new AzureKeyCredential(token),
);

export async function getChatCompletion(messages) {
  try {
    const response = await client.path("/chat/completions").post({
      body: {
        messages: messages,
        temperature: 0.7,
        top_p: 1.0,
        model: model,
      },
    });

    if (isUnexpected(response)) {
      throw response.body.error;
    }

    return response.body.choices[0].message.content;
  } catch (err) {
    console.error("GitHub AI error:", err);
    throw err;
  }
}
