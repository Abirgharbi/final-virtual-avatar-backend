import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import voice from "elevenlabs-node"; 
import { exec } from "child_process";
import fsClassic from "fs";
import { promises as fs } from "fs";
import fetch from "node-fetch";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import appointmentsRouter from "./routes/appointments.js";
import mongoose from "mongoose";
import intelligenceRoutes from "./routes/intelligence.js";
import Visitor from "./models/Visitor.js";
import Employee from "./models/Employee.js";
import { Pinecone } from '@pinecone-database/pinecone';
import { embedText } from "./utils/embedText.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import Admin from "./models/Admin.js";



dotenv.config();

const app = express();


mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connecté"))
  .catch((err) => console.error("Erreur MongoDB:", err));
  
app.use(express.json({ limit: "10mb" }));
app.use(cors());

app.use("/", appointmentsRouter);
app.use("/appointments", appointmentsRouter);
app.use("/api/intelligence", intelligenceRoutes);

const port = 3000;

const GROQ_API_URL = "https://api.groq.com/openai/v1";
const GROQ_MODEL = "llama3-70b-8192";
const GROQ_API_KEY = process.env.GROQ_API_KEY;

const elevenLabsApiKey = process.env.ELEVEN_LABS_API_KEY;
const voiceID = "XrExE9yKIg1WjnnlVkGX"; 



const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const registeredDir = path.join(__dirname, "registered_visitors");
const csvFile = path.join(__dirname, "visitors.csv");
const badgesDir = path.join(__dirname, "badges");

await fs.mkdir(registeredDir, { recursive: true });
await fs.mkdir(badgesDir, { recursive: true });

app.use("/badges", express.static(badgesDir));
const upload = multer({ dest: path.join(__dirname, "Uploads") });
const pythonRecognitionURL = "http://localhost:5000/recognize";

app.use("/registered_visitors", express.static(registeredDir));

const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pc.index(process.env.PINECONE_INDEX);

