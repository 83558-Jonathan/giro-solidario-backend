const express = require('express')
const router = express.Router()
const authMiddleware = require('../middleware/authMiddleware')
const User = require('../models/User')

router.use(authMiddleware)

// Marca onboarding como concluído
router.post('/completar', async (req, res) => {
  try {
    await User.updateOne(
      { _id: req.usuarioId },
      { $set: { onboardingCompleto: true } }
    )
    res.json({ success: true })
  } catch (err) {
    console.error('❌ [onboarding/completar]', err.message)
    res.status(500).json({ success: false, error: 'Erro ao salvar' })
  }
})

// Reseta (útil pra testar)
router.post('/reset', async (req, res) => {
  try {
    await User.updateOne(
      { _id: req.usuarioId },
      { $set: { onboardingCompleto: false } }
    )
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ success: false, error: 'Erro ao resetar' })
  }
})

module.exports = router
