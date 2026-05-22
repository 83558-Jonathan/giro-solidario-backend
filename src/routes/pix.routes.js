const express = require('express');
const router = express.Router();
const pixController = require('../controllers/pixController');
const authMiddleware = require('../middleware/authMiddleware');
const validateObjectId = require('../middleware/validateObjectId');

router.use(authMiddleware);

router.post('/criar-cobranca', pixController.criarCobrancaPix);
router.get('/status/:transacaoId', validateObjectId(['transacaoId']), pixController.verificarStatus);
router.post('/renovar-cobranca', pixController.renovarCobrancaPix);
router.post('/cancelar-expirado', pixController.cancelarExpirado);

module.exports = router;