const express = require('express');
const router = express.Router();
const pixController = require('../controllers/pixController');
const authMiddleware = require('../middleware/authMiddleware');

// Todas as rotas de PIX requerem autenticação
router.use(authMiddleware);

// Criar cobrança PIX para uma transação
router.post('/criar-cobranca', pixController.criarCobrancaPix);

// Verificar status de uma transação
router.get('/status/:transacaoId', pixController.verificarStatus);

router.post('/renovar-cobranca', authMiddleware, pixController.renovarCobrancaPix);

module.exports = router;