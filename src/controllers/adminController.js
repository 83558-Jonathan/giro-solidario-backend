// src/controllers/adminController.js
const User = require('../models/User');
const Rodada = require('../models/Rodada');
const Transacao = require('../models/Transacao');
const SolicitacaoSaque = require('../models/SolicitacaoSaque');
const mongoose = require('mongoose');

// ===========================================
// GET ESTATISTICAS GERAIS
// ===========================================
exports.getEstatisticas = async (req, res) => {
    try {
        const db = mongoose.connection.db;

        // Contar usuários
        const totalUsuarios = await User.countDocuments();

        // Contar rodadas por status
        const rodadas = await db.collection('rodadas').aggregate([
            { $group: { _id: '$status', count: { $sum: 1 } } }
        ]).toArray();

        const rodadasAtivas = rodadas.find(r => r._id === 'em_andamento')?.count || 0;
        const rodadasAguardando = rodadas.find(r => r._id === 'aguardando')?.count || 0;
        const rodadasConcluidas = rodadas.find(r => r._id === 'concluida')?.count || 0;

        // Estatísticas de saques
        const saques = await db.collection('solicitacaosaques').aggregate([
            {
                $group: {
                    _id: '$status',
                    count: { $sum: 1 },
                    total: { $sum: '$valor' }
                }
            }
        ]).toArray();

        const saquesPendentes = saques.find(s => s._id === 'pendente')?.count || 0;
        const totalSolicitado = saques.reduce((acc, s) => acc + (s.total || 0), 0);
        const totalPago = saques.find(s => s._id === 'aprovado')?.total || 0;

        // Transações confirmadas
        const transacoesConfirmadas = await Transacao.countDocuments({ status: 'confirmado' });

        res.json({
            success: true,
            data: {
                usuarios: totalUsuarios,
                rodadas: {
                    total: rodadasAtivas + rodadasAguardando + rodadasConcluidas,
                    ativas: rodadasAtivas,
                    aguardando: rodadasAguardando,
                    concluidas: rodadasConcluidas
                },
                saques: {
                    pendentes: saquesPendentes,
                    totalSolicitado: totalSolicitado,
                    totalPago: totalPago
                },
                transacoes: {
                    confirmadas: transacoesConfirmadas
                }
            }
        });
    } catch (error) {
        console.error('Erro ao buscar estatísticas:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// ===========================================
// GET SAQUES PENDENTES
// ===========================================
exports.getSaquesPendentes = async (req, res) => {
    try {
        const solicitacoes = await SolicitacaoSaque.find({ status: 'pendente' })
            .populate('usuario', 'nome email telefone cpf chavePix tipoChavePix')
            .populate('rodada', 'nome numero status createdAt dataFim totalDepositosConfirmados participantes verde pretos azuis vermelhos todosDepositaram')
            .sort({ dataSolicitacao: 1 });

        // Para cada solicitação, buscar dados adicionais da rodada
        const solicitacoesCompletas = await Promise.all(solicitacoes.map(async (s) => {
            const rodada = s.rodada;
            if (rodada) {
                // Buscar nomes dos participantes
                const rodadaCompleta = await Rodada.findById(rodada._id).populate('participantes.usuario', 'nome email');

                // Buscar quem era o verde que ganhou
                const verdeGanhador = rodadaCompleta?.participantes?.find(p => p.cor === 'concluido');

                return {
                    ...s.toObject(),
                    rodada: {
                        ...rodada.toObject(),
                        participantes: rodadaCompleta?.participantes || [],
                        verdeGanhador: verdeGanhador ? {
                            nome: verdeGanhador.usuario?.nome,
                            email: verdeGanhador.usuario?.email
                        } : null,
                        progresso: {
                            participantes: rodada.participantes?.length || 0,
                            vermelhos: rodada.vermelhos?.length || 0,
                            pagos: rodada.totalDepositosConfirmados || 0
                        }
                    }
                };
            }
            return s;
        }));

        res.json({
            success: true,
            data: solicitacoesCompletas
        });
    } catch (error) {
        console.error('Erro ao buscar saques pendentes:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// ===========================================
// GET TODOS SAQUES (HISTÓRICO)
// ===========================================
exports.getTodosSaques = async (req, res) => {
    try {
        const solicitacoes = await SolicitacaoSaque.find({})
            .populate('usuario', 'nome email telefone cpf chavePix tipoChavePix')
            .populate('rodada', 'nome numero status createdAt dataFim')
            .sort({ dataSolicitacao: -1 });

        res.json({
            success: true,
            data: solicitacoes
        });
    } catch (error) {
        console.error('Erro ao buscar histórico de saques:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// ===========================================
// APROVAR SAQUE (SEM TRANSAÇÃO - PARA STANDALONE)
// ===========================================
exports.aprovarSaque = async (req, res) => {
    try {
        const { id } = req.params;

        console.log(`💰 Aprovando saque ID: ${id}`);

        // Buscar a solicitação
        const solicitacao = await SolicitacaoSaque.findById(id);
        if (!solicitacao) {
            return res.status(404).json({ success: false, error: 'Solicitação não encontrada' });
        }

        if (solicitacao.status !== 'pendente') {
            return res.status(400).json({ success: false, error: 'Esta solicitação já foi processada' });
        }

        // Atualizar status da solicitação para APROVADO
        solicitacao.status = 'aprovado';
        solicitacao.dataAprovacao = new Date();
        solicitacao.aprovadoPor = req.usuarioId;
        await solicitacao.save();

        console.log(`✅ Solicitação ${id} atualizada para APROVADO`);

        // Atualizar usuário (adicionar ao saldo)
        const usuario = await User.findByIdAndUpdate(
            solicitacao.usuario,
            {
                $inc: { saldo: solicitacao.valor, totalGanho: solicitacao.valor }
            },
            { new: true }
        );

        console.log(`💰 Saldo do usuário ${usuario?.nome} atualizado: +R$ ${solicitacao.valor}`);

        // Enviar email de notificação para o usuário
        try {
            const emailController = require('./emailController');
            if (emailController.notificarSaqueAprovado) {
                await emailController.notificarSaqueAprovado(usuario, solicitacao);
                console.log(`📧 Email de aprovação enviado para ${usuario?.email}`);
            }
        } catch (emailError) {
            console.error('Erro ao enviar email de aprovação:', emailError);
        }

        res.json({
            success: true,
            message: 'Saque aprovado com sucesso! O valor foi creditado na conta do usuário.'
        });

    } catch (error) {
        console.error('Erro ao aprovar saque:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// ===========================================
// RECUSAR SAQUE (COM REATIVAÇÃO DO PRÊMIO)
// ===========================================
exports.recusarSaque = async (req, res) => {
    try {
        const { id } = req.params;
        const { motivo } = req.body;

        console.log(`❌ Recusando saque ID: ${id}, Motivo: ${motivo}`);

        // Buscar a solicitação
        const solicitacao = await SolicitacaoSaque.findById(id);
        if (!solicitacao) {
            return res.status(404).json({ success: false, error: 'Solicitação não encontrada' });
        }

        if (solicitacao.status !== 'pendente') {
            return res.status(400).json({ success: false, error: 'Esta solicitação já foi processada' });
        }

        // Atualizar status da solicitação para RECUSADO
        solicitacao.status = 'recusado';
        solicitacao.motivoRecusa = motivo;
        solicitacao.dataRecusa = new Date();
        solicitacao.recusadoPor = req.usuarioId;
        await solicitacao.save();

        console.log(`✅ Solicitação ${id} atualizada para RECUSADO`);

        // Reativar o prêmio na rodada para o usuário poder solicitar novamente
        await Rodada.findByIdAndUpdate(
            solicitacao.rodada,
            { $set: { premioVerdePago: false } }
        );

        console.log(`🔄 Prêmio da rodada ${solicitacao.rodada} reativado para novo saque`);

        // Enviar email de notificação para o usuário
        try {
            const usuario = await User.findById(solicitacao.usuario);
            const emailController = require('./emailController');
            if (emailController.notificarSaqueRecusado) {
                await emailController.notificarSaqueRecusado(usuario, solicitacao, motivo);
                console.log(`📧 Email de recusa enviado para ${usuario?.email}`);
            }
        } catch (emailError) {
            console.error('Erro ao enviar email de recusa:', emailError);
        }

        res.json({
            success: true,
            message: 'Saque recusado. O usuário poderá solicitar novamente o prêmio.'
        });

    } catch (error) {
        console.error('Erro ao recusar saque:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// ===========================================
// GET DETALHES DA RODADA (para admin)
// ===========================================
exports.getRodadaDetalhes = async (req, res) => {
    try {
        const { id } = req.params;

        const rodada = await Rodada.findById(id)
            .populate('participantes.usuario', 'nome email telefone cpf')
            .populate('verde', 'nome email')
            .populate('pretos', 'nome email')
            .populate('azuis', 'nome email')
            .populate('vermelhos', 'nome email');

        if (!rodada) {
            return res.status(404).json({ success: false, error: 'Rodada não encontrada' });
        }

        // Estatísticas da rodada
        const participantes = rodada.participantes || [];
        const vermelhos = participantes.filter(p => p.cor === 'vermelho');
        const pagos = vermelhos.filter(v => v.depositoConfirmado).length;

        const stats = {
            totalParticipantes: participantes.length,
            verde: participantes.filter(p => p.cor === 'verde').length,
            preto: participantes.filter(p => p.cor === 'preto').length,
            azul: participantes.filter(p => p.cor === 'azul').length,
            vermelho: vermelhos.length,
            amarelo: participantes.filter(p => p.cor === 'amarelo').length,
            concluido: participantes.filter(p => p.cor === 'concluido').length,
            pagamentosConfirmados: pagos,
            percentualConcluido: vermelhos.length > 0 ? (pagos / vermelhos.length) * 100 : 0
        };

        res.json({
            success: true,
            data: {
                ...rodada.toObject(),
                stats
            }
        });
    } catch (error) {
        console.error('Erro ao buscar detalhes da rodada:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};