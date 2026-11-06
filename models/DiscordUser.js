import mongoose from 'mongoose';

const discordUserSchema = new mongoose.Schema({
  _id: {
    type: String,
    required: true,
  },
  username: {
    type: String,
    required: true,
  },
  roles: {
    type: [String],
    default: [],
  },
  previousUsernames: {
    type: [String],
    default: [],
  },
  messageCount: {
    type: Number,
    default: 0,
  },
  joinedAt: {
    type: Date,
  },
  removedAt: {
    type: Date,
    default: null,
  },
  avatarUrl: {
    type: String,
    default: null,
  },
  cfContactId: {
    type: Number,
    default: null,
    index: true,
  },
  // ClickFunnels address, synced nightly by cf-location.js. *Key fields are
  // normalized for grouping; the others are display names.
  cfLocation: {
    country: { type: String, default: null },
    region: { type: String, default: null },
    regionKey: { type: String, default: null },
    city: { type: String, default: null },
    cityKey: { type: String, default: null },
    syncedAt: { type: Date, default: null },
  },
});

export const DiscordUser = mongoose.model('DiscordUser', discordUserSchema);

