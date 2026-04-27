import mongoose from 'mongoose'

const dashBoardLogSchema = new mongoose.Schema({
  userId: {
    type: String,
    ref: 'DiscordUser',
    index: true,
    required: true,
  },
  occurredAt: {
    type: Date,
    required: false,
    default: Date.now,
  },
  logType: {
    type: [String],
    required: true,
    enum: ['zoom-register', 'zoom-refresh', 'discord-command', 'discord-moderation', 'clickfunnels']
  },
  zoomLogId: {
    type: mongoose.Schema.Types.ObjectId,
    required: false,
    ref: 'ZoomLog',
  },
  count: {
    type: Number,
    required: true,
    default: 1,
  }
})

export const DashBoardLog = mongoose.model('DashBoardLog', dashBoardLogSchema)
