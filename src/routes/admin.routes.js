const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const authMiddleware = require('../middleware/authMiddleware');
const validateObjectId = require('../middleware/validateObjectId');

const adminOnly = (req, res, next) => {
  if (req.usuario && req.usuario.role === 'admin') {
    next();
  } else {
    res.status(403).json({ success: false, error: 'Acesso negado' });
  }
};

router.use(authMiddleware);
router.use(adminOnly);

router.get('/estatisticas', adminController.getEstatisticas);
router.get('/saques/pendentes', adminController.getSaquesPendentes);
router.get('/saques', adminController.getTodosSaques);
router.post('/saques/:id/aprovar', validateObjectId(['id']), adminController.aprovarSaque);
router.post('/saques/:id/recusar', validateObjectId(['id']), adminController.recusarSaque);
router.get('/rodadas/:id', validateObjectId(['id']), adminController.getRodadaDetalhes);

module.exports = router;