async function searchKnowledge(query, recognizedName = null) {
  
  let cleanQuery = query.toLowerCase();
  const nameMatch = query.toLowerCase().match(/(?:madame|mr|m\.)\s*(\w+)/i);
  if (nameMatch && nameMatch[1]) {
    cleanQuery = nameMatch[1]; 
  } else {
    const keywords = query.toLowerCase().match(/\b[a-zA-Z0-9_-]{3,}\b/g) || [];
    cleanQuery = keywords.length > 0 ? keywords.join(" ") : query;
  }
  console.log("Cleaned query for embedding:", cleanQuery);

  const embedding = await embedText(cleanQuery);
  const results = await index.query({
    vector: embedding,
    topK: 20,
    includeMetadata: true
  });
  let matches = results.matches.map(m => m.metadata.text);


  const targetName = nameMatch ? nameMatch[1].toLowerCase() : null;
  matches = matches.sort((a, b) => {
    const scoreA = (a.toLowerCase().includes("employé") ? 2 : 0) +
                   (targetName && a.toLowerCase().includes(targetName) ? 3 : 0);
    const scoreB = (b.toLowerCase().includes("employé") ? 2 : 0) +
                   (targetName && b.toLowerCase().includes(targetName) ? 3 : 0);
    return scoreB - scoreA;
  });

  if (recognizedName) {
    matches = matches.filter(text => text.toLowerCase().includes(recognizedName.toLowerCase()));
  } else {
    matches = matches.filter(text => text.toLowerCase().includes("employé"));
  }

  if (matches.length === 0) {
    matches = results.matches.map(m => m.metadata.text).slice(0, 5);
  }

  return matches.slice(0, 5);
}
app.post("/recognize-face", upload.single("image"), async (req, res) => {
  try {
    const imagePath = req.file.path;
    const imageBuffer = await fs.readFile(imagePath);
    const language = req.headers["x-language"] || "fr";

    const response = await fetch(pythonRecognitionURL, {
      method: "POST",
      body: imageBuffer,
      headers: { "Content-Type": "application/octet-stream" },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Python backend error: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    console.log("🔍 Résultat reconnaissance:", JSON.stringify(data, null, 2));

    if (data.status === "known") {
      if (data.type === "visitor") {
        const email = data.name;
        const visitor = await Visitor.findOne({ email }).lean();

        if (visitor) {
          const fullName = `${visitor.firstName} ${visitor.lastName}`;
          const lastPurpose =
            visitor.visitHistory?.at(-1)?.purpose || "non spécifié";

          return res.json({
            content:
              language === "en"
                ? `Welcome ${fullName}, are you here again for "${lastPurpose}"?`
                : language === "ar"
                ? `مرحبًا ${fullName}، هل أنت هنا مرة أخرى من أجل "${lastPurpose}"؟`
                : `Bonjour ${fullName}, vous venez encore pour "${lastPurpose}" ?`,
            animation: "talkAsk",
            facialExpression: "smile",
            email,
            lastPurpose,
            showQuickChoice: true,
            name: fullName,
            type: data.type,
            status: "known",
            visitor: {
              firstName: visitor.firstName,
              lastName: visitor.lastName
            }
          });
        }
      }

      return res.json({
        content:
          language === "en"
            ? `Welcome ${data.name}. Your arrival has been registered.`
            : language === "ar"
            ? `مرحبًا ${data.name}. تم تسجيل وصولك.`
            : `Bienvenue ${data.name}. Votre arrivée a été enregistrée.`,
        animation: "greeting",
        facialExpression: "smile",
        name: data.name,
        type: data.type,
        email: data.email || "N/A",
        location: data.location,
        role: data.role,
        status: "known"
      });
    } else if (data.status === "unknown") {
      return res.json({
        content:
          language === "en"
            ? "Please fill in the form to prepare your visitor badge."
            : language === "ar"
            ? "يرجى ملء النموذج لإعداد بطاقة الزائر."
            : "Veuillez remplir le formulaire pour préparer votre badge visiteur.",
        animation: "talkAsk",
        facialExpression: "smile",
        showForm: true,
        status: "unknown"
      });
    } else if (data.status === "no_face") {
      return res.json({
        content:
          language === "en"
            ? "I can't see you clearly. Could you move closer?"
            : language === "ar"
            ? "لا أستطيع رؤيتك بوضوح. هل يمكنك الاقتراب قليلاً؟"
            : "Je n’arrive pas à vous voir clairement. Pouvez-vous vous rapprocher un peu ?",
        animation: "talkingQuestion",
        facialExpression: "funnyFace",
        status: "no_face"
      });
    }

    console.warn("Unrecognized response from Python backend:", data);
    res.status(400).json({ error: "Réponse non traitable", status: data.status });
  } catch (err) {
    console.error("❌ Erreur reconnaissance faciale:", err);
    res.status(500).json({ error: "Erreur serveur reconnaissance", message: err.message });
  } finally {
    if (req.file) {
      await fs.unlink(req.file.path).catch(err => console.error("Failed to delete temp file:", err));
    }
  }
});

app.post("/register-visitor", async (req, res) => {
  try {
    const { firstName, lastName, email, photo, purpose, contact, language } = req.body;

    if (!firstName || !lastName || !photo) {
      return res.status(400).json({ success: false, message: "Nom, prénom et photo requis" });
    }

    const nom = lastName;
    const prenom = firstName;

    const base64Data = photo.replace(/^data:image\/jpeg;base64,/, "");
    const photoFilename = `${Date.now()}_${nom}_${prenom}.jpg`;
    const photoPath = path.join(registeredDir, photoFilename);
    await fs.writeFile(photoPath, base64Data, "base64");
    console.log(` Photo sauvegardée: ${photoPath}`);

    const now = new Date();
const date = now.toLocaleDateString("en-CA", { timeZone: "Europe/Paris" });
const time = now.toLocaleTimeString("en-GB", { timeZone: "Europe/Paris" });
const checkInTime = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Paris" }));

    if (!fsClassic.existsSync(csvFile)) {
      const header = `Nom;Prénom;Photo;Date;Heure\n`;
      await fs.appendFile(csvFile, header);
      console.log(` En-tête CSV ajouté : ${header.trim()}`);
    }

    const csvLine = `${nom};${prenom};${photoFilename};${date};${time}\n`;
    await fs.appendFile(csvFile, csvLine);
    console.log(` Visiteur ajouté au CSV: ${csvLine.trim()}`);

    const badgeId = `${Date.now()}_${nom}_${prenom}`;
    const badgeFilename = `${badgeId}.pdf`;
    const badgePath = path.join(badgesDir, badgeFilename);

    const qrData = `https://tonsite.com/badge/${badgeId}`;
    const qrCodeDataUrl = await QRCode.toDataURL(qrData);

    const doc = new PDFDocument({ size: "A6", margin: 20 });
    const writeStream = fsClassic.createWriteStream(badgePath);
    doc.pipe(writeStream);

    doc.fontSize(18).text("Badge Visiteur", { align: "center" });
    doc.moveDown();
    doc.fontSize(14).text(`Nom : ${nom}`);
    doc.text(`Prénom : ${prenom}`);
    doc.text(`Date : ${new Date().toLocaleString()}`);
    doc.moveDown();

    doc.image(photoPath, { width: 150, height: 150, align: "center" });
    doc.moveDown();

    const qrBase64 = qrCodeDataUrl.split(",")[1];
    const qrBuffer = Buffer.from(qrBase64, "base64");
    doc.image(qrBuffer, doc.page.width / 2 - 50, doc.y, {
      width: 100,
      height: 100,
    });

    doc.end();

    await new Promise((resolve, reject) => {
      writeStream.on("finish", resolve);
      writeStream.on("error", reject);
    });

    console.log(`Badge PDF généré : ${badgePath}`);

    const badgeURL = `http://localhost:3000/badges/${badgeFilename}`;

    await fetch("http://localhost:5000/reload-encodings", {
      method: "POST",
    });
    console.log("🔁 Encodages rechargés dans le backend Python");

    const visitor = await Visitor.findOneAndUpdate(
      { email },
      {
        $set: {
          firstName,
          lastName,
          email,
          photoPath: `http://localhost:3000/registered_visitors/${photoFilename}`,
        },
        $push: {
          visitHistory: {
            date,
            checkInTime, // Use current time as check-in
            purpose: purpose || "non spécifié",
            language: language || "fr",
            contact: contact || "non spécifié",
          },
        },
      },
      { upsert: true, new: true }
    );

    console.log("Visiteur stocké dans MongoDB avec check-in:", visitor);

    const employee = await Employee.findOne({
      $or: [{ email: contact }, { name: contact }],
    });

    let locationInfo = null;
    let guidanceInfo = null;
    if (employee) {
      locationInfo = employee.location;
      guidanceInfo =
        employee.guidance ||
        `Depuis l'accueil, ${
          employee.location.includes("Étage 1")
            ? "prenez l'ascenseur au 1er étage"
            : employee.location.includes("2ème")
            ? "prenez l'ascenseur au 2ème étage"
            : "restez au rez-de-chaussée"
        }, puis dirigez-vous vers ${employee.location}.`;
    }

    res.json({
      success: true,
      message: "Visiteur enregistré avec succès.",
      badgeURL,
      location: locationInfo,
      guidance: guidanceInfo,
    });
  } catch (err) {
    console.error(" Erreur /register-visitor:", err);
    res.status(500).json({ success: false, message: "Erreur serveur." });
  }
});

app.post("/check-out", async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ success: false, message: "Email requis" });
  }

  try {
    const now = new Date();
    const todayDate = now.toISOString().split("T")[0]; // Date actuelle au format YYYY-MM-DD

    const visitor = await Visitor.findOneAndUpdate(
      { email, "visitHistory.date": todayDate, "visitHistory.checkOutTime": null },
      {
        $set: {
          "visitHistory.$[elem].checkOutTime": now,
        },
      },
      {
        arrayFilters: [{ "elem.date": todayDate, "elem.checkOutTime": null }],
        new: true,
      }
    );

    if (!visitor) {
      console.warn(`No visitor found or no ongoing visit for ${email} on ${todayDate}`);
      return res.status(404).json({
        success: false,
        message: "Visiteur non trouvé ou aucune visite en cours pour aujourd'hui",
      });
    }

    console.log(`Updated visitor check-out:`, visitor.visitHistory.map(h => ({ date: h.date, checkIn: h.checkInTime, checkOut: h.checkOutTime }))); // Debug log
    res.json({ success: true, message: "Check-out effectué avec succès" });
  } catch (error) {
    console.error("Erreur lors du check-out :", error);
    res.status(500).json({ success: false, message: "Erreur serveur" });
  }
});

