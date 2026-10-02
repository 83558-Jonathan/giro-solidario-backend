const express = require('express')
const router = express.Router()
const authMiddleware = require('../middleware/authMiddleware')
const validateObjectId = require('../middleware/validateObjectId')
const Notificacao = require('../models/Notificacao')

router.use(authMiddleware)

// Lista + contador de não lidas
router.get('/minhas', async (req, res) => {
  try {
    const [notifs, naoLidas] = await Promise.all([
      Notificacao.find({ usuario: req.usuarioId })
        .sort({ createdAt: -1 })
        .limit(50)
        .lean(),
      Notificacao.countDocuments({ usuario: req.usuarioId, lida: false })
    ])

    res.json({
      success: true,
      naoLidas,
      data: notifs
    })
  } catch (err) {
    console.error('❌ [notificacoes/minhas]', err.message)
    res.status(500).json({ success: false, error: 'Erro ao carregar notificações' })
  }
})

// Marca uma como lida
router.put('/:id/ler', validateObjectId(['id']), async (req, res) => {
  try {
    await Notificacao.updateOne(
      { _id: req.params.id, usuario: req.usuarioId },
      { $set: { lida: true } }
    )
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ success: false, error: 'Erro ao marcar como lida' })
  }
})

// Marca todas como lidas
router.put('/ler-todas', async (req, res) => {
  try {
    await Notificacao.updateMany(
      { usuario: req.usuarioId, lida: false },
      { $set: { lida: true } }
    )
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ success: false, error: 'Erro ao marcar todas' })
  }
})

module.exports = router