// ===========================================
// pixController.js — Migrado 100% para AbacatePay V2
// ===========================================
const { abacateV2 } = require('../config/abacate')
const Transacao = require('../models/Transacao')
const Rodada = require('../models/Rodada')
const User = require('../models/User')
const ChatMessage = require('../models/ChatMessage')

// NOVO: serviços de engajamento
const pushService = require('../services/pushService')
const activityService = require('../services/activityService')
const notificationService = require('../services/notificationService')
const badgeService = require('../services/badgeService')

let io = null
let rodadaServiceInstance = null

function initializeIo (socketIo) {
  io = socketIo
  console.log('io inicializado no pixController')
}

function setRodadaService (service) {
  rodadaServiceInstance = service
  console.log('RodadaService injetado no pixController')
}

const { VALOR_VERMELHO, TAXA_PIX } = require('../config/constantes')
const pagamentosProcessados = new Map()

function montarPayloadPixV2 (transacao) {
  const valorCentavos = Math.round(VALOR_VERMELHO * 100)
  return {
    method: 'PIX',
    data: {
      amount: valorCentavos,
      description: `Giro Premiado - ${transacao.pagador?.nome || 'Usuário'}`,
      expiresIn: 3600,
      externalId: transacao._id.toString()
    }
  }
}

async function consultarStatusTransparenteV2 (cobrancaId) {
  const response = await abacateV2.get('/v2/transparents/check', {
    params: { id: cobrancaId }
  })
  return response.data?.data
}

