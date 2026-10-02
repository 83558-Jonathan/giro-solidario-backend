const express = require('express')
const router = express.Router()
const authMiddleware = require('../middleware/authMiddleware')
const ActivityLog = require('../models/ActivityLog')

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