
import mongoose from "mongoose";
import { updatePineconeDoc } from "../utils/updatePinecone.js";

const EmployeeSchema = new mongoose.Schema({
email: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  role: { type: String, default: "Employé(e)" },
location: { type: String, required: true }, 
  guidance: { type: String }
});

// Quand on enregistre ou met à jour un employé
EmployeeSchema.post("save", async function(doc) {
  if (doc.name && doc.location) {
    const text = `${doc.name} est un employé de Prologic. Il se trouve actuellement à ${doc.location}. Son email est ${doc.email}.`;
    await updatePineconeDoc(`employee-${doc._id}`, text);
  }
});

EmployeeSchema.post("findOneAndUpdate", async function(result) {
  if (result && result.name && result.location) {
    const text = `${result.name} est un employé de Prologic. Il se trouve actuellement à ${result.location}. Son email est ${result.email}.`;
    await updatePineconeDoc(`employee-${result._id}`, text);
  }
});

export default mongoose.model("Employee", EmployeeSchema);
