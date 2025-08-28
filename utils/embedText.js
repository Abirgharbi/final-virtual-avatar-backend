import { pipeline } from "@xenova/transformers";

// Charge le modèle une seule fois au démarrage
const embedder = await pipeline(
  "feature-extraction",
  "Xenova/all-MiniLM-L6-v2"
);

export async function embedText(text) {
  // Génère l'embedding
  const output = await embedder(text, {
    pooling: "mean",   
    normalize: true   
  });


  return Array.from(output.data);
}