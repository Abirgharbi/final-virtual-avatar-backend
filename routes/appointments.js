import express from "express";
import { google } from "googleapis";
import dotenv from "dotenv";
import Appointment from "../models/Appointment.js";


dotenv.config();
const router = express.Router();



//  OAuth2 configuration
const oAuth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

//  Set refresh_token
oAuth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
});

const calendar = google.calendar({ version: "v3", auth: oAuth2Client });

//  Lister les créneaux occupés
router.get("/availability", async (req, res) => {
  try {
    const { employeeEmail, date } = req.query;

    if (!employeeEmail || !date) {
      return res.status(400).json({ error: "Email employé et date requis" });
    }

    const start = new Date(`${date}T09:00:00`);
    const end = new Date(`${date}T17:00:00`);

    const events = await calendar.events.list({
      calendarId: employeeEmail,
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
    });

    const busySlots = events.data.items.map((event) => ({
      start: event.start.dateTime,
      end: event.end.dateTime,
    }));

    res.json({ busySlots });
  } catch (error) {
    console.error(" Erreur availability:", error);
    res.status(500).send("Erreur récupération créneaux");
  }
});

//  Réserver un RDV (avec vérification de conflit)
router.post("/book", async (req, res) => {
  try {
    const { employeeEmail, visitorEmail, startTime, endTime } = req.body;

    if (!employeeEmail || !visitorEmail || !startTime || !endTime) {
      return res
        .status(400)
        .json({ error: "Champs manquants pour la réservation." });
    }

    //  Vérifier s'il existe déjà un RDV 
    const overlappingEvents = await calendar.events.list({
      calendarId: employeeEmail,
      timeMin: startTime,
      timeMax: endTime,
      singleEvents: true,
      orderBy: "startTime",
    });

    if (
      overlappingEvents.data.items &&
      overlappingEvents.data.items.length > 0
    ) {
      console.log(" Conflit détecté:", overlappingEvents.data.items);
      return res.status(409).json({
        success: false,
        message: "Un autre rendez-vous existe déjà à cet horaire.",
      });
    }

    //  Créer le RDV
    const event = {
      summary: "Rendez-vous Visiteur",
      description: "Réservé depuis le kiosque Prologic",
      start: { dateTime: startTime, timeZone: "Europe/Paris" },
      end: { dateTime: endTime, timeZone: "Europe/Paris" },
      attendees: [
        { email: employeeEmail },
        { email: visitorEmail },
      ],
    };

    const result = await calendar.events.insert({
      calendarId: employeeEmail,
      resource: event,
      sendUpdates: "all",
    });

    console.log(" RDV ajouté:", result.data.htmlLink);

await Appointment.create({
  employeeEmail,
  visitorEmail,
  startTime,
  endTime
});
console.log(" RDV enregistré dans MongoDB");
    res.json({ success: true, link: result.data.htmlLink });
  } catch (error) {

  console.error(" Erreur book appointment:", error.message);
  res.status(500).json({ success: false, message: error.message });

  }
});

export default router;