// ===========================================
// AUXILIAR: processar pagamento com controle de duplicidade
// ===========================================
async function processarPagamentoComControle (transacaoId, source = 'webhook') {
  if (pagamentosProcessados.has(transacaoId)) {
    const processadoEm = pagamentosProcessados.get(transacaoId)
    const segundosDesdeProcessamento = (Date.now() - processadoEm) / 1000
    console.log(
      `⚠️ [${source}] Pagamento ${transacaoId} já foi processado há ${segundosDesdeProcessamento.toFixed(
        1
      )}s. Ignorando.`
    )
    return {
      success: false,
      message: 'Pagamento já processado',
      jaProcessado: true
    }
  }

  pagamentosProcessados.set(transacaoId, Date.now())

  try {
    const transacao = await Transacao.findById(transacaoId)
    if (!transacao) {
      console.error(`❌ [${source}] Transação não encontrada: ${transacaoId}`)
      pagamentosProcessados.delete(transacaoId)
      return { success: false, message: 'Transação não encontrada' }
    }

    if (
      transacao.status === 'cancelada_expirada' ||
      transacao.status === 'cancelado'
    ) {
      console.log(
        `⚠️ [${source}] Transação ${transacaoId} está com status ${transacao.status}.`
      )
      pagamentosProcessados.delete(transacaoId)
      return { success: false, message: 'Transação expirada ou cancelada' }
    }

    if (transacao.status === 'confirmado') {
      console.log(
        `⚠️ [${source}] Transação ${transacaoId} já estava confirmada. Ignorando.`
      )
      pagamentosProcessados.delete(transacaoId)
      return {
        success: true,
        message: 'Transação já confirmada',
        jaProcessado: true
      }
    }

    console.log(
      `💰 [${source}] Processando pagamento para transação: ${transacaoId}`
    )

    transacao.status = 'confirmado'
    transacao.dataConfirmacao = new Date()
    await transacao.save()

    const rodada = await Rodada.findById(transacao.rodada)
    if (!rodada) {
      console.error(`❌ [${source}] Rodada não encontrada: ${transacao.rodada}`)
      pagamentosProcessados.delete(transacaoId)
      return { success: false, message: 'Rodada não encontrada' }
    }

    const participante = rodada.participantes.find(
      p => p.usuario.toString() === transacao.pagador.toString()
    )
    if (!participante) {
      console.error(`❌ [${source}] Participante não encontrado na rodada`)
      pagamentosProcessados.delete(transacaoId)
      return { success: false, message: 'Participante não encontrado' }
    }

    if (participante.depositoConfirmado === true) {
      console.log(
        `⚠️ [${source}] Participante já estava marcado como pago. Ignorando.`
      )
      pagamentosProcessados.delete(transacaoId)
      return {
        success: true,
        message: 'Participante já pago',
        jaProcessado: true
      }
    }

    participante.depositoConfirmado = true
    participante.dataDeposito = new Date()

    const usuarioPagador = await User.findById(transacao.pagador)
    const nomePagador = usuarioPagador ? usuarioPagador.nome : 'Alguém'

    const vermelhos = rodada.participantes.filter(p => p.cor === 'vermelho')
    const pagos = vermelhos.filter(v => v.depositoConfirmado === true)
    const faltam = vermelhos.length - pagos.length

    if (io) {
      io.to(`rodada-${rodada._id}`).emit('pagamento-confirmado', {
        transacaoId: transacao._id,
        participanteId: transacao.pagador,
        faltam,
        totalVermelhos: vermelhos.length,
        pagos: pagos.length
      })
    }

    if (io) {
      const mensagemPagamento = new ChatMessage({
        rodadaId: rodada._id,
        mensagem: `${nomePagador} realizou o pagamento! Faltam ${faltam} pagamento(s) para a rodada avançar.`,
        tipo: 'sistema',
        acao: 'pagamento_confirmado',
        createdAt: new Date()
      })
      await mensagemPagamento.save()
      io.to(`rodada-${rodada._id}`).emit('mensagem', {
        _id: mensagemPagamento._id,
        mensagem: mensagemPagamento.mensagem,
        tipo: 'sistema',
        acao: 'pagamento_confirmado',
        createdAt: mensagemPagamento.createdAt
      })
    }

    rodada.totalDepositosConfirmados = pagos.length
    await rodada.save()

    const usuario = await User.findById(transacao.pagador)
    if (usuario && usuario.aguardandoVermelho) {
      usuario.aguardandoVermelho = false
      usuario.posicaoFila = null
      usuario.dataEntradaFila = null
      usuario.rodadaBloqueada = null
      await usuario.save()
      console.log(
        `[${source}] Usuário ${usuario.nome} removido da fila após pagamento`
      )
    }

    console.log(
      `[${source}] Participante ${participante.usuario} marcado como pago`
    )
    console.log(`📊 [${source}] Progresso: ${pagos.length}/${vermelhos.length}`)

    // ===========================================
    // NOVO: BADGES
    // ===========================================
    if (usuario) {
      const tempoDesdeEntrada = participante.dataEntrada
        ? Date.now() - new Date(participante.dataEntrada).getTime()
        : null
      badgeService
        .verificarAposPagamento(usuario._id, tempoDesdeEntrada)
        .catch(err => console.error('❌ [badge]', err.message))
    }

    // ===========================================
    // NOVO: ACTIVITY LOG (feed global)
    // ===========================================
    if (usuario) {
      activityService
        .pagamento(usuario._id, usuario.nome, rodada._id, VALOR_VERMELHO)
        .catch(err => console.error('❌ [activity]', err.message))
    }

    // ===========================================
    // NOVO: PUSH + NOTIFICAÇÃO para outros vermelhos (faltam pagar)
    // ===========================================
    const outrosVermelhos = vermelhos.filter(
      v =>
        !v.depositoConfirmado &&
        v.usuario.toString() !== transacao.pagador.toString()
    )
    if (outrosVermelhos.length && faltam > 0 && faltam <= 3) {
      const payload = pushService.templates.pagamentoConfirmado(
        nomePagador.split(' ')[0],
        faltam,
        vermelhos.length
      )
      const ids = outrosVermelhos.map(v => v.usuario)
      pushService
        .enviarParaUsuarios(ids, payload)
        .catch(err => console.error('❌ [push]', err.message))

      // Também cria notificação in-app pra cada um
      for (const ov of outrosVermelhos) {
        notificationService
          .pagamentoConfirmado(ov.usuario, nomePagador.split(' ')[0])
          .catch(() => {})
      }
    }

    // Se todos pagaram, avisa todos os participantes
    if (pagos.length === vermelhos.length && vermelhos.length === 8) {
      console.log(`🎉 [${source}] TODOS OS 8 VERMELHOS PAGARAM!`)

      // NOVO: push pra todos da rodada
      const todosIds = rodada.participantes.map(p => p.usuario)
      pushService
        .enviarParaUsuarios(todosIds, pushService.templates.rodadaVaiAvancar())
        .catch(() => {})

      if (!rodada.todosDepositaram) {
        rodada.todosDepositaram = true
        rodada.dataTodosDepositaram = new Date()
        await rodada.save()
      }

      try {
        if (rodadaServiceInstance) {
          await rodadaServiceInstance.avancarRodada(rodada._id)
        } else {
          console.error(`❌ [${source}] RodadaService não injetado!`)
        }
        if (io) {
          io.to(`rodada-${rodada._id}`).emit('rodada-atualizada', {
            rodadaId: rodada._id,
            status: 'concluida'
          })
        }
        console.log(
          `[${source}] Rodada ${rodada.nome} avançada com sucesso!`
        )
      } catch (err) {
        console.error(`❌ [${source}] Erro ao avançar rodada:`, err)
      }
    }

    setTimeout(() => {
      pagamentosProcessados.delete(transacaoId)
      console.log(
        `🧹 [${source}] Cache do pagamento ${transacaoId} removido após 10 minutos`
      )
    }, 10 * 60 * 1000)

    return {
      success: true,
      message: 'Pagamento processado',
      progresso: `${pagos.length}/${vermelhos.length}`
    }
  } catch (error) {
    console.error(
      `❌ [${source}] Erro ao processar pagamento ${transacaoId}:`,
      error
    )
    pagamentosProcessados.delete(transacaoId)
    throw error
  }
}

