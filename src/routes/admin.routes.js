const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const authMiddleware = require('../middleware/authMiddleware');

// Middleware de admin simples
const adminOnly = (req, res, next) => {
  if (req.usuario && req.usuario.role === 'admin') {
    next();
  } else {
    res.status(403).json({ success: false, error: 'Acesso negado' });
  }
};

// Todas as rotas admin exigem autenticação
router.use(authMiddleware);
router.use(adminOnly);

// Estatísticas
router.get('/estatisticas', adminController.getEstatisticas);

// Saques
router.get('/saques/pendentes', adminController.getSaquesPendentes);
router.get('/saques', adminController.getTodosSaques);
router.post('/saques/:id/aprovar', adminController.aprovarSaque);
router.post('/saques/:id/recusar', adminController.recusarSaque);

// Rodadas (detalhadas para admin)
router.get('/rodadas/:id', adminController.getRodadaDetalhes);

module.exports = router;