const mongoose = require('mongoose')

const comissaoSchema = new mongoose.Schema(
  {
    indicador: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    indicado: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    // Transação que gerou — chave única contra duplicidade
    transacao: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transacao',
      required: true,
      unique: true
    },
    rodada: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Rodada',
      default: null
    },
    valor: {
      type: Number,
      required: true
    },
    tipo: {
      type: String,
      enum: ['unica', 'recorrente'],
      required: true
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  },
  { timestamps: false }
)

comissaoSchema.index({ indicador: 1, createdAt: -1 })
comissaoSchema.index({ tipo: 1, createdAt: -1 })

module.exports = mongoose.model('Comissao', comissaoSchema)
