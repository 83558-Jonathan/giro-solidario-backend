// ===========================================
// utils/qrCodeHelper.js — Migrado para AbacatePay V2
// ===========================================
const { abacateV2 } = require('../config/abacate')
const { VALOR_VERMELHO } = require('../config/constantes')
const Transacao = require('../models/Transacao')
const User = require('../models/User')
const emailController = require('../controllers/emailController')

async function gerarQrCodeParaTransacao (transacaoId) {
  const transacao = await Transacao.findById(transacaoId)
    .populate('pagador', 'nome email cpf')
    .populate('rodada', 'nome')
  if (!transacao) throw new Error('Transação não encontrada')
  if (transacao.status !== 'pendente') return

  const valorCentavos = Math.round(VALOR_VERMELHO * 100)

  const payload = {
    method: 'PIX',
    data: {
      amount: valorCentavos,
      description: `Giro Premiado - ${transacao.pagador?.nome || 'Usuário'}`,
      expiresIn: 3600,
      externalId: transacao._id.toString()
    }
  }

  console.log(
    `📤 [qrCodeHelper] Gerando PIX V2 para transação ${transacao._id} (R$ ${VALOR_VERMELHO})`
  )

  let response
  try {
    response = await abacateV2.post('/v2/transparents/create', payload)
  } catch (error) {
    const status = error.response?.status
    const apiError = error.response?.data?.error || error.message
    console.error('❌ [qrCodeHelper] Falha ao gerar QR Code (V2):', {
      status,
      apiError
    })
    throw new Error(`AbacatePay V2: ${apiError}`)
  }

  const {
    id: cobrancaId,
    brCode,
    brCodeBase64,
    expiresAt
  } = response.data.data || {}

  if (!cobrancaId || !brCode) {
    console.error(
      '❌ [qrCodeHelper] Resposta V2 sem cobrancaId ou brCode:',
      response.data
    )
    throw new Error('Resposta da AbacatePay sem dados de cobrança')
  }

  transacao.cobrancaId = cobrancaId
  transacao.valorPago = VALOR_VERMELHO
  transacao.metadata = {
    ...(transacao.metadata || {}),
    cobrancaCriadaEm: new Date().toISOString(),
    expiraEm: expiresAt,
    tipo: 'pix_transparent_v2',
    renovacoes: 0,
    valorOriginal: VALOR_VERMELHO,
    qrCode: brCode,
    qrCodeImage: brCodeBase64
  }
  await transacao.save()

  console.log(
    `✅ [qrCodeHelper] QR Code gerado. cobrancaId=${cobrancaId}, expira em ${expiresAt}`
  )

  try {
    const usuario = await User.findById(transacao.pagador._id)
    if (
      usuario?.email &&
      typeof emailController.enviarEmailQrCodePix === 'function'
    ) {
      await emailController.enviarEmailQrCodePix(
        usuario,
        transacao,
        brCode,
        brCodeBase64,
        VALOR_VERMELHO,
        transacao.rodada
      )
      console.log(
        `📧 [qrCodeHelper] Email com QR enviado para ${usuario.email}`
      )
    }
  } catch (emailError) {
    console.error(
      '❌ [qrCodeHelper] Erro ao enviar email com QR:',
      emailError.message
    )
  }
}

module.exports = { gerarQrCodeParaTransacao }
