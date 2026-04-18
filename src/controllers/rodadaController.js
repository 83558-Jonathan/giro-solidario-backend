const RodadaService = require('../services/rodadaService');
const mongoose = require('mongoose');

// CRIAR nova rodada
exports.criarRodada = async (req, res) => {
  try {
    const rodada = await RodadaService.criarRodada(req.usuarioId);
    res.status(201).json({ success: true, data: rodada });
  } catch (error) {
    console.error('❌ Erro ao criar rodada:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// LISTAR todas as rodadas - com verificação para cada rodada em andamento
exports.listarRodadas = async (req, res) => {
  try {
    const db = mongoose.connection.db;

    // Buscar todas as rodadas em andamento e verificar se precisam avançar
    const rodadasEmAndamento = await db.collection('rodadas')
      .find({ status: 'em_andamento' })
      .toArray();

    // Verificar cada rodada em andamento
    for (const rodada of rodadasEmAndamento) {
      await RodadaService.verificarEAvancarSeNecessario(rodada._id.toString());
    }

    // Buscar todas as rodadas atualizadas
    const rodadas = await db.collection('rodadas')
      .find({})
      .sort({ numero: -1 })
      .toArray();

    res.json({ success: true, count: rodadas.length, data: rodadas });
  } catch (error) {
    console.error('❌ Erro ao listar rodadas:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// BUSCAR rodada por ID
exports.buscarRodadaPorId = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'ID inválido' });
    }

    const db = mongoose.connection.db;
    const rodada = await db.collection('rodadas').findOne({
      _id: new mongoose.Types.ObjectId(id)
    });

    if (!rodada) {
      return res.status(404).json({ success: false, error: 'Rodada não encontrada' });
    }

    res.json({ success: true, data: rodada });
  } catch (error) {
    console.error('❌ Erro ao buscar rodada:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ===========================================
// ADICIONAR PARTICIPANTE - CORRIGIDO
// ===========================================
exports.adicionarParticipante = async (req, res) => {
  try {
    const { rodadaId } = req.params;
    const { usuarioId, indicadorId } = req.body;

    if (!usuarioId) {
      return res.status(400).json({ success: false, error: 'usuarioId é obrigatório' });
    }

    // Buscar a rodada para saber seu status
    const db = mongoose.connection.db;
    const rodada = await db.collection('rodadas').findOne({
      _id: new mongoose.Types.ObjectId(rodadaId)
    });

    if (!rodada) {
      return res.status(404).json({ success: false, error: 'Rodada não encontrada' });
    }

    let rodadaAtualizada;

    // Verificar status da rodada para decidir qual função chamar
    if (rodada.status === 'aguardando') {
      // Rodada ainda não iniciou → adicionar como amarelo
      rodadaAtualizada = await RodadaService.adicionarParticipanteAmarelo(rodadaId, usuarioId, indicadorId);
    } else if (rodada.status === 'em_andamento') {
      // Rodada já iniciou → adicionar como vermelho (investidor)
      rodadaAtualizada = await RodadaService.adicionarParticipanteVermelho(rodadaId, usuarioId, indicadorId);
    } else {
      return res.status(400).json({
        success: false,
        error: 'Rodada já concluída. Não é possível adicionar participantes.'
      });
    }

    res.json({ success: true, data: rodadaAtualizada });
  } catch (error) {
    console.error('❌ Erro ao adicionar participante:', error);
    res.status(400).json({ success: false, error: error.message });
  }
};

// INICIAR rodada (forçar início)
exports.iniciarRodada = async (req, res) => {
  try {
    const { rodadaId } = req.params;
    const rodada = await RodadaService.iniciarRodada(rodadaId);
    res.json({ success: true, data: rodada });
  } catch (error) {
    console.error('❌ Erro ao iniciar rodada:', error);
    res.status(400).json({ success: false, error: error.message });
  }
};

// AVANÇAR rodada (forçar progressão)
exports.avancarRodada = async (req, res) => {
  try {
    const { rodadaId } = req.params;
    const rodada = await RodadaService.avancarRodada(rodadaId);
    res.json({ success: true, data: rodada });
  } catch (error) {
    console.error('❌ Erro ao avançar rodada:', error);
    res.status(400).json({ success: false, error: error.message });
  }
};

// ===========================================
// VER MANDALA - COM VERIFICAÇÃO AUTOMÁTICA
// ===========================================
exports.getMandala = async (req, res) => {
  try {
    const { rodadaId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(rodadaId)) {
      return res.status(400).json({ success: false, error: 'ID inválido' });
    }

    // ===========================================
    // VERIFICAR E AVANÇAR AUTOMATICAMENTE SE NECESSÁRIO
    // Isso garante que quando todos pagarem, a rodada avance
    // ===========================================
    await RodadaService.verificarEAvancarSeNecessario(rodadaId);

    const db = mongoose.connection.db;
    const rodada = await db.collection('rodadas').findOne({
      _id: new mongoose.Types.ObjectId(rodadaId)
    });

    if (!rodada) {
      return res.status(404).json({ success: false, error: 'Rodada não encontrada' });
    }

    // Buscar nomes dos usuários
    const users = db.collection('users');
    const participantesComNomes = [];

    for (const p of rodada.participantes || []) {
      const user = await users.findOne({ _id: p.usuario });
      participantesComNomes.push({
        ...p,
        nome: user?.nome || 'Desconhecido',
        email: user?.email || ''
      });
    }

    const mandala = {
      ...rodada,
      participantes: participantesComNomes,
      azuis: rodada.azuis || [],
      pretos: rodada.pretos || [],
      vermelhos: rodada.vermelhos || [],
      verde: rodada.verde || null
    };

    res.json({ success: true, data: mandala });
  } catch (error) {
    console.error('❌ Erro ao carregar mandala:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// VERIFICAR STATUS do usuário
exports.verificarStatusUsuario = async (req, res) => {
  try {
    const status = await RodadaService.verificarStatusUsuario(req.usuarioId);
    res.json({ success: true, data: status });
  } catch (error) {
    console.error('❌ Erro ao verificar status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ===========================================
// SACAR PRÊMIO DO VERDE
// ===========================================
exports.sacarPremio = async (req, res) => {
  try {
    const { rodadaId } = req.params;
    const usuarioId = req.usuarioId;

    if (!mongoose.Types.ObjectId.isValid(rodadaId)) {
      return res.status(400).json({ success: false, error: 'ID da rodada inválido' });
    }

    const db = mongoose.connection.db;
    const rodada = await db.collection('rodadas').findOne({
      _id: new mongoose.Types.ObjectId(rodadaId)
    });

    if (!rodada) {
      return res.status(404).json({ success: false, error: 'Rodada não encontrada' });
    }

    if (rodada.status !== 'concluida') {
      return res.status(400).json({ success: false, error: 'Esta rodada ainda não foi concluída' });
    }

    if (rodada.verde?.toString() !== usuarioId) {
      return res.status(403).json({ success: false, error: 'Apenas o VERDE pode solicitar o prêmio' });
    }

    if (rodada.premioVerdePago === true) {
      return res.status(400).json({ success: false, error: 'Prêmio já foi solicitado anteriormente' });
    }

    const usuario = await User.findById(usuarioId);
    if (!usuario) {
      return res.status(404).json({ success: false, error: 'Usuário não encontrado' });
    }

    const SolicitacaoSaque = require('../models/SolicitacaoSaque');

    const solicitacao = new SolicitacaoSaque({
      usuario: usuarioId,
      rodada: rodadaId,
      valor: 900,
      chavePix: usuario.chavePix,
      tipoChavePix: usuario.tipoChavePix,
      status: 'pendente',
      dataSolicitacao: new Date()
    });

    await solicitacao.save();

    // Marcar que já foi solicitado (evita duplicidade)
    await db.collection('rodadas').updateOne(
      { _id: new mongoose.Types.ObjectId(rodadaId) },
      { $set: { premioVerdePago: true } }
    );

    console.log(`💰 Solicitação de saque criada por ${usuario.nome} - Rodada ${rodada.nome}`);

    // Enviar email de notificação para o admin
    try {
      const emailController = require('./emailController');
      await emailController.notificarAdminNovaSolicitacao(usuario, rodada, 900);
    } catch (emailError) {
      console.error('❌ Erro ao notificar admin:', emailError);
    }

    res.json({
      success: true,
      message: 'Solicitação de saque enviada! Aguarde a aprovação do administrador.',
      solicitacaoId: solicitacao._id
    });

  } catch (error) {
    console.error('❌ Erro ao solicitar saque:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};