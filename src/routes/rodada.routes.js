const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const rodadaController = require('../controllers/rodadaController');
const validateObjectId = require('../middleware/validateObjectId');

router.use(authMiddleware);

router.get('/', rodadaController.listarRodadas);
router.post('/', rodadaController.criarRodada);
router.get('/:id', validateObjectId(['id']), rodadaController.buscarRodadaPorId);
router.post('/:rodadaId/participantes', validateObjectId(['rodadaId']), rodadaController.adicionarParticipante);
router.get('/:rodadaId/mandala', validateObjectId(['rodadaId']), rodadaController.getMandala);
router.post('/:rodadaId/iniciar', validateObjectId(['rodadaId']), rodadaController.iniciarRodada);
router.post('/:rodadaId/sacar-premio', validateObjectId(['rodadaId']), rodadaController.sacarPremio);
router.post('/jogar-novamente', rodadaController.jogarNovamente);
router.post('/admin/forcar-alocacao-fila', rodadaController.forcarAlocacaoFila);

module.exports = router;