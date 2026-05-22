const express = require('express');
const router = express.Router();
const transacaoController = require('../controllers/transacaoController');
const authMiddleware = require('../middleware/authMiddleware');
const validateObjectId = require('../middleware/validateObjectId');

router.use(authMiddleware);

router.get('/minhas', transacaoController.minhasTransacoes);
router.get('/estatisticas', transacaoController.estatisticas);
router.get('/rodada/:rodadaId', validateObjectId(['rodadaId']), transacaoController.porRodada);
router.post('/:transacaoId/confirmar', validateObjectId(['transacaoId']), transacaoController.confirmarDeposito);
router.post('/:transacaoId/cancelar', validateObjectId(['transacaoId']), transacaoController.cancelarTransacao);
router.get('/:id', validateObjectId(['id']), transacaoController.buscarTransacaoPorId);

module.exports = router;