// ===========================================
// CRIAR COBRANÇA PIX (V2) — igual, sem mudanças
// ===========================================
const criarCobrancaPix = async (req, res) => {
  try {
    const { transacaoId } = req.body
    if (!transacaoId)
      return res
        .status(400)
        .json({ success: false, error: 'transacaoId é obrigatório' })

    const transacao = await Transacao.findById(transacaoId)
      .populate('pagador', 'nome email cpf')
      .populate('rodada', 'nome')
    if (!transacao)
      return res
        .status(404)
        .json({ success: false, error: 'Transação não encontrada' })
    if (transacao.status === 'confirmado')
      return res
        .status(400)
        .json({ success: false, error: 'Esta transação já foi paga' })
    if (transacao.status === 'cancelada_expirada')
      return res.status(400).json({
        success: false,
        error: 'Transação expirada. Não é possível gerar novo PIX.'
      })

    const payload = montarPayloadPixV2(transacao)
    console.log(
      '📦 [criarCobrancaPix] Payload V2:',
      JSON.stringify(payload, null, 2)
    )

    const response = await abacateV2.post('/v2/transparents/create', payload)
    const {
      id: cobrancaId,
      brCode,
      brCodeBase64,
      expiresAt
    } = response.data.data

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

    try {
      const emailController = require('./emailController')
      const usuario = await User.findById(transacao.pagador)
      if (
        usuario &&
        usuario.email &&
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
        console.log(`📧 Email com QR Code enviado para ${usuario.email}`)
      }
    } catch (emailError) {
      console.error('❌ Erro ao enviar email com QR Code:', emailError.message)
    }

    res.json({
      success: true,
      qrCode: brCode,
      qrCodeImage: brCodeBase64,
      valor: VALOR_VERMELHO,
      expiraEm: expiresAt,
      transacaoId: transacao._id,
      cobrancaId,
      renovacoes: 0
    })
  } catch (error) {
    const status = error.response?.status
    const apiError = error.response?.data?.error || error.message
    console.error('❌ Erro ao criar QR Code PIX (v2):', { status, apiError })

    if (status === 401 || /invalid or inactive api key/i.test(apiError)) {
      return res.status(503).json({
        success: false,
        error:
          'Serviço de pagamento temporariamente indisponível. Contate o suporte.'
      })
    }
    res.status(500).json({
      success: false,
      error: apiError || 'Erro ao gerar PIX. Tente novamente.'
    })
  }
}

