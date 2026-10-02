const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')

const userSchema = new mongoose.Schema({
  nome: { type: String, required: true, trim: true },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  cpf: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  senha: { type: String, required: true },

  telefone: {
    type: String,
    required: false,
    default: null,
    trim: true
  },
  chavePix: {
    type: String,
    required: false,
    default: null,
    trim: true
  },
  tipoChavePix: {
    type: String,
    enum: ['cpf', 'email', 'telefone', 'aleatoria'],
    default: null
  },

  role: { type: String, default: 'user' },
  status: { type: String, default: 'ativo' },

  onboardingCompleto: { type: Boolean, default: false },
  ultimoAcesso: { type: Date, default: Date.now },
  badges: [
    {
      id: { type: String, required: true },
      em: { type: Date, default: Date.now },
      _id: false
    }
  ],

  codigoConvite: { type: String, unique: true, sparse: true },
  indicadoPor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  meusIndicados: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  totalIndicacoes: { type: Number, default: 0 },
  indicacoesConfirmadas: { type: Number, default: 0 },
  totalComissao: { type: Number, default: 0 },
  totalIndicacoesComissionadas: { type: Number, default: 0 },

  aguardandoVermelho: { type: Boolean, default: false },
  posicaoFila: { type: Number, default: null },
  dataEntradaFila: { type: Date, default: null },
  rodadaBloqueada: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Rodada',
    default: null
  },

  saldo: { type: Number, default: 0 },
  totalGanho: { type: Number, default: 0 },
  saldoPremio: { type: Number, default: 0 },
  totalSacado: { type: Number, default: 0 },

  resetPasswordToken: { type: String },
  resetPasswordExpires: { type: Date },

  createdAt: { type: Date, default: Date.now }
})

userSchema.methods.compararSenha = async function (senha) {
  return await bcrypt.compare(senha, this.senha)
}

userSchema.methods.gerarCodigoConvite = function () {
  this.codigoConvite =
    'CONVITE-' + Math.random().toString(36).substring(2, 10).toUpperCase()
}

module.exports = mongoose.model('User', userSchema)