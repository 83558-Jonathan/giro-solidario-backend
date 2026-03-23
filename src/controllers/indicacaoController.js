const User = require('../models/User');
const mongoose = require('mongoose');

// Buscar minhas indicações
exports.minhasIndicacoes = async (req, res) => {
  try {
    const usuario = await User.findById(req.usuarioId)
      .populate('meusIndicados', 'nome email createdAt');
    
    res.json({
      success: true,
      count: usuario.meusIndicados.length,
      data: usuario.meusIndicados
    });
  } catch (error) {
    console.error('❌ Erro em minhasIndicacoes:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Buscar quem me indicou
exports.meuIndicador = async (req, res) => {
  try {
    const usuario = await User.findById(req.usuarioId)
      .populate('indicadoPor', 'nome email codigoConvite');
    
    res.json({
      success: true,
      data: usuario.indicadoPor || null
    });
  } catch (error) {
    console.error('❌ Erro em meuIndicador:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Verificar permissão de captação (se é AZUL)
exports.verificarPermissaoCaptacao = async (req, res) => {
  try {
    const { rodadaId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(rodadaId)) {
      return res.status(400).json({ success: false, error: 'ID da rodada inválido' });
    }
    
    const db = mongoose.connection.db;
    const objectId = new mongoose.Types.ObjectId(rodadaId);
    
    const rodada = await db.collection('rodadas').findOne({ 
      _id: objectId 
    });
    
    if (!rodada) {
      return res.status(404).json({ success: false, error: 'Rodada não encontrada' });
    }
    
    const participante = rodada.participantes?.find(
      p => p.usuario.toString() === req.usuarioId && p.cor === 'azul'
    );
    
    const indicadosNaRodada = rodada.participantes?.filter(
      p => p.indicadoPor?.toString() === req.usuarioId
    ).length || 0;
    
    res.json({
      success: true,
      data: {
        isAzul: !!participante,
        podeAdicionar: participante ? Math.max(0, 2 - indicadosNaRodada) : 0,
        jaAdicionou: indicadosNaRodada,
        limite: 2
      }
    });
  } catch (error) {
    console.error('❌ Erro em verificarPermissaoCaptacao:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Gerar link de convite
exports.gerarLinkConvite = async (req, res) => {
  try {
    const usuario = await User.findById(req.usuarioId);
    
    if (!usuario) {
      return res.status(404).json({ success: false, error: 'Usuário não encontrado' });
    }
    
    if (!usuario.codigoConvite) {
      usuario.codigoConvite = 'CONVITE-' + Math.random().toString(36).substring(2, 10).toUpperCase();
      await usuario.save();
    }
    
    const link = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/register?convite=${usuario.codigoConvite}`;
    
    res.json({
      success: true,
      data: {
        link,
        codigo: usuario.codigoConvite
      }
    });
  } catch (error) {
    console.error('❌ Erro em gerarLinkConvite:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Verificar se usuário tem rodada ativa
exports.verificarRodadaAtiva = async (req, res) => {
  try {
    const usuarioId = req.usuarioId;
    
    const db = mongoose.connection.db;
    const rodada = await db.collection('rodadas').findOne({
      status: 'aguardando',
      'participantes.usuario': usuarioId
    });
    
    res.json({
      success: true,
      data: {
        temRodada: !!rodada,
        rodada: rodada ? {
          id: rodada._id,
          nome: rodada.nome,
          participantes: rodada.participantes.length
        } : null
      }
    });
  } catch (error) {
    console.error('❌ Erro em verificarRodadaAtiva:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};