// ===========================================
// VERIFICAR STATUS (V2)
// ===========================================
const verificarStatus = async (req, res) => {
  try {
    const { transacaoId } = req.params
    const transacao = await Transacao.findById(transacaoId)
    if (!transacao)
      return res
        .status(404)
        .json({ success: false, error: 'Transação não encontrada' })

    let expirado = false
    if (
      transacao.metadata?.expiraEm &&
      new Date() > new Date(transacao.metadata.expiraEm)
    )
      expirado = true
    if (transacao.status === 'cancelada_expirada') expirado = true

    if (transacao.status === 'confirmado') {
      return res.json({
        success: true,
        status: transacao.status,
        confirmadoEm: transacao.dataConfirmacao,
        cobrancaId: transacao.cobrancaId,
        expirado
      })
    }

    if (transacao.cobrancaId && !expirado) {
      try {
        const pixData = await consultarStatusTransparenteV2(
          transacao.cobrancaId
        )
        const statusApi = pixData?.status?.toUpperCase?.()
        console.log(
          `[verificarStatus] cobrancaId=${transacao.cobrancaId} → status=${statusApi}`
        )

        if (statusApi === 'PAID') {
          await processarPagamentoComControle(transacaoId, 'verificarStatus')
        } else if (statusApi === 'EXPIRED' || statusApi === 'CANCELLED') {
          if (transacao.status === 'pendente') {
            transacao.status = 'cancelada_expirada'
            await transacao.save()
          }
        }
      } catch (apiError) {
        const status = apiError.response?.status
        if (status === 400) {
          console.warn(
            `⚠️ [verificarStatus] AbacatePay não achou a transação (400)`
          )
        } else {
          console.error(
            '❌ Erro ao consultar status (v2):',
            apiError.response?.data || apiError.message
          )
        }
      }
    }

    const transacaoAtualizada = await Transacao.findById(transacaoId)
    const finalExpirado =
      (transacaoAtualizada.metadata?.expiraEm &&
        new Date() > new Date(transacaoAtualizada.metadata.expiraEm)) ||
      transacaoAtualizada.status === 'cancelada_expirada'

    res.json({
      success: true,
      status: transacaoAtualizada.status,
      confirmadoEm: transacaoAtualizada.dataConfirmacao,
      cobrancaId: transacaoAtualizada.cobrancaId,
      expirado: finalExpirado
    })
  } catch (error) {
    console.error('❌ Erro ao verificar status:', error)
    res.status(500).json({ success: false, error: 'Erro ao verificar status' })
  }
}

