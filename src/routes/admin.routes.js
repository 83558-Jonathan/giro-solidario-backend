const express = require('express')
const router = express.Router()
const adminController = require('../controllers/adminController')
const authMiddleware = require('../middleware/authMiddleware')
const validateObjectId = require('../middleware/validateObjectId')

const adminOnly = (req, res, next) => {
  if (req.usuario && req.usuario.role === 'admin') {
    next()
  } else {
    res.status(403).json({ success: false, error: 'Acesso negado' })
  }
}

router.use(authMiddleware)
router.use(adminOnly)

// ===========================================
// ESTATÍSTICAS
// ===========================================
router.get('/estatisticas', adminController.getEstatisticas)

// ===========================================
// SAQUES
// ===========================================
router.get('/saques/pendentes', adminController.getSaquesPendentes)
router.get('/saques', adminController.getTodosSaques)
router.post(
  '/saques/:id/aprovar',
  validateObjectId(['id']),
  adminController.aprovarSaque
)
router.post(
  '/saques/:id/recusar',
  validateObjectId(['id']),
  adminController.recusarSaque
)

// ===========================================
// RODADAS
// ===========================================
router.get(
  '/rodadas/:id',
  validateObjectId(['id']),
  adminController.getRodadaDetalhes
)

// ===========================================
// USUÁRIOS
// ===========================================
router.get('/usuarios', adminController.getUsuariosCompletos)
router.get(
  '/usuarios/:id',
  validateObjectId(['id']),
  adminController.getUsuarioDetalhe
)

// marcar/desmarcar influenciador
router.patch(
  '/usuarios/:id/influenciador',
  validateObjectId(['id']),
  adminController.setInfluenciador
)

// comissões do usuário
router.get(
  '/usuarios/:id/comissoes',
  validateObjectId(['id']),
  adminController.getComissoesUsuario
)

// ===========================================
// COMISSÕES (geral)
// ===========================================
router.get('/comissoes', adminController.getComissoes)

module.exports = router
