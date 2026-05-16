// models/ChatMessage.js
const mongoose = require('mongoose')

const chatMessageSchema = new mongoose.Schema({
  rodadaId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Rodada',
    required: true,
    index: true
  },
  usuarioId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  nome: {
    type: String,
    required: true,
    trim: true
  },
  mensagem: {
    type: String,
    required: true,
    maxlength: 500,
    trim: true
  },
  tipo: {
    type: String,
    enum: ['texto', 'sistema'],
    default: 'texto'
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  }
})

// Índice composto para consultas eficientes
chatMessageSchema.index({ rodadaId: 1, createdAt: -1 })

module.exports = mongoose.model('ChatMessage', chatMessageSchema)
