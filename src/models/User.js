const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  nome: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  telefone: { type: String, required: true },
  cpf: { type: String, required: true, unique: true },
  chavePix: { type: String, required: true },
  tipoChavePix: { type: String, enum: ['cpf', 'email', 'telefone', 'aleatoria'], required: true },
  senha: { type: String, required: true },
  role: { type: String, default: 'user' },
  status: { type: String, default: 'ativo' },
  codigoConvite: { type: String, unique: true, sparse: true },
  indicadoPor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  meusIndicados: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  totalIndicacoes: { type: Number, default: 0 },
  indicacoesConfirmadas: { type: Number, default: 0 },

  // Campo para marcar usuários que estão aguardando vaga de vermelho
  aguardandoVermelho: { type: Boolean, default: false },

  saldo: { type: Number, default: 0 },
  totalGanho: { type: Number, default: 0 },

  // Campos para recuperacao de senha
  resetPasswordToken: { type: String },
  resetPasswordExpires: { type: Date },

  createdAt: { type: Date, default: Date.now }
});

// Metodo para comparar senha
userSchema.methods.compararSenha = async function (senha) {
  return await bcrypt.compare(senha, this.senha);
};

// Gerar codigo de convite
userSchema.methods.gerarCodigoConvite = function () {
  this.codigoConvite = 'CONVITE-' + Math.random().toString(36).substring(2, 10).toUpperCase();
};

module.exports = mongoose.model('User', userSchema);