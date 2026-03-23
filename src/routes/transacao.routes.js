const express = require('express');
const router = express.Router();
const transacaoController = require('../controllers/transacaoController');
const authMiddleware = require('../middleware/authMiddleware');

// Todas as rotas requerem autenticação
router.use(authMiddleware);

// Minhas transações
router.get('/minhas', transacaoController.minhasTransacoes);

// Estatísticas de transações
router.get('/estatisticas', transacaoController.estatisticas);

// Transações de uma rodada
router.get('/rodada/:rodadaId', transacaoController.porRodada);

// Confirmar depósito
router.post('/:transacaoId/confirmar', transacaoController.confirmarDeposito);

// Cancelar transação
router.post('/:transacaoId/cancelar', transacaoController.cancelarTransacao);

module.exports = router;