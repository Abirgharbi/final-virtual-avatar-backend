// models/Appointment.js
import mongoose from "mongoose";
import { updatePineconeDoc } from "../utils/updatePinecone.js";

const appointmentSchema = new mongoose.Schema({
  employeeEmail: String,
  visitorEmail: String,
  startTime: String,
  endTime: String,
  createdAt: { type: Date, default: Date.now }
});

// Après création ou mise à jour
appointmentSchema.post("save", async function(doc) {
  const text = `Rendez-vous prévu avec ${doc.visitorEmail} et ${doc.employeeEmail}, du ${doc.startTime} au ${doc.endTime}.`;
  await updatePineconeDoc(`appointment-${doc._id}`, text);
});

appointmentSchema.post("findOneAndUpdate", async function(result) {
  if (result) {
    const text = `Rendez-vous prévu avec ${result.visitorEmail} et ${result.employeeEmail}, du ${result.startTime} au ${result.endTime}.`;
    await updatePineconeDoc(`appointment-${result._id}`, text);
  }
});

export default mongoose.model("Appointment", appointmentSchema);