const execCommand = (command) =>
  new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });

const lipSyncMessage = async (messageIndex) => {
  const time = Date.now();
  const audiosDir = path.join(__dirname, "audios");
  console.log(`Starting conversion for message ${messageIndex}`);

  try {
    const mp3File = path.join(audiosDir, `message_${messageIndex}.mp3`);
    const wavFile = path.join(audiosDir, `message_${messageIndex}.wav`);
    const jsonFile = path.join(audiosDir, `message_${messageIndex}.json`);

    // Vérifier si le fichier MP3 existe et a une taille non nulle
    const stats = await fs.stat(mp3File).catch(() => null);
    if (!stats || stats.size === 0) {
      throw new Error(`MP3 file ${mp3File} is empty or does not exist`);
    }

    await execCommand(`ffmpeg -y -i "${mp3File}" "${wavFile}"`);
    console.log(`Audio conversion done in ${Date.now() - time}ms`);

    await execCommand(
      `bin\\rhubarb.exe -f json -o "${jsonFile}" "${wavFile}" -r phonetic`
    );
    console.log(`Lip sync done in ${Date.now() - time}ms`);
  } catch (err) {
    console.error(`Rhubarb failed for message ${messageIndex}:`, err);
    const fallbackLipsync = {
      mouthCues: [{ start: 0.0, end: 1.0, value: "A" }],
    };
    await fs.writeFile(
      path.join(__dirname, `audios/message_${messageIndex}.json`),
      JSON.stringify(fallbackLipsync)
    );
  }
};
const readJsonTranscript = async (file) => {
  const data = await fs.readFile(file, "utf8");
  return JSON.parse(data);
};

