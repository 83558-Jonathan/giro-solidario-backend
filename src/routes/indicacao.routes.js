const express = require('express');
const router = express.Router();
const indicacaoController = require('../controllers/indicacaoController');
const authMiddleware = require('../middleware/authMiddleware');

// Todas as rotas requerem autenticação
router.use(authMiddleware);

// Minhas indicações
router.get('/minhas', indicacaoController.minhasIndicacoes);

// Quem me indicou
router.get('/meu-indicador', indicacaoController.meuIndicador);

// Verificar permissão de captação
router.get('/permissao/:rodadaId', indicacaoController.verificarPermissaoCaptacao);

// Gerar link de convite
router.get('/gerar-link', indicacaoController.gerarLinkConvite);

// Verificar se tem rodada ativa
router.get('/verificar-rodada', indicacaoController.verificarRodadaAtiva);

module.exports = router;