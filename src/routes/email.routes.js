const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const emailController = require('../controllers/emailController');

// Todas as rotas requerem autenticação
router.use(authMiddleware);

// Cobrar usuário específico
router.post('/cobrar/:usuarioId', emailController.cobrarUsuario);

// Enviar lembrete (mais suave)
router.post('/lembrete/:usuarioId', emailController.enviarLembrete);

// Cobrar todos pendentes da rodada
router.post('/cobrar-todos/:rodadaId', emailController.cobrarTodosPendentes);

// Verificar cooldown
router.get('/cooldown/:usuarioId/:rodadaId', emailController.verificarCooldown);

module.exports = router;