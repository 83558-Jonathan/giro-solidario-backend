const express = require('express');
const router = express.Router();
const solicitacaoController = require('../controllers/solicitacaoController');
const authMiddleware = require('../middleware/authMiddleware');

router.use(authMiddleware);
router.get('/minhas', solicitacaoController.getMinhasSolicitacoes);

module.exports = router;