import express from "express";
import Visitor from "../models/Visitor.js";
import { analyzeVisitor } from "../services/adaptiveEngine.js";

const router = express.Router();

// POST /api/intelligence/analyze
router.post("/analyze", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email requis pour l’analyse." });
    }

    // Récupérer le visiteur exact
    const visitor = await Visitor.findOne({ email: email.trim().toLowerCase() });

    if (!visitor) {
      return res.status(404).json({ message: "Visiteur introuvable." });
    }

    // Appel du moteur adaptatif
    const analysis = await analyzeVisitor(visitor._id);

    return res.status(200).json({
      visitor: {
        id: visitor._id,
        firstName: visitor.firstName,
        lastName: visitor.lastName,
        email: visitor.email,
      },
      analysis
    });

  } catch (error) {
    console.error("Erreur analyse adaptative :", error);
    return res.status(500).json({ message: "Erreur serveur interne." });
  }
});

export default router;