// models/SolicitacaoSaque.js
const mongoose = require('mongoose');

const solicitacaoSaqueSchema = new mongoose.Schema({
    usuario: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    rodada: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Rodada',
        required: false   // <--- ALTERADO: agora não é obrigatório
    },
    valor: {
        type: Number,
        required: true,
        default: 1000
    },
    chavePix: {
        type: String,
        required: true
    },
    tipoChavePix: {
        type: String,
        enum: ['cpf', 'email', 'telefone', 'aleatoria'],
        required: true
    },
    status: {
        type: String,
        enum: ['pendente', 'aprovado', 'recusado', 'pago'],
        default: 'pendente'
    },
    dataSolicitacao: {
        type: Date,
        default: Date.now
    },
    dataAprovacao: Date,
    dataPagamento: Date,
    observacao: String,
    aprovadoPor: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('SolicitacaoSaque', solicitacaoSaqueSchema);