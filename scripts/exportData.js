import mongoose from "mongoose";
import Visitor from "../models/Visitor.js";
import Employee from "../models/Employee.js";
import Appointment from "../models/Appointment.js";
import dotenv from "dotenv";
import { Pinecone } from "@pinecone-database/pinecone";
import { embedText } from "../utils/embedText.js";

dotenv.config();

const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pc.index(process.env.PINECONE_INDEX);

await mongoose.connect(process.env.MONGO_URI);

const employees = await Employee.find().lean();
const visitors = await Visitor.find().lean();
const appointments = await Appointment.find().lean();

const docs = [];


employees.forEach(e => {
  docs.push(
    `Employé : ${e.name}, Bureau : ${e.location}, Email : ${e.email}, Guidance : ${e.guidance || "non spécifié"}`
  );
});



visitors.forEach(v => {
  const lastVisit = v.visitHistory?.at(-1);
  docs.push(`${v.firstName} ${v.lastName} est un visiteur enregistré. Dernière visite le ${lastVisit?.date || "inconnue"} pour "${lastVisit?.purpose || "non spécifié"}".`);
});


appointments.forEach(a => {
  docs.push(`Rendez-vous prévu le ${new Date(a.startTime).toLocaleString("fr-FR")} avec ${a.visitorEmail}.`);
});

console.log(`📄 ${docs.length} phrases générées pour Pinecone.`);

// Envoi vers Pinecone
const vectors = [];
for (let i = 0; i < docs.length; i++) {
  const embedding = await embedText(docs[i]);
  vectors.push({
    id: `doc-${i}`,
    values: embedding,
    metadata: { text: docs[i] }
  });
}

await index.upsert(vectors);
console.log(`✅ ${vectors.length} documents mis à jour dans Pinecone.`);
process.exit();