// ===========================================
// RENOVAR COBRANÇA (V2) — igual
// ===========================================
const renovarCobrancaPix = async (req, res) => {
  try {
    const { transacaoId } = req.body
    if (!transacaoId)
      return res
        .status(400)
        .json({ success: false, error: 'transacaoId é obrigatório' })

    const transacao = await Transacao.findById(transacaoId).populate(
      'pagador',
      'nome email cpf'
    )
    if (!transacao)
      return res
        .status(404)
        .json({ success: false, error: 'Transação não encontrada' })
    if (transacao.status !== 'pendente')
      return res.status(400).json({
        success: false,
        error: 'Não é possível renovar esta cobrança – status inválido'
      })

    const aindaNaRodada = await Rodada.findOne({
      'participantes.usuario': transacao.pagador._id,
      'participantes.transacaoId': transacaoId
    })
    if (!aindaNaRodada)
      return res.status(400).json({
        success: false,
        error: 'Você não está mais na rodada. Renovação não permitida.'
      })

    const payload = montarPayloadPixV2(transacao)
    console.log(
      '📦 [renovarCobrancaPix] Payload V2:',
      JSON.stringify(payload, null, 2)
    )

    const response = await abacateV2.post('/v2/transparents/create', payload)
    const {
      id: novaCobrancaId,
      brCode,
      brCodeBase64,
      expiresAt
    } = response.data.data

    const renovacoes = (transacao.metadata?.renovacoes || 0) + 1
    transacao.valorPago = VALOR_VERMELHO
    transacao.cobrancaId = novaCobrancaId
    transacao.metadata = {
      ...(transacao.metadata || {}),
      cobrancaRenovadaEm: new Date().toISOString(),
      expiraEm: expiresAt,
      renovacoes,
      valorCorreto: VALOR_VERMELHO,
      qrCode: brCode,
      qrCodeImage: brCodeBase64,
      historicoRenovacoes: [
        ...(transacao.metadata?.historicoRenovacoes || []),
        {
          data: new Date().toISOString(),
          cobrancaId: novaCobrancaId,
          expiraEm: expiresAt,
          valor: VALOR_VERMELHO
        }
      ]
    }
    await transacao.save()

    res.json({
      success: true,
      qrCode: brCode,
      qrCodeImage: brCodeBase64,
      valor: VALOR_VERMELHO,
      expiraEm: expiresAt,
      transacaoId: transacao._id,
      cobrancaId: novaCobrancaId,
      renovacoes
    })
  } catch (error) {
    const status = error.response?.status
    const apiError = error.response?.data?.error || error.message
    console.error('❌ Erro ao renovar PIX (v2):', { status, apiError })

    if (status === 401 || /invalid or inactive api key/i.test(apiError)) {
      return res.status(503).json({
        success: false,
        error:
          'Serviço de pagamento temporariamente indisponível. Contate o suporte.'
      })
    }
    res.status(500).json({
      success: false,
      error: apiError || 'Erro ao renovar PIX. Tente novamente.'
    })
  }
}

// ===========================================
// CANCELAR EXPIRADO — igual
// ===========================================
const cancelarExpirado = async (req, res) => {
  const { transacaoId } = req.body
  const usuarioId = req.usuario.id

  try {
    console.log(
      `[CANCELAR-EXPIRADO] Iniciando para transacao ${transacaoId}, usuario ${usuarioId}`
    )
    const transacao = await Transacao.findById(transacaoId)
    if (!transacao)
      return res.status(404).json({ error: 'Transação não encontrada' })
    if (transacao.status === 'confirmado')
      return res.status(400).json({ error: 'Transação já foi paga' })

    const rodada = await Rodada.findOne({
      'participantes.transacaoId': transacaoId,
      'participantes.usuario': usuarioId,
      'participantes.cor': 'vermelho'
    })
    if (!rodada) {
      if (transacao.status === 'cancelada_expirada')
        return res.json({
          success: true,
          message: 'Participante já havia sido removido'
        })
      return res.status(404).json({ error: 'Rodada não encontrada' })
    }

    await Rodada.updateOne(
      { _id: rodada._id },
      {
        $pull: {
          participantes: { transacaoId: transacaoId },
          vermelhos: usuarioId,
          azuis: usuarioId,
          pretos: usuarioId
        },
        $unset: { verde: usuarioId }
      }
    )

    const rodadaAtualizada = await Rodada.findById(rodada._id)
    const vermelhosRestantes = rodadaAtualizada.participantes.filter(
      p => p.cor === 'vermelho'
    )
    const vermelhosPagos = vermelhosRestantes.filter(
      v => v.depositoConfirmado === true
    )
    rodadaAtualizada.totalDepositosConfirmados = vermelhosPagos.length
    await rodadaAtualizada.save()

    if (transacao.status !== 'cancelada_expirada') {
      transacao.status = 'cancelada_expirada'
      await transacao.save()
    }

    const usuario = await User.findById(usuarioId)
    if (usuario) {
      await User.deleteOne({ _id: usuarioId })
      console.log(`🗑️ [CANCELAR-EXPIRADO] Usuário ${usuario.nome} deletado.`)
    }

    res.json({
      success: true,
      message: 'Participante removido e usuário deletado por inadimplência'
    })
  } catch (error) {
    console.error('Erro no cancelarExpirado:', error)
    res.status(500).json({ error: 'Erro interno ao processar expiração' })
  }
}

