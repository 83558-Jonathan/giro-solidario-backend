const mongoose = require('mongoose')

const subscriptionSchema = new mongoose.Schema(
  {
    usuario: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    endpoint: { type: String, required: true, unique: true },
    keys: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true }
    },
    userAgent: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
    lastUsedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
)

subscriptionSchema.index({ usuario: 1 })

module.exports = mongoose.model('Subscription', subscriptionSchema)