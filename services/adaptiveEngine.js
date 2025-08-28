
import Visitor from "../models/Visitor.js";
import Visit from "../models/Visit.js"; 


// I didn't use this (perspective)
export async function analyzeVisitor(visitorId) {
  try {
    // Charger les infos du visiteur
    const visitor = await Visitor.findById(visitorId);
    if (!visitor) {
      throw new Error("Visiteur introuvable pour l'analyse");
    }

 
    const visits = await Visit.find({ visitorId }).sort({ date: -1 });

  
    const analysis = {
      totalVisits: visits.length,
      lastVisitDate: visits[0]?.date || null,
      frequentPurpose: visits.length
        ? findMostFrequent(visits.map(v => v.purpose))
        : null,
      frequentContact: visits.length
        ? findMostFrequent(visits.map(v => v.contact))
        : null,
      recommendations: []
    };

    // Ajouter des recommandations personnalisées
    if (analysis.frequentPurpose === "Réunion") {
      analysis.recommendations.push("Préparer la salle de réunion avant son arrivée.");
    }
    if (analysis.totalVisits > 5) {
      analysis.recommendations.push("Visiteur régulier — proposer un badge permanent.");
    }

    return analysis;

  } catch (err) {
    console.error("Erreur dans analyzeVisitor:", err);
    throw err;
  }
}

function findMostFrequent(arr) {
  if (!arr || arr.length === 0) return null;
  const freq = {};
  arr.forEach(item => {
    if (!item) return;
    freq[item] = (freq[item] || 0) + 1;
  });
  return Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
}
