const express = require('express')
const router = express.Router()
const Transacao = require('../models/Transacao')
const Rodada = require('../models/Rodada')
const User = require('../models/User')
const abacate = require('../config/abacate')
const RodadaService = require('../services/rodadaService')
const pixController = require('../controllers/pixController')
const crypto = require('crypto')

// ===========================================
// CONFIGURAÇÕES DE SEGURANÇA
// ===========================================
const WEBHOOK_SECRET_HMAC = process.env.WEBHOOK_SECRET_HMAC
const WEBHOOK_SECRET_QUERY = process.env.WEBHOOK_SECRET_QUERY
const webhooksProcessados = new Map()

function extrairExternalId (event) {
  if (event.data?.pixQrCode?.metadata?.externalId)
    return event.data.pixQrCode.metadata.externalId
  if (event.data?.externalId) return event.data.externalId
  if (event.data?.metadata?.externalId) return event.data.metadata.externalId
  if (event.data?.checkout?.metadata?.externalId)
    return event.data.checkout.metadata.externalId
  if (event.data?.transparent?.metadata?.externalId)
    return event.data.transparent.metadata.externalId
  return null
}

router.post('/pix', async (req, res) => {
  try {
    // 1. VALIDAÇÃO HMAC (mais segura)
    if (WEBHOOK_SECRET_HMAC) {
      const signature = req.headers['x-signature']
      if (!signature) {
        console.error('❌ Webhook rejeitado: cabeçalho X-Signature ausente')
        return res.status(401).send('Unauthorized')
      }
      const payload = JSON.stringify(req.body)
      const expected = crypto
        .createHmac('sha256', WEBHOOK_SECRET_HMAC)
        .update(payload)
        .digest('hex')
      if (signature !== expected) {
        console.error('❌ Webhook rejeitado: assinatura HMAC inválida')
        return res.status(401).send('Unauthorized')
      }
    }

    // 2. VALIDAÇÃO DO SECRET VIA QUERY STRING (fallback)
    const querySecret = req.query.webhookSecret
    if (WEBHOOK_SECRET_QUERY && querySecret !== WEBHOOK_SECRET_QUERY) {
      console.error('❌ Webhook rejeitado: secret da URL inválido')
      return res.status(401).send('Unauthorized')
    }

    // 3. CONTROLE DE DUPLICIDADE (cache em memória)
    const webhookId = req.body.id || `${Date.now()}_${Math.random()}`
    if (webhooksProcessados.has(`webhook_${webhookId}`)) {
      console.log(`⚠️ Webhook ${webhookId} já foi processado. Ignorando.`)
      return res.status(200).send('Webhook já processado')
    }
    webhooksProcessados.set(`webhook_${webhookId}`, Date.now())
    setTimeout(() => {
      webhooksProcessados.delete(`webhook_${webhookId}`)
    }, 5 * 60 * 1000)

    // 4. LOG REDUZIDO (evita exposição de dados sensíveis)
    console.log(`📡 Webhook recebido: event=${req.body.event}, id=${webhookId}`)

    const event = req.body
    if (!event || !event.event) return res.status(400).send('Evento inválido')

    const externalId = extrairExternalId(event)
    if (!externalId) {
      console.log(`⏩ Evento ${event.event} sem externalId - ignorado`)
      return res.status(200).send('Evento ignorado')
    }

    console.log(
      `🔍 ExternalId extraído: ${externalId} do evento ${event.event}`
    )

    const eventosPagamento = [
      'billing.paid',
      'qr_code.paid',
      'checkout.completed',
      'transparent.completed'
    ]

    if (eventosPagamento.includes(event.event)) {
      const result = await pixController.processarPagamentoComControle(
        externalId,
        'webhook'
      )
      console.log(`📊 Resultado processamento: ${result.message}`)
      res.send('OK')
    } else {
      console.log(`⏩ Evento ignorado: ${event.event}`)
      res.status(200).send('Evento ignorado')
    }
  } catch (error) {
    console.error('❌ Erro no webhook PIX:', error)
    res.status(500).send('Erro interno')
  }
})

module.exports = router