// ===========================================
// PROCESSAR TRANSAÇÕES EXPIRADAS (JOB) — igual
// ===========================================
async function processarTransacoesExpiradas () {
  const agora = new Date()
  const transacoesExpiradas = await Transacao.find({
    status: 'pendente',
    'metadata.expiraEm': { $lt: agora }
  }).populate('pagador')

  for (const transacao of transacoesExpiradas) {
    try {
      const usuarioId = transacao.pagador._id
      const usuarioIdStr = usuarioId.toString()

      const rodada = await Rodada.findOne({
        'participantes.usuario': usuarioId,
        'participantes.cor': 'vermelho',
        'participantes.transacaoId': transacao._id
      })
      if (!rodada) {
        transacao.status = 'cancelada_expirada'
        await transacao.save()
        continue
      }

      rodada.participantes = rodada.participantes.filter(
        p => p.transacaoId !== transacao._id
      )
      rodada.vermelhos = rodada.vermelhos.filter(
        id => id.toString() !== usuarioIdStr
      )
      rodada.azuis = rodada.azuis.filter(id => id.toString() !== usuarioIdStr)
      rodada.pretos = rodada.pretos.filter(id => id.toString() !== usuarioIdStr)
      if (rodada.verde && rodada.verde.toString() === usuarioIdStr)
        rodada.verde = null

      const vermelhosRestantes = rodada.participantes.filter(
        p => p.cor === 'vermelho'
      )
      const vermelhosPagos = vermelhosRestantes.filter(
        v => v.depositoConfirmado === true
      )
      rodada.totalDepositosConfirmados = vermelhosPagos.length
      await rodada.save()

      transacao.status = 'cancelada_expirada'
      await transacao.save()

      const usuario = await User.findById(usuarioId)
      if (usuario) {
        await User.deleteOne({ _id: usuarioId })
        console.log(
          `🗑️ [JOB] Usuário ${usuario.nome} deletado por inadimplência.`
        )
      }

      if (io)
        io.to(`rodada-${rodada._id}`).emit('usuario-removido', {
          usuarioId,
          rodadaId: rodada._id,
          motivo: 'expirado'
        })
    } catch (err) {
      console.error(`[JOB] Erro ao processar expiração ${transacao._id}:`, err)
    }
  }
}

// ===========================================
// ENVIAR PIX (PAYOUT) — igual
// ===========================================
const enviarPixSaque = async (
  valor,
  chavePix,
  tipoChavePix,
  solicitacaoId,
  usuarioNome
) => {
  if (!chavePix || !tipoChavePix)
    throw new Error('Chave PIX ou tipo não informados')

  const valorComTaxa = valor + TAXA_PIX
  const valorCentavos = Math.round(valorComTaxa * 100)

  let tipoApi = ''
  switch (tipoChavePix.toLowerCase()) {
    case 'cpf':
      tipoApi = 'CPF'
      break
    case 'email':
      tipoApi = 'EMAIL'
      break
    case 'telefone':
      tipoApi = 'PHONE'
      break
    case 'aleatoria':
      tipoApi = 'RANDOM'
      break
    default:
      tipoApi = 'EMAIL'
  }

  const payload = {
    amount: valorCentavos,
    externalId: solicitacaoId.toString(),
    description: `Saque Giro Premiado - ${usuarioNome}`,
    pix: { key: chavePix, type: tipoApi }
  }

  console.log(
    `💸 Enviando PIX via /v2/pix/send para ${chavePix} (${tipoApi}) valor R$ ${valorComTaxa.toFixed(
      2
    )}`
  )

  try {
    const response = await abacateV2.post('/v2/pix/send', payload)
    const transferId = response.data.data?.id || response.data.id
    console.log(`PIX de saque enviado. ID: ${transferId}`)
    return { success: true, transferId }
  } catch (error) {
    const errorMsg = error.response?.data?.error || error.message
    console.error('❌ Erro ao enviar PIX de saque:', errorMsg)
    throw new Error(`Falha na transferência: ${errorMsg}`)
  }
}

