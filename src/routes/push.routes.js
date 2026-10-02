const express = require('express')
const router = express.Router()
const authMiddleware = require('../middleware/authMiddleware')
const Subscription = require('../models/Subscription')

router.use(authMiddleware)

// Retorna a chave pública VAPID pro frontend
router.get('/vapid-public-key', (req, res) => {
  const key = process.env.VAPID_PUBLIC_KEY
  if (!key) {
    return res.status(503).json({
      success: false,
      error: 'Push não configurado no servidor'
    })
  }
  res.json({ success: true, publicKey: key })
})

// Salva subscription (upsert pelo endpoint)
router.post('/subscribe', async (req, res) => {
  try {
    const { endpoint, keys } = req.body
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({
        success: false,
        error: 'Subscription inválida'
      })
    }

    await Subscription.findOneAndUpdate(
      { endpoint },
      {
        usuario: req.usuarioId,
        endpoint,
        keys: { p256dh: keys.p256dh, auth: keys.auth },
        userAgent: req.headers['user-agent'] || null,
        lastUsedAt: new Date()
      },
      { upsert: true, new: true }
    )

    res.json({ success: true })
  } catch (err) {
    console.error('❌ [push/subscribe]', err.message)
    res.status(500).json({ success: false, error: 'Erro ao salvar subscription' })
  }
})

// Remove subscription do usuário
router.delete('/unsubscribe', async (req, res) => {
  try {
    const { endpoint } = req.body
    if (endpoint) {
      await Subscription.deleteOne({ endpoint, usuario: req.usuarioId })
    } else {
      await Subscription.deleteMany({ usuario: req.usuarioId })
    }
    res.json({ success: true })
  } catch (err) {
    console.error('❌ [push/unsubscribe]', err.message)
    res.status(500).json({ success: false, error: 'Erro ao remover subscription' })
  }
})

module.exports = router