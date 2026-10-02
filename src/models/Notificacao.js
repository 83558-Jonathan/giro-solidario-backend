const mongoose = require('mongoose')

const notificacaoSchema = new mongoose.Schema(
  {
    usuario: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    tipo: {
      type: String,
      enum: [
        'pagamento_confirmado',
        'rodada_avancou',
        'voce_e_verde',
        'premio_liberado',
        'novo_indicado',
        'fila_subiu',
        'fila_alocado',
        'saque_aprovado',
        'saque_recusado',
        'badge_conquistado',
        'comissao_recebida',
        'aviso'
      ],
      required: true
    },
    titulo: { type: String, required: true, maxlength: 100 },
    mensagem: { type: String, required: true, maxlength: 300 },
    icone: { type: String, default: null },
    link: { type: String, default: '/dashboard' },
    lida: { type: Boolean, default: false, index: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    createdAt: {
      type: Date,
      default: Date.now,
      expires: 60 * 60 * 24 * 30
    }
  },
  { timestamps: false }
)

notificacaoSchema.index({ usuario: 1, lida: 1, createdAt: -1 })

module.exports = mongoose.model('Notificacao', notificacaoSchema)
