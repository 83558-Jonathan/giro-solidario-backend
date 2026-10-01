const express = require('express')
const router = express.Router()
const crypto = require('crypto')
const pixController = require('../controllers/pixController')

const WEBHOOK_SECRET_HMAC = process.env.WEBHOOK_SECRET_HMAC
const WEBHOOK_SECRET_QUERY = process.env.WEBHOOK_SECRET_QUERY // fallback opcional

const webhooksProcessados = new Map()

// ===========================================
// EXTRAI EXTERNALID DE DIFERENTES FORMATOS DE PAYLOAD
// ===========================================
function extrairExternalId (event) {
  if (!event || !event.data) return null
  const d = event.data

  // Formato V2 transparent (transparent.completed)
  if (d.externalId) return d.externalId
  if (d.transparent?.externalId) return d.transparent.externalId
  if (d.transparent?.metadata?.externalId)
    return d.transparent.metadata.externalId

  // Formatos antigos / alternativos
  if (d.metadata?.externalId) return d.metadata.externalId
  if (d.pixQrCode?.metadata?.externalId) return d.pixQrCode.metadata.externalId
  if (d.checkout?.metadata?.externalId) return d.checkout.metadata.externalId

  return null
}

// ===========================================
// VALIDA ASSINATURA (opcional em dev)
// ===========================================
function validarAssinatura (req) {
  // Se não tem secret configurado, pula (modo dev)
  if (!WEBHOOK_SECRET_HMAC) {
    console.warn(
      '⚠️ [WEBHOOK] WEBHOOK_SECRET_HMAC não configurado — validação HMAC ignorada (DEV)'
    )
    return { valido: true, motivo: 'sem_secret_dev' }
  }

  // Aceita header em diferentes nomes (AbacatePay usa X-Webhook-Signature na V2)
  const signature =
    req.headers['x-webhook-signature'] ||
    req.headers['x-signature'] ||
    req.headers['x-hub-signature']

  if (!signature) {
    return {
      valido: false,
      motivo: 'header_assinatura_ausente',
      headersRecebidos: Object.keys(req.headers).filter(h => h.includes('sign'))
    }
  }

  const payload = JSON.stringify(req.body)
  const expected = crypto
    .createHmac('sha256', WEBHOOK_SECRET_HMAC)
    .update(payload)
    .digest('hex')

  // Normaliza: pode vir em base64 ou hex, com/sem prefixo "sha256="
  const sigLimpa = signature.replace(/^sha256=/, '').trim()
  const ok =
    sigLimpa === expected ||
    sigLimpa ===
      crypto
        .createHmac('sha256', WEBHOOK_SECRET_HMAC)
        .update(payload)
        .digest('base64')

  return { valido: ok, motivo: ok ? 'ok' : 'assinatura_invalida' }
}

// ===========================================
// WEBHOOK PIX
// ===========================================
router.post('/pix', async (req, res) => {
  try {
    // 1. Validação HMAC (opcional se WEBHOOK_SECRET_HMAC não estiver configurado)
    const assinatura = validarAssinatura(req)
    if (!assinatura.valido) {
      console.error(
        `❌ [WEBHOOK] Rejeitado: ${assinatura.motivo}`,
        assinatura.headersRecebidos || ''
      )
      return res.status(401).send('Unauthorized')
    }

    // 2. Validação do secret via query string (fallback opcional)
    const querySecret = req.query.webhookSecret
    if (WEBHOOK_SECRET_QUERY && querySecret !== WEBHOOK_SECRET_QUERY) {
      console.error('❌ [WEBHOOK] Rejeitado: secret da URL inválido')
      return res.status(401).send('Unauthorized')
    }

    // 3. Controle de duplicidade (cache em memória)
    const webhookId =
      req.body?.id || req.body?.data?.id || `${Date.now()}_${Math.random()}`
    const cacheKey = `webhook_${webhookId}`
    if (webhooksProcessados.has(cacheKey)) {
      console.log(`⚠️ [WEBHOOK] ${webhookId} já foi processado. Ignorando.`)
      return res.status(200).send('Webhook já processado')
    }
    webhooksProcessados.set(cacheKey, Date.now())
    setTimeout(() => webhooksProcessados.delete(cacheKey), 5 * 60 * 1000)

    // 4. Log estruturado do evento recebido
    const event = req.body
    const eventName = event?.event || event?.type || 'desconhecido'
    console.log(
      `📡 [WEBHOOK] Recebido: event=${eventName}, id=${webhookId}, status=${
        event?.data?.status || 'n/a'
      }`
    )
    if (process.env.NODE_ENV === 'development') {
      console.log(
        '📦 Payload completo:',
        JSON.stringify(event, null, 2).substring(0, 2000)
      )
    }

    if (!event || (!event.event && !event.type)) {
      console.warn(
        '⚠️ [WEBHOOK] Payload sem campo `event` ou `type`. Ignorando.'
      )
      return res.status(200).send('Evento inválido')
    }

    // 5. Extração do externalId (nosso transacao._id)
    const externalId = extrairExternalId(event)
    if (!externalId) {
      console.log(`⏩ [WEBHOOK] Evento ${eventName} sem externalId - ignorado`)
      return res.status(200).send('Evento sem externalId')
    }

    console.log(`🔍 [WEBHOOK] externalId extraído: ${externalId}`)

    // 6. Processa apenas eventos de pagamento confirmado
    const eventosPagamento = [
      'transparent.completed',
      'billing.paid',
      'qr_code.paid',
      'checkout.completed'
    ]

    // Também aceita quando o status do data indica pago, mesmo se o evento não bater
    const statusPago =
      event.data?.status?.toUpperCase?.() === 'PAID' ||
      event.data?.status === 'paid'

    if (eventosPagamento.includes(eventName) || statusPago) {
      console.log(
        `💰 [WEBHOOK] Processando pagamento para transação ${externalId}`
      )
      const result = await pixController.processarPagamentoComControle(
        externalId,
        'webhook'
      )
      console.log(`📊 [WEBHOOK] Resultado: ${result.message}`)
      return res.status(200).send('OK')
    }

    console.log(
      `⏩ [WEBHOOK] Evento ${eventName} ignorado (não é de pagamento)`
    )
    return res.status(200).send('Evento ignorado')
  } catch (error) {
    console.error('❌ [WEBHOOK] Erro no processamento:', error)
    // Retorna 200 para a AbacatePay não ficar retentando infinitamente
    // Se quiser retry, retorne 500
    return res.status(200).send('Erro interno (não retentar)')
  }
})

module.exports = router
