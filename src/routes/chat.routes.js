const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const ChatMessage = require('../models/ChatMessage');
const Rodada = require('../models/Rodada');
const validateObjectId = require('../middleware/validateObjectId');

router.get('/historico/:rodadaId', authMiddleware, validateObjectId(['rodadaId']), async (req, res) => {
  try {
    const { rodadaId } = req.params;
    const usuarioId = req.usuario.id;

    const rodada = await Rodada.findById(rodadaId);
    if (!rodada) return res.status(404).json({ error: 'Rodada não encontrada' });

    const isParticipante = rodada.participantes.some(p => p.usuario.toString() === usuarioId);
    if (!isParticipante) return res.status(403).json({ error: 'Acesso negado' });

    const mensagens = await ChatMessage.find({ rodadaId }).sort({ createdAt: 1 }).limit(100);
    res.json(mensagens);
  } catch (error) {
    console.error('Erro ao buscar histórico:', error);
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;