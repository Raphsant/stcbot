import mongoose from 'mongoose';

const messageActivitySchema = new mongoose.Schema({
  userId:        { type: String, required: true, index: true },
  date:          { type: Date,   required: true },
  channelId:     { type: String, required: true },
  channelName:   { type: String },
  count:         { type: Number, required: true, default: 0 },
  charSum:       { type: Number, required: true, default: 0 },
  lastMessageAt: { type: Date },
}, { collection: 'messageActivity' });

messageActivitySchema.index(
  { userId: 1, date: 1, channelId: 1 },
  { unique: true }
);

export const MessageActivity = mongoose.model('MessageActivity', messageActivitySchema);
