const mongoose = require('mongoose')
const { VALOR_VERMELHO } = require('../config/constantes')

const transacaoSchema = new mongoose.Schema(
  {
    tipo: {
      type: String,
      enum: ['deposito', 'recebimento', 'estorno'],
      default: 'deposito'
    },
    pagador: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    recebedor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    valor: {
      type: Number,
      required: true,
      default: VALOR_VERMELHO
    },
    valorPago: {
      type: Number,
      default: VALOR_VERMELHO
    },
    rodada: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Rodada',
      required: true
    },
    status: {
      type: String,
      enum: ['pendente', 'confirmado', 'cancelado', 'cancelada_expirada'],
      default: 'pendente'
    },
    comprovante: String,
    cobrancaId: String,
    dataConfirmacao: Date,
    confirmadoPor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    motivoCancelamento: String,
    dataCancelamento: Date,
    createdAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true
  }
)

transacaoSchema.index({ pagador: 1, status: 1 })
transacaoSchema.index({ cobrancaId: 1 })
transacaoSchema.index({ rodada: 1, status: 1 })

module.exports = mongoose.model('Transacao', transacaoSchema)