const audioFileToBase64 = async (file) => {
  const data = await fs.readFile(file);
  return data.toString("base64");
};

async function callGroqCompletion(messages) {
  const response = await fetch(`${GROQ_API_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages,
      max_tokens: 1000,
      temperature: 1.0,
      top_p: 1.0,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Groq API error: ${response.status} ${errText}`);
  }

  return response.json();
}

let counter = 0;
let hasGreeted = false;

app.get("/", (req, res) => {
  res.send(" API de Prologic Avatar en ligne !");
});

app.post("/chat", async (req, res) => {
  counter++;
  console.log(`Requête #${counter}`);
  console.log("Backend a reçu la requête POST /chat");
  console.log("Contenu de req.body:", req.body);
  console.log("ElevenLabs API Key loaded:", !!elevenLabsApiKey);

  const { message: userMessage, name: recognizedName, language = "fr", fixed = false } = req.body;
  console.log("Valeur de userMessage:", JSON.stringify(userMessage));
  console.log("Nom reconnu:", recognizedName || "null");
  console.log("Langue reçue:", language);

  if (typeof userMessage !== "string" || userMessage.trim() === "") {
    console.warn("No user message provided dans /chat");
    return res.send({
      messages: [
        {
          content: "Hey dear... How was your day?",
          audio: await audioFileToBase64("audios/intro_0.wav"),
          lipsync: await readJsonTranscript("audios/intro_0.json"),
          facialExpression: "smile",
          animation: "greeting",
        },
      ],
    });
  }

  if (!elevenLabsApiKey || !GROQ_API_KEY) {
    console.warn("Missing API keys.");
    return res.send({
      messages: [
        {
          content: "Please my dear, don't forget to add your API keys!",
          audio: await audioFileToBase64("audios/api_0.wav"),
          lipsync: await readJsonTranscript("audios/api_0.json"),
          facialExpression: "angry",
          animation: "angry",
        },
      ],
    });
  }

const testEmbedding = await embedText("Employé : alaa, Bureau : Salle 2");
const testSearch = await index.query({ vector: testEmbedding, topK: 10, includeMetadata: true });
console.log("Manual test search:", testSearch.matches.map(m => ({ id: m.id, text: m.metadata.text })));
let contextDocs = await searchKnowledge(userMessage, recognizedName);
  console.log("Contexte trouvé:", contextDocs);

  const systemMessage = {
    role: "system",
    content: `
    You are an interactive AI avatar for **Prologic** company reception.
    - If a visitor's name is provided ("${recognizedName || 'none'}"), use it to personalize the response and do NOT use the visitor context.
    - If no name is provided, STRICTLY use ONLY the following context from the company database for your response:
    ${contextDocs.join("\n")}
    - Do not invent information that is not in the context.
    - If the query asks for location, guidance, or employee info, extract and reformulate EXACTLY from the context (e.g., if context says "Bureau : Salle 2, Guidance : Depuis l'accueil... ", use that verbatim and adapt politely).
    - Do NOT invent ANY information not in the context (no floors, doors, or directions not mentioned).
    - If no relevant info in context, say: "Désolé, je n'ai pas d'information sur cela dans notre base de données. Pouvez-vous préciser ?"
    - Always be polite and professional.
    - Speak only in ${
      language === "en" ? "English" : language === "ar" ? "Arabic" : "French"
    }.
    - ${!hasGreeted ? "- Always mention 'Prologic' in your first greeting." : "- Do NOT greet again unless user explicitly says hello."}
    - Reply with a JSON array of messages, each message includes content, animation, facialExpression.
    - Valid animations: ['clapping', 'greeting', 'Idle', 'laughing', 'talkAsk', 'talking', 'TalkingFunny', 'talkingQuestion']
    - Valid facial expressions: ['smile', 'neutral', 'angry', 'sad', 'funnyFace', 'surprised', 'crazy']
    - When giving directions, speak as an external guide, not as the visitor.
    - Always use the second person ("you") instead of the first person ("I").
    - Example: "To reach Salle 2, take the elevator to the 2nd floor, then turn left."
    - Never say phrases like "I will go" or "I am going".
    - Reformulez toujours le contexte de manière conversationnelle et naturelle, comme si vous parliez à un visiteur (ex. : "Pour aller chez M. Alaa, prenez l'ascenseur... " au lieu de répéter "Guidance : ...").
    - Évitez les termes techniques comme "Guidance" ou "Bureau :" ; intégrez-les fluidement.
    Example response:
    [
      {
        "content": "${
          recognizedName
            ? `Bonjour ${recognizedName} ! Bienvenue chez Prologic. Comment puis-je vous aider aujourd'hui ?`
            : language === "en"
            ? "Hello! Welcome to Prologic. How can I assist you today?"
            : language === "ar"
            ? "مرحبًا! أهلاً بك في Prologic. كيف يمكنني مساعدتك اليوم؟"
            : "Bonjour ! Bienvenue chez Prologic. Comment puis-je vous aider aujourd'hui ?"
        }",
        "animation": "greeting",
        "facialExpression": "smile"
      }
    ]
    `,
  };

  if (!hasGreeted) {
    hasGreeted = true;
  }

  const messagesToSend = [systemMessage];

  if (recognizedName) {
    messagesToSend.push({
      role: "user",
      content: `The visitor's name is ${recognizedName}. Please greet them by name.`,
    });
  }

  messagesToSend.push({ role: "user", content: userMessage });

  try {
    const groqResponse = await callGroqCompletion(messagesToSend);

    const aiResponse = groqResponse.choices[0].message.content;
    console.log(" Réponse brute Groq:", aiResponse);

    let messages;
    try {
      messages = JSON.parse(aiResponse);
    } catch (err) {
      console.error(" Invalid JSON from AI:", aiResponse);
      return res.status(500).send({ error: "AI response error" });
    }

    const results = await Promise.allSettled(
      messages.map(async (message, i) => {
        const textInput = message.content?.trim();
        if (!textInput) {
          console.error(` Message ${i} has no text:`, message);
          return;
        }

        const fileName = `audios/message_${i}.mp3`;

        try {
          await voice.textToSpeech(
            elevenLabsApiKey,
            voiceID,
            fileName,
            textInput
          );
          await lipSyncMessage(i);

          message.audio = await audioFileToBase64(fileName);
          message.lipsync = await readJsonTranscript(
            `audios/message_${i}.json`
          );
        } catch (error) {
          console.error(
            `Error generating audio/lipsync for message ${i}:`,
            error
          );
          message.audio = await audioFileToBase64("audios/fallback.mp3");
          message.lipsync = await readJsonTranscript("audios/fallback.json");
          message.facialExpression = "neutral";
          message.animation = "Idle";
        }

        message.facialExpression = message.facialExpression || "neutral";
        message.animation = message.animation || "talking";

        return message;
      })
    );

    const successfulMessages = results
      .filter((r) => r.status === "fulfilled" && r.value)
      .map((r) => r.value);

    res.send({ messages: successfulMessages });
  } catch (err) {
    console.error(" Error calling Groq API:", err);
    res.status(500).send({
      messages: [
        {
          content:
            "Désolé, le service AI est temporairement indisponible. Réessaie plus tard.",
          animation: "sad",
          facialExpression: "sad",
        },
      ],
    });
  }
});
app.post("/api/visitors", async (req, res) => {
  try {
    const { dateRange } = req.body || {};
    const now = new Date();
    let from, to;

    
  if (dateRange && dateRange.from && dateRange.to && new Date(dateRange.to) >= new Date(dateRange.from)) {
      from = dateRange.from.split("T")[0]; 
      to = dateRange.to.split("T")[0];
      console.log(`Received dateRange: ${from} to ${to}`);
    } else {
      const now = new Date();
      from = new Date(now.getUTCFullYear(), now.getUTCMonth(), 1).toLocaleDateString("en-CA", { timeZone: "Europe/Paris" });
      to = now.toLocaleDateString("en-CA", { timeZone: "Europe/Paris" });
      console.warn(`Invalid or missing dateRange, using current month: ${from} to ${to}`);
    }

    const currentMonthStart = new Date(from);
    currentMonthStart.setUTCHours(0, 0, 0, 0);
    const currentMonthEnd = new Date(to);
    currentMonthEnd.setUTCHours(23, 59, 59, 999);

    // Calculate previous month based on the start of the current range
    const previousMonthStart = new Date(currentMonthStart);
    previousMonthStart.setUTCDate(1);
    previousMonthStart.setUTCMonth(previousMonthStart.getUTCMonth() - 1);
    const previousMonthEnd = new Date(previousMonthStart);
    previousMonthEnd.setUTCMonth(previousMonthEnd.getUTCMonth() + 1);
    previousMonthEnd.setUTCDate(0);
    previousMonthEnd.setUTCHours(23, 59, 59, 999);

    console.log(`Date Range: from ${currentMonthStart.toISOString()} to ${currentMonthEnd.toISOString()} (UTC)`);
    console.log(`Previous Month: from ${previousMonthStart.toISOString()} to ${previousMonthEnd.toISOString()} (UTC)`);

    const visitors = await Visitor.find().lean();

    const visitorData = visitors.map((visitor) => ({
      id: visitor._id.$oid,
      email: visitor.email,
      firstName: visitor.firstName,
      lastName: visitor.lastName,
      photoPath: visitor.photoPath,
      registeredAt: visitor.registeredAt.$date,
      type: visitor.type,
      visitHistory: visitor.visitHistory.map((history) => ({
        date: history.date,
        time: history.time,
        checkInTime: history.checkInTime ? new Date(history.checkInTime).toISOString() : null,
        checkOutTime: history.checkOutTime ? new Date(history.checkOutTime).toISOString() : null,
        purpose: history.purpose,
        language: history.language,
        contact: history.contact,
        _id: history._id.$oid,
      })),
    }));

    // Hourly Stats
    const hourlyStats = Array(24)
      .fill(0)
      .map((_, i) => {
        const targetHour = i;
        const hourRangeStart = targetHour;
        const hourRangeEnd = targetHour + 1;
        const count = visitors.reduce((acc, visitor) => {
          return (
            acc +
            visitor.visitHistory.filter((history) => {
              const visitTime = history.checkInTime ? new Date(history.checkInTime) : null;
              if (!visitTime) return false;
              const hour = visitTime.getUTCHours() + 2; 
              return (
                visitTime >= currentMonthStart &&
                visitTime <= currentMonthEnd &&
                hour >= hourRangeStart &&
                hour < hourRangeEnd
              );
            }).length
          );
        }, 0);
        return { hour: `${targetHour}h`, visitors: count };
      });

    // Employee Stats
    const normalizeContact = (contact) => {
      if (!contact) return "Unknown";
      let normalized = contact.toLowerCase().trim();
      if (["mr zin", "zine", "zin", "mr zine"].includes(normalized)) return "Mr Zine";
      return normalized.charAt(0).toUpperCase() + normalized.slice(1);
    };

    const employeeVisits = {};
    visitors.forEach((visitor) => {
      visitor.visitHistory.forEach((history) => {
        const contact = normalizeContact(history.contact);
        if (contact.toLowerCase() !== "non spécifié" && contact.toLowerCase() !== "unknown") {
          employeeVisits[contact] = (employeeVisits[contact] || 0) + 1;
        }
      });
    });

    const departmentFallback = {
      chaima: "Marketing",
      alaa: "IT",
      "mr zine": "Ventes",
      aicha: "RH",
      ahmed: "Finance",
      "mr zin": "Sécurité",
    };

    const employeeStats = await Promise.all(
      Object.keys(employeeVisits).map(async (name) => {
        const employee = await Employee.findOne({
          $or: [{ name: new RegExp(`^${name}$`, "i") }, { email: new RegExp(`^${name}$`, "i") }],
        }).lean();
        const department = employee?.department || departmentFallback[name.toLowerCase()] || "N/A";
        return { name, visits: employeeVisits[name], department };
      })
    );

    const uniqueEmployeeStats = [...new Map(employeeStats.map((item) => [item.name, item])).values()].sort(
      (a, b) => b.visits - a.visits
    );

    // Department Stats
    const departmentStats = [
      { name: "Ventes", visitors: 0, percentage: 0 },
      { name: "IT", visitors: 0, percentage: 0 },
      { name: "Marketing", visitors: 0, percentage: 0 },
      { name: "RH", visitors: 0, percentage: 0 },
      { name: "Finance", visitors: 0, percentage: 0 },
      { name: "Sécurité", visitors: 0, percentage: 0 },
    ];

    visitors.forEach((visitor) => {
      visitor.visitHistory.forEach((history) => {
        const contact = normalizeContact(history.contact);
        if (contact !== "non spécifié" && contact !== "unknown") {
          const dept = departmentFallback[contact.toLowerCase()] || "N/A";
          const deptIndex = departmentStats.findIndex(d => d.name === dept);
          if (deptIndex !== -1) departmentStats[deptIndex].visitors += 1;
        }
      });
    });

    // Total Visitors
const currentVisitors = [...new Set(
  visitors
    .flatMap((v) => v.visitHistory
      .filter((h) => {
        if (!h.checkInTime) return false;
        const visitDate = new Date(h.checkInTime).toLocaleDateString("en-CA", { timeZone: "Europe/Paris" });
        const included = visitDate >= from && visitDate <= to;
        console.log(`Visitor: ${v.email}, Visit Date: ${h.date}, CheckInTime: ${h.checkInTime}, CET Date: ${visitDate}, Included: ${included}`);
        return included;
      })
      .map((h) => v.email)
    )
)].length;
   console.log(`Current Visitors (with visit.date): ${currentVisitors}, Emails:`, [...new Set(visitors.map((v) => v.email))]);

    const previousVisitors = [...new Set(
      visitors
        .flatMap((v) => v.visitHistory
          .filter((h) => h.checkInTime && new Date(h.checkInTime) >= previousMonthStart && new Date(h.checkInTime) <= previousMonthEnd)
          .map((h) => v.email)
        )
    )].length;
    console.log(`Previous Visitors (with checkInTime): ${previousVisitors}`);

    // Average Duration
    const calculateAverageDuration = (visits) => {
      const completedVisits = visits.filter((v) => v.checkInTime && v.checkOutTime);
      console.log("Completed visits:", completedVisits.map(v => ({
        email: v.email,
        date: v.date,
        time: v.time,
        checkIn: v.checkInTime,
        checkOut: v.checkOutTime,
        durationMs: v.checkOutTime && v.checkInTime ? (new Date(v.checkOutTime) - new Date(v.checkInTime)) : null
      })));
      if (completedVisits.length === 0) {
        console.warn("No completed visits found for duration calculation.");
        return 0;
      }
      const totalDurationMs = completedVisits.reduce(
        (acc, v) => acc + (new Date(v.checkOutTime) - new Date(v.checkInTime)),
        0
      );
      const avgDurationMs = totalDurationMs / completedVisits.length;
      console.log(`Total duration: ${totalDurationMs}ms, Average: ${avgDurationMs}ms`);
      return Math.round(avgDurationMs / 60000); // Convert to minutes
    };

    const currentMonthVisits = visitors
      .flatMap((v) => v.visitHistory.map(h => ({ ...h, email: v.email })))
      .filter((h) => h.checkInTime && new Date(h.checkInTime) >= currentMonthStart && new Date(h.checkInTime) <= currentMonthEnd);
    const averageDuration = calculateAverageDuration(currentMonthVisits);

    const previousMonthVisits = visitors
      .flatMap((v) => v.visitHistory.map(h => ({ ...h, email: v.email })))
      .filter((h) => h.checkInTime && new Date(h.checkInTime) >= previousMonthStart && new Date(h.checkInTime) <= previousMonthEnd);
    const previousAverageDuration = calculateAverageDuration(previousMonthVisits);

    // Trends
    const visitorTrend = previousVisitors > 0
      ? Math.round(((currentVisitors - previousVisitors) / previousVisitors) * 100 * 10) / 10
      : previousVisitors === 0 && currentVisitors > 0 ? 100 : 0;
    const durationTrend = previousAverageDuration > 0
      ? Math.round(((averageDuration - previousAverageDuration) / previousAverageDuration) * 100 * 10) / 10
      : previousAverageDuration === 0 && averageDuration > 0 ? 100 : 0;

    console.log(`Visitor Trend: ${visitorTrend}%, Duration Trend: ${durationTrend}%`);

    // Active Visitors
    const activeVisitors = visitors.filter((v) =>
      v.visitHistory.some((h) => h.checkInTime && !h.checkOutTime && new Date(h.checkInTime) > new Date(Date.now() - 24 * 60 * 60 * 1000))
    ).length;

    // Dashboard Stats
    const dashboardStats = {
      totalVisitors: currentVisitors,
      activeVisitors,
      peakHour: hourlyStats.reduce(
        (max, curr) => (max.visitors > curr.visitors ? max : curr),
        { hour: "N/A", visitors: 0 }
      ).hour,
      averageDuration,
      topEmployee: uniqueEmployeeStats.length ? uniqueEmployeeStats[0].name : "N/A",
      topDepartment: departmentStats.reduce(
        (max, curr) => (max.visitors > curr.visitors ? max : curr),
        { name: "N/A", visitors: 0 }
      ).name,
      visitorTrend: `${visitorTrend}`,
      durationTrend: `${durationTrend}`,
    };

    // Calculate department percentages
    const totalDeptVisitors = departmentStats.reduce((sum, dept) => sum + dept.visitors, 0);
    departmentStats.forEach((dept) => {
      dept.percentage = totalDeptVisitors > 0 ? Math.round((dept.visitors / totalDeptVisitors) * 100) : 0;
    });

    res.json({
      visitorData,
      hourlyStats,
      employeeStats: uniqueEmployeeStats,
      departmentStats,
      dashboardStats,
    });
  } catch (error) {
    console.error("Error fetching visitors:", error);
    res.status(500).json({ error: "Erreur serveur lors de la récupération des visiteurs." });
  }
});

