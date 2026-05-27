const { abacateV1 } = require('../config/abacate')
const Transacao = require('../models/Transacao')
const User = require('../models/User')
const emailController = require('../controllers/emailController')

const VALOR_VERMELHO = 150

async function gerarQrCodeParaTransacao (transacaoId) {
  const transacao = await Transacao.findById(transacaoId)
    .populate('pagador', 'nome email')
    .populate('rodada', 'nome')
  if (!transacao) throw new Error('Transação não encontrada')
  if (transacao.status !== 'pendente') return

  const valorCentavos = Math.round(VALOR_VERMELHO * 100)
  const payload = {
    amount: valorCentavos,
    description: `Giro Premiado - ${transacao.pagador.nome}`,
    expiresIn: 3600,
    metadata: { externalId: transacao._id.toString() }
  }
  const response = await abacateV1.post('/v1/pixQrCode/create', payload)
  const { id: cobrancaId, brCode, brCodeBase64, expiresAt } = response.data.data

  transacao.cobrancaId = cobrancaId
  transacao.valorPago = VALOR_VERMELHO
  transacao.metadata = {
    ...(transacao.metadata || {}),
    cobrancaCriadaEm: new Date().toISOString(),
    expiraEm: expiresAt,
    tipo: 'pix_qrcode_v1',
    renovacoes: 0,
    valorOriginal: VALOR_VERMELHO,
    qrCode: brCode,
    qrCodeImage: brCodeBase64
  }
  await transacao.save()

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
    }
  } catch (emailError) {
    console.error('Erro ao enviar email com QR:', emailError.message)
  }
}

module.exports = { gerarQrCodeParaTransacao }
