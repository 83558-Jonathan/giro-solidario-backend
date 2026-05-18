const mongoose = require('mongoose')

const chatMessageSchema = new mongoose.Schema({
  rodadaId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Rodada',
    required: true
  },
  usuarioId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  nome: {
    type: String
  },
  mensagem: {
    type: String,
    required: true,
    maxlength: 1000
  },
  tipo: {
    type: String,
    enum: ['usuario', 'sistema'],
    default: 'usuario'
  },
  acao: {
    type: String,
    enum: [
      'pagamento_confirmado',
      'rodada_iniciada',
      'rodada_concluida',
      'entrou_na_fila',
      'saiu_da_rodada',
      'lembrete_geral',
      'instrucoes'
    ],
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
})

module.exports = mongoose.model('ChatMessage', chatMessageSchema)
