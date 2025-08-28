
import { Pinecone } from "@pinecone-database/pinecone";
import { embedText } from "./embedText.js";
import dotenv from "dotenv";

dotenv.config();

const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pc.index(process.env.PINECONE_INDEX);

export async function updatePineconeDoc(id, text) {
  try {
    const embedding = await embedText(text);
    await index.upsert([
      {
        id,
        values: embedding,
        metadata: { text }
      }
    ]);
    console.log(` Pinecone mis à jour pour ${id}`);
  } catch (err) {
    console.error(` Erreur mise à jour Pinecone (${id}) :`, err);
  }
}
