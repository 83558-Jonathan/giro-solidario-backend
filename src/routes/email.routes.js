const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const emailController = require('../controllers/emailController');
const validateObjectId = require('../middleware/validateObjectId');

router.use(authMiddleware);

router.post('/cobrar/:usuarioId', validateObjectId(['usuarioId']), emailController.cobrarUsuario);
router.post('/lembrete/:usuarioId', validateObjectId(['usuarioId']), emailController.enviarLembrete);
router.post('/cobrar-todos/:rodadaId', validateObjectId(['rodadaId']), emailController.cobrarTodosPendentes);
router.get('/cooldown/:usuarioId/:rodadaId', validateObjectId(['usuarioId', 'rodadaId']), emailController.verificarCooldown);
router.post('/teste-premio/:usuarioId', validateObjectId(['usuarioId']), emailController.notificarPremioVerde);

module.exports = router;