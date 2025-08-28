
import { Schema, model } from 'mongoose';

const visitSchema = new Schema({
  visitorId: { type: Schema.Types.ObjectId, ref: 'Visitor' },
  date: Date,
  purpose: String,
  contactPerson: String,
  language: String
});

export default model('Visit', visitSchema);
