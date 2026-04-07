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