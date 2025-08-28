import mongoose from "mongoose";
import { updatePineconeDoc } from "../utils/updatePinecone.js";

const visitSchema = new mongoose.Schema({
  date: String,
  time: String,
  checkInTime: { type: Date, default: null }, // Heure d'entrée
  checkOutTime: { type: Date, default: null }, // Heure de sortie
  purpose: { type: String, default: "non spécifié" },
  language: { type: String, default: "fr" },
  contact: { type: String, default: "non spécifié" },
});

const visitorSchema = new mongoose.Schema({
  firstName: String,
  lastName: String,
  email: { type: String, unique: true },
  photoPath: String,
  type: {
    type: String,
    enum: ["employee", "visitor"],
    default: "visitor",
  },
  registeredAt: { type: Date, default: Date.now },
  visitHistory: [visitSchema], 
});

// Mise à jour de Pinecone après un "save"
visitorSchema.post("save", async function (doc) {
  const lastVisit = doc.visitHistory?.at(-1);
  const text = `${doc.firstName} ${doc.lastName} est un visiteur enregistré. Dernière visite le ${
    lastVisit?.date || "inconnue"
  } à ${lastVisit?.checkInTime ? lastVisit.checkInTime.toLocaleString() : "inconnue"} pour "${
    lastVisit?.purpose || "non spécifié"
  }"${
    lastVisit?.checkOutTime
      ? `, départ à ${lastVisit.checkOutTime.toLocaleString()}`
      : ""
  }.`;
  await updatePineconeDoc(`visitor-${doc._id}`, text);
});

// Mise à jour de Pinecone après un "findOneAndUpdate"
visitorSchema.post("findOneAndUpdate", async function (result) {
  const lastVisit = result.visitHistory?.at(-1);
  const text = `${result.firstName} ${result.lastName} est un visiteur enregistré. Dernière visite le ${
    lastVisit?.date || "inconnue"
  } à ${lastVisit?.checkInTime ? lastVisit.checkInTime.toLocaleString() : "inconnue"} pour "${
    lastVisit?.purpose || "non spécifié"
  }"${
    lastVisit?.checkOutTime
      ? `, départ à ${lastVisit.checkOutTime.toLocaleString()}`
      : ""
  }.`;
  await updatePineconeDoc(`visitor-${result._id}`, text);
});

export default mongoose.model("Visitor", visitorSchema);