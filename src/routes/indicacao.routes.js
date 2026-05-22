const express = require('express');
const router = express.Router();
const indicacaoController = require('../controllers/indicacaoController');
const authMiddleware = require('../middleware/authMiddleware');
const validateObjectId = require('../middleware/validateObjectId');

router.use(authMiddleware);

router.get('/minhas', indicacaoController.minhasIndicacoes);
router.get('/meu-indicador', indicacaoController.meuIndicador);
router.get('/permissao/:rodadaId', validateObjectId(['rodadaId']), indicacaoController.verificarPermissaoCaptacao);
router.get('/gerar-link', indicacaoController.gerarLinkConvite);
router.get('/verificar-rodada', indicacaoController.verificarRodadaAtiva);

module.exports = router;