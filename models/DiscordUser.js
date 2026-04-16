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
});

export const DiscordUser = mongoose.model('DiscordUser', discordUserSchema);

