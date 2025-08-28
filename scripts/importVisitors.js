import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import csvParser from 'csv-parser';
import { fileURLToPath } from 'url';
import Visitor from '../models/Visitor.js';
import dotenv from "dotenv";

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const csvFilePath = path.join(__dirname, '../data/visitors.csv'); 

mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

mongoose.connection.once('open', () => {
  console.log('Connecté à MongoDB');
  importData();
});

function importData() {
  const visitors = [];

  fs.createReadStream(csvFilePath, 'utf8')
    .on('data', chunk => {
      const text = chunk.toString();
      const isSemicolon = text.includes(';');
      const separator = isSemicolon ? ';' : ',';

      fs.createReadStream(csvFilePath)
        .pipe(csvParser({ separator, skipLines: 0 }))
        .on('data', (row) => {
          try {
            const firstName = row.firstName?.trim();
            const lastName = row.lastName?.trim();
            const email = row.email?.trim();
            const image = row.image?.trim();
            const date = row.date?.trim();
            const time = row.time?.trim();

            if (!firstName || !lastName || !email || !image) return;

            visitors.push({
              firstName,
              lastName,
              email,
              image,
              visitHistory: [{
                date: date || null,
                time: time || null
              }]
            });
          } catch (err) {
            console.warn(' Ligne ignorée (malformée)');
          }
        })
        .on('end', async () => {
          try {
            await Visitor.insertMany(visitors);
            console.log(` ${visitors.length} visiteurs insérés avec succès`);
            process.exit(0);
          } catch (err) {
            console.error(' Erreur insertion MongoDB:', err);
            process.exit(1);
          }
        });
    });
}

