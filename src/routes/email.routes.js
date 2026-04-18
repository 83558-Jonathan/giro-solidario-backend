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

// Rota para testar notificação de prêmio (opcional - pode ser removida em produção)
router.post('/teste-premio/:usuarioId', async (req, res) => {
    try {
        const { usuarioId } = req.params;
        const { rodadaId, valor } = req.body;

        if (!rodadaId) {
            return res.status(400).json({ success: false, error: 'rodadaId é obrigatório' });
        }

        await emailController.notificarPremioVerde(usuarioId, rodadaId, valor || 900);
        res.json({ success: true, message: 'Email de teste enviado com sucesso' });
    } catch (error) {
        console.error('❌ Erro ao enviar email de teste:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;