// src/routes/solicitacao.routes.js
const express = require('express');
const router = express.Router();
const solicitacaoController = require('../controllers/solicitacaoController');
const authMiddleware = require('../middleware/authMiddleware');

// Todas as rotas exigem autenticação
router.use(authMiddleware);

// Buscar solicitações do usuário logado
router.get('/minhas', solicitacaoController.getMinhasSolicitacoes);

module.exports = router;