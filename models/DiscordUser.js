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
  // ClickFunnels subscription, synced nightly by cf-membership.js. expiresAt
  // is the paid-through date; expirySource records which ClickFunnels field
  // it came from. Mirrored in stc-front (server/models/DiscordUser.schema.ts).
  cfMembership: {
    status: { type: String, default: null },
    orderId: { type: Number, default: null },
    productName: { type: String, default: null },
    interval: { type: String, default: null },
    expiresAt: { type: Date, default: null },
    expirySource: { type: String, default: null },
    nextChargeAt: { type: Date, default: null },
    canceledAt: { type: Date, default: null },
    syncedAt: { type: Date, default: null },
  },
});

export const DiscordUser = mongoose.model('DiscordUser', discordUserSchema);

