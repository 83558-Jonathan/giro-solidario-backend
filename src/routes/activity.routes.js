const express = require('express')
const router = express.Router()
const authMiddleware = require('../middleware/authMiddleware')
const ActivityLog = require('../models/ActivityLog')

// Público — usado na landing page como prova social ao vivo
router.get('/publico/recentes', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 15, 30)
    const atividades = await ActivityLog.find({})
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('tipo nomeExibicao mensagem createdAt metadata')
      .lean()

    // Remove dados sensíveis, mantém apenas o mínimo
    const sanitizadas = atividades.map(a => ({
      tipo: a.tipo,
      nomeExibicao: a.nomeExibicao,
      mensagem: a.mensagem,
      createdAt: a.createdAt
    }))

    res.json({ success: true, data: sanitizadas })
  } catch (err) {
    console.error('[activity/publico]', err.message)
    res.status(500).json({ success: false, error: 'Erro ao carregar' })
  }
})

router.use(authMiddleware)

// Últimas 10 atividades globais
router.get('/recentes', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 30)
    const atividades = await ActivityLog.find({})
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()

    res.json({ success: true, data: atividades })
  } catch (err) {
    console.error('❌ [activity/recentes]', err.message)
    res.status(500).json({ success: false, error: 'Erro ao carregar atividades' })
  }
})

module.exports = router