app.get('/api/health', async (req, res) => {
  try {
    await mongoose.connection.db.admin().ping();
    res.json({ status: 'ok', message: 'Server and MongoDB are running' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: 'MongoDB not connected', error: error.message });
  }
});


app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;

  console.log('Login attempt:', { email }); 

  if (!email || !password) {
    console.log('Missing email or password');
    return res.status(400).json({ message: 'Email and password are required' });
  }

  try {
 
    const admin = await Admin.findOne({ email });
    if (!admin) {
      console.log('Admin not found for email:', email);
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    if (!admin.isAdmin) {
      console.log('User is not an admin:', email);
      return res.status(403).json({ message: 'User is not an admin' });
    }

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      console.log('Password mismatch for email:', email);
      return res.status(401).json({ message: 'Invalid email or password' });
    }

   
    const token = jwt.sign(
      { id: admin._id, email: admin.email, isAdmin: admin.isAdmin },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    console.log('Login successful for:', email);
    res.json({ token });
  } catch (error) {
    console.error('Login error:', error.message);
    res.status(500).json({ message: 'Server error' });
  }
});

const createAdmin = async () => {
  const email = 'admin@example.com';
  const password = 'admin123';
  const hashedPassword = await bcrypt.hash(password, 10);

  const admin = new Admin({
    email,
    password: hashedPassword,
    isAdmin: true,
  });

  try {
    await admin.save();
    console.log('Admin user created');
  } catch (error) {
    console.error('Error creating admin:', error);
  }
};


// createAdmin()


app.listen(port, () => {
  console.log(`🚀 Backend démarré sur http://localhost:${port}`);
});