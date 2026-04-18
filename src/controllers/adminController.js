const User = require('../models/User');
const Rodada = require('../models/Rodada');
const Transacao = require('../models/Transacao');
const SolicitacaoSaque = require('../models/SolicitacaoSaque');

// ===========================================
// LISTAR SOLICITAÇÕES DE SAQUE PENDENTES
// ===========================================
exports.listarSolicitacoesPendentes = async (req, res) => {
    try {
        const solicitacoes = await SolicitacaoSaque.find({ status: 'pendente' })
            .populate('usuario', 'nome email telefone chavePix tipoChavePix')
            .populate('rodada', 'nome numero')
            .sort({ dataSolicitacao: 1 });

        res.json({
            success: true,
            count: solicitacoes.length,
            data: solicitacoes
        });
    } catch (error) {
        console.error('❌ Erro ao listar solicitações:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// ===========================================
// LISTAR TODAS SOLICITAÇÕES (histórico)
// ===========================================
exports.listarTodasSolicitacoes = async (req, res) => {
    try {
        const { status, page = 1, limit = 20 } = req.query;
        const query = {};

        if (status) query.status = status;

        const solicitacoes = await SolicitacaoSaque.find(query)
            .populate('usuario', 'nome email chavePix tipoChavePix')
            .populate('rodada', 'nome numero')
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(parseInt(limit));

        const total = await SolicitacaoSaque.countDocuments(query);

        res.json({
            success: true,
            data: solicitacoes,
            total,
            page: parseInt(page),
            totalPages: Math.ceil(total / limit)
        });
    } catch (error) {
        console.error('❌ Erro ao listar solicitações:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// ===========================================
// APROVAR SAQUE
// ===========================================
exports.aprovarSaque = async (req, res) => {
    try {
        const { solicitacaoId } = req.params;
        const { observacao } = req.body;
        const adminId = req.usuarioId;

        const solicitacao = await SolicitacaoSaque.findById(solicitacaoId).populate('usuario');

        if (!solicitacao) {
            return res.status(404).json({ success: false, error: 'Solicitação não encontrada' });
        }

        if (solicitacao.status !== 'pendente') {
            return res.status(400).json({ success: false, error: 'Solicitação já foi processada' });
        }

        solicitacao.status = 'aprovado';
        solicitacao.dataAprovacao = new Date();
        solicitacao.aprovadoPor = adminId;
        solicitacao.observacao = observacao || 'Aprovado pelo administrador';
        await solicitacao.save();

        // Creditar saldo do usuário
        await User.findByIdAndUpdate(solicitacao.usuario._id, {
            $inc: { saldo: solicitacao.valor, totalGanho: solicitacao.valor }
        });

        console.log(`✅ Saque aprovado: ${solicitacao.usuario.nome} - R$ ${solicitacao.valor}`);

        res.json({
            success: true,
            message: 'Saque aprovado com sucesso!'
        });

    } catch (error) {
        console.error('❌ Erro ao aprovar saque:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// ===========================================
// RECUSAR SAQUE
// ===========================================
exports.recusarSaque = async (req, res) => {
    try {
        const { solicitacaoId } = req.params;
        const { motivo } = req.body;

        const solicitacao = await SolicitacaoSaque.findById(solicitacaoId).populate('usuario');

        if (!solicitacao) {
            return res.status(404).json({ success: false, error: 'Solicitação não encontrada' });
        }

        if (solicitacao.status !== 'pendente') {
            return res.status(400).json({ success: false, error: 'Solicitação já foi processada' });
        }

        solicitacao.status = 'recusado';
        solicitacao.observacao = motivo || 'Recusado pelo administrador';
        await solicitacao.save();

        console.log(`❌ Saque recusado: ${solicitacao.usuario.nome}`);

        res.json({
            success: true,
            message: 'Saque recusado'
        });

    } catch (error) {
        console.error('❌ Erro ao recusar saque:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// ===========================================
// MARCAR COMO PAGO (após transferência real)
// ===========================================
exports.marcarComoPago = async (req, res) => {
    try {
        const { solicitacaoId } = req.params;
        const { comprovante } = req.body;

        const solicitacao = await SolicitacaoSaque.findById(solicitacaoId);

        if (!solicitacao) {
            return res.status(404).json({ success: false, error: 'Solicitação não encontrada' });
        }

        solicitacao.status = 'pago';
        solicitacao.dataPagamento = new Date();
        solicitacao.comprovante = comprovante;
        await solicitacao.save();

        res.json({
            success: true,
            message: 'Saque marcado como pago'
        });

    } catch (error) {
        console.error('❌ Erro ao marcar como pago:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// ===========================================
// ESTATÍSTICAS DO ADMIN
// ===========================================
exports.estatisticas = async (req, res) => {
    try {
        const totalUsuarios = await User.countDocuments();
        const totalRodadas = await Rodada.countDocuments();
        const rodadasAtivas = await Rodada.countDocuments({ status: 'em_andamento' });
        const rodadasConcluidas = await Rodada.countDocuments({ status: 'concluida' });

        const totalSolicitacoes = await SolicitacaoSaque.countDocuments();
        const solicitacoesPendentes = await SolicitacaoSaque.countDocuments({ status: 'pendente' });
        const totalPago = await SolicitacaoSaque.aggregate([
            { $match: { status: 'pago' } },
            { $group: { _id: null, total: { $sum: '$valor' } } }
        ]);

        const totalTransacoes = await Transacao.countDocuments({ status: 'confirmado' });
        const valorTotalRecebido = await Transacao.aggregate([
            { $match: { status: 'confirmado' } },
            { $group: { _id: null, total: { $sum: '$valorPago' } } }
        ]);

        res.json({
            success: true,
            data: {
                usuarios: totalUsuarios,
                rodadas: {
                    total: totalRodadas,
                    ativas: rodadasAtivas,
                    concluidas: rodadasConcluidas
                },
                saques: {
                    total: totalSolicitacoes,
                    pendentes: solicitacoesPendentes,
                    totalPago: totalPago[0]?.total || 0
                },
                financeiro: {
                    totalRecebido: valorTotalRecebido[0]?.total || 0,
                    totalTransacoes
                }
            }
        });
    } catch (error) {
        console.error('❌ Erro ao buscar estatísticas:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};