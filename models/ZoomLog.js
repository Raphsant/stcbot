import mongoose from 'mongoose';

const zoomLogSchema = new mongoose.Schema({
  meetingId: {
    type: String,
    required: true,
  },
  occurredAt: {
    type: Date,
    required: true,
  },
  participants: {
    type: [{ type: String, ref: 'DiscordUser' }],
    default: [],
    index: true,
  },
  name: {
    type: String,
    required: true,
  },
}, { collection: 'zoomLogs' });

export const ZoomLog = mongoose.model('ZoomLog', zoomLogSchema);
