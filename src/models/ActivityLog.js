const mongoose = require('mongoose')

const activitySchema = new mongoose.Schema(
  {
    tipo: {
      type: String,
      enum: [
        'pagamento',
        'entrada',
        'premio',
        'convite',
        'rodada_avancou',
        'fila_alocado',
        'novo_indicado',
        'comissao'
      ],
      required: true
    },
    usuario: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    nomeExibicao: { type: String, required: true },
    rodada: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Rodada',
      default: null
    },
    mensagem: { type: String, required: true, maxlength: 200 },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    createdAt: {
      type: Date,
      default: Date.now,
      expires: 60 * 60 * 24 * 7
    }
  },
  { timestamps: false }
)

activitySchema.index({ createdAt: -1 })

module.exports = mongoose.model('ActivityLog', activitySchema)
