const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const rodadaController = require('../controllers/rodadaController');

// Todas as rotas requerem autenticação
router.use(authMiddleware);

// LISTAR todas as rodadas
router.get('/', rodadaController.listarRodadas);

// CRIAR nova rodada
router.post('/', rodadaController.criarRodada);

// BUSCAR rodada por ID
router.get('/:id', rodadaController.buscarRodadaPorId);

// ADICIONAR participante
router.post('/:rodadaId/participantes', rodadaController.adicionarParticipante);

// VER MANDALA com nomes
router.get('/:rodadaId/mandala', rodadaController.getMandala);

// INICIAR rodada (forçar início - para testes)
router.post('/:rodadaId/iniciar', rodadaController.iniciarRodada);

// Sacar prêmio do verde
router.post('/:rodadaId/sacar-premio', rodadaController.sacarPremio);

// Jogar novamente
router.post('/jogar-novamente', rodadaController.jogarNovamente);

// Forçar alocação da fila (admin)
router.post('/admin/forcar-alocacao-fila', rodadaController.forcarAlocacaoFila);

module.exports = router;