const mongoose = require('mongoose');

const participanteSchema = new mongoose.Schema({
  usuario: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  cor: {
    type: String,
    enum: ['amarelo', 'vermelho', 'azul', 'preto', 'verde', 'concluido'],
    required: true
  },
  posicao: Number,
  dataEntrada: {
    type: Date,
    default: Date.now
  },
  dataPromocao: Date,
  depositoConfirmado: {
    type: Boolean,
    default: false
  },
  dataDeposito: Date,
  comprovantePix: String,
  transacaoId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transacao'
  }
});

const rodadaSchema = new mongoose.Schema({
  numero: {
    type: Number,
    required: true,
    unique: true
  },
  nome: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['aguardando', 'em_andamento', 'concluida', 'cancelada'],
    default: 'aguardando'
  },
  participantes: [participanteSchema],
  
  // Referências diretas por cor
  verde: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  pretos: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  azuis: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  vermelhos: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  
  // Controles
  totalDepositosConfirmados: {
    type: Number,
    default: 0
  },
  todosDepositaram: {
    type: Boolean,
    default: false
  },
  
  // Histórico de movimentações
  historicoMovimentacoes: [{
    usuario: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    corAnterior: String,
    corNova: String,
    data: {
      type: Date,
      default: Date.now
    },
    observacao: String
  }],
  
  // Timeline
  dataInicio: Date,
  dataFim: Date,
  dataTodosDepositaram: Date,
  
  // Relacionamentos
  rodadaOrigem: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Rodada'
  },
  rodadasGeradas: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Rodada'
  }],
  
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Métodos do modelo
rodadaSchema.methods.avancarCores = function() {
  const self = this;
  
  self.participantes.forEach(p => {
    const historico = {
      usuario: p.usuario,
      corAnterior: p.cor,
      data: new Date()
    };
    
    if (p.cor === 'vermelho') {
      p.cor = 'azul';
      historico.corNova = 'azul';
    } else if (p.cor === 'azul') {
      p.cor = 'preto';
      historico.corNova = 'preto';
    } else if (p.cor === 'preto') {
      p.cor = 'verde';
      historico.corNova = 'verde';
    } else if (p.cor === 'verde') {
      p.cor = 'concluido';
      historico.corNova = 'concluido';
    }
    
    if (historico.corNova) {
      self.historicoMovimentacoes.push(historico);
    }
  });
  
  return self;
};

// Verificar se todos vermelhos depositaram
rodadaSchema.methods.verificarDepositos = function() {
  const vermelhos = this.participantes.filter(p => p.cor === 'vermelho');
  const todosDepositaram = vermelhos.every(v => v.depositoConfirmado);
  
  if (todosDepositaram && !this.todosDepositaram) {
    this.todosDepositaram = true;
    this.dataTodosDepositaram = new Date();
  }
  
  return todosDepositaram;
};

// Estatísticas da rodada
rodadaSchema.methods.getStats = function() {
  return {
    totalParticipantes: this.participantes.length,
    verdes: this.participantes.filter(p => p.cor === 'verde').length,
    pretos: this.participantes.filter(p => p.cor === 'preto').length,
    azuis: this.participantes.filter(p => p.cor === 'azul').length,
    vermelhos: this.participantes.filter(p => p.cor === 'vermelho').length,
    amarelos: this.participantes.filter(p => p.cor === 'amarelo').length,
    depositosConfirmados: this.totalDepositosConfirmados,
    percentualConcluido: (this.totalDepositosConfirmados / 8) * 100
  };
};

module.exports = mongoose.model('Rodada', rodadaSchema);