// ===========================================
// REMOVER VERMELHOS INADIMPLENTES — igual
// ===========================================
async function removerVermelhosInadimplentes () {
  const agora = new Date()
  const UMA_HORA_MS = 60 * 60 * 1000
  const dataLimite = new Date(agora.getTime() - UMA_HORA_MS)

  console.log(
    `\n🧹 [JOB-HORARIO] Removendo vermelhos inadimplentes há mais de 1 hora`
  )

  const rodadas = await Rodada.find({
    status: { $in: ['aguardando', 'em_andamento'] }
  }).lean()
  let totalRemovidos = 0

  for (const rodada of rodadas) {
    const vermelhosNaoPagos = rodada.participantes.filter(
      p => p.cor === 'vermelho' && p.depositoConfirmado === false
    )
    if (vermelhosNaoPagos.length === 0) continue

    const transacaoIds = vermelhosNaoPagos
      .map(p => p.transacaoId)
      .filter(id => id)
    const transacoes = await Transacao.find({
      _id: { $in: transacaoIds }
    }).select('_id metadata.status')
    const mapTransacao = new Map()
    transacoes.forEach(t => mapTransacao.set(t._id.toString(), t))

    const participantesParaRemover = vermelhosNaoPagos.filter(p => {
      if (!p.transacaoId) return agora - new Date(p.dataEntrada) >= UMA_HORA_MS
      const transacao = mapTransacao.get(p.transacaoId.toString())
      if (!transacao) return agora - new Date(p.dataEntrada) >= UMA_HORA_MS
      const expiraEm = transacao.metadata?.expiraEm
      if (expiraEm) return new Date(expiraEm) < agora
      else return agora - new Date(p.dataEntrada) >= UMA_HORA_MS
    })

    if (participantesParaRemover.length === 0) continue

    let modificado = false
    for (const p of participantesParaRemover) {
      const usuarioId = p.usuario.toString()
      const transacaoId = p.transacaoId

      await Rodada.updateOne(
        { _id: rodada._id },
        {
          $pull: {
            participantes: { _id: p._id },
            vermelhos: usuarioId,
            azuis: usuarioId,
            pretos: usuarioId
          },
          $unset: { verde: usuarioId }
        }
      )
      if (transacaoId)
        await Transacao.updateOne(
          { _id: transacaoId },
          { $set: { status: 'cancelada_expirada' } }
        )
      const usuario = await User.findById(usuarioId)
      if (usuario) await User.deleteOne({ _id: usuarioId })
      totalRemovidos++
      modificado = true
    }

    if (modificado) {
      const rodadaAtualizada = await Rodada.findById(rodada._id)
      const vermelhosRestantes = rodadaAtualizada.participantes.filter(
        p => p.cor === 'vermelho'
      )
      const pagos = vermelhosRestantes.filter(
        v => v.depositoConfirmado === true
      )
      rodadaAtualizada.totalDepositosConfirmados = pagos.length
      await rodadaAtualizada.save()
    }
  }

  console.log(`[JOB-HORARIO] Total removidos: ${totalRemovidos}`)
}

module.exports = {
  criarCobrancaPix,
  verificarStatus,
  renovarCobrancaPix,
  processarPagamentoComControle,
  cancelarExpirado,
  processarTransacoesExpiradas,
  initializeIo,
  removerVermelhosInadimplentes,
  setRodadaService,
  enviarPixSaque
}
