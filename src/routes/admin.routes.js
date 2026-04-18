const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const adminController = require('../controllers/adminController');
const User = require('../models/User');

// Verificar se é admin
const isAdmin = async (req, res, next) => {
    try {
        const user = await User.findById(req.usuarioId);
        if (user.role !== 'admin') {
            return res.status(403).json({ success: false, error: 'Acesso negado. Área restrita para administradores.' });
        }
        next();
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// Todas as rotas admin requerem autenticação e role admin
router.use(authMiddleware);
router.use(isAdmin);

// Dashboard / Estatísticas
router.get('/estatisticas', adminController.estatisticas);

// Solicitações de saque
router.get('/saques/pendentes', adminController.listarSolicitacoesPendentes);
router.get('/saques', adminController.listarTodasSolicitacoes);
router.post('/saques/:solicitacaoId/aprovar', adminController.aprovarSaque);
router.post('/saques/:solicitacaoId/recusar', adminController.recusarSaque);
router.post('/saques/:solicitacaoId/pago', adminController.marcarComoPago);

module.exports = router;