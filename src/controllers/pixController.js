const abacate = require('../config/abacate')
const Transacao = require('../models/Transacao')
const Rodada = require('../models/Rodada')
const User = require('../models/User')
const ChatMessage = require('../models/ChatMessage')

// ===========================================
// VARIÁVEL GLOBAL PARA O SOCKET.IO
// ===========================================
let io = null
let rodadaServiceInstance = null // para injeção de dependência

function initializeIo (socketIo) {
  io = socketIo
  console.log('✅ io inicializado no pixController')
}

function setRodadaService (service) {
  rodadaServiceInstance = service
  console.log('✅ RodadaService injetado no pixController')
}

const VALOR_VERMELHO = 150
const pagamentosProcessados = new Map()

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
        `⚠️ [${source}] Transação ${transacaoId} está com status ${transacao.status}. Não processar pagamento.`
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
        mensagem: `✅ ${nomePagador} realizou o pagamento! Faltam ${faltam} pagamento(s) para a rodada avançar.`,
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

    // Se o usuário estava na fila, remover os campos (pagou, então não precisa mais)
    const usuario = await User.findById(transacao.pagador)
    if (usuario && usuario.aguardandoVermelho) {
      usuario.aguardandoVermelho = false
      usuario.posicaoFila = null
      usuario.dataEntradaFila = null
      usuario.rodadaBloqueada = null
      await usuario.save()
      console.log(
        `✅ [${source}] Usuário ${usuario.nome} removido da fila após pagamento`
      )
    }

    console.log(
      `✅ [${source}] Participante ${participante.usuario} marcado como pago`
    )
    console.log(`📊 [${source}] Progresso: ${pagos.length}/${vermelhos.length}`)

    if (pagos.length === vermelhos.length && vermelhos.length === 8) {
      console.log(`🎉 [${source}] TODOS OS 8 VERMELHOS PAGARAM!`)
      if (!rodada.todosDepositaram) {
        rodada.todosDepositaram = true
        rodada.dataTodosDepositaram = new Date()
        await rodada.save()
      }
      try {
        if (rodadaServiceInstance) {
          await rodadaServiceInstance.avancarRodada(rodada._id)
        } else {
          console.error(
            `❌ [${source}] RodadaService não injetado! Não foi possível avançar a rodada.`
          )
        }

        if (io) {
          io.to(`rodada-${rodada._id}`).emit('rodada-atualizada', {
            rodadaId: rodada._id,
            status: 'concluida'
          })
        }
        console.log(
          `✅ [${source}] Rodada ${rodada.nome} avançada com sucesso!`
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
// CRIAR COBRANÇA PIX
// ===========================================
const criarCobrancaPix = async (req, res) => {
  try {
    const { transacaoId } = req.body
    if (!transacaoId)
      return res
        .status(400)
        .json({ success: false, error: 'transacaoId é obrigatório' })

    const transacao = await Transacao.findById(transacaoId)
      .populate('pagador', 'nome email')
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

    const valorCentavos = Math.round(VALOR_VERMELHO * 100)
    const payload = {
      amount: valorCentavos,
      description: `Giro Premiado - ${transacao.pagador.nome}`,
      expiresIn: 3600,
      metadata: { externalId: transacao._id.toString() }
    }
    const response = await abacate.post('/pixQrCode/create', payload)
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
      tipo: 'pix_qrcode_v1',
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
    console.error('❌ Erro ao criar QR Code PIX:', error)
    res.status(500).json({
      success: false,
      error:
        error.response?.data?.error || 'Erro ao gerar PIX. Tente novamente.'
    })
  }
}

// ===========================================
// VERIFICAR STATUS
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
        const response = await abacate.get(`/pixQrCode/check`, {
          params: { id: transacao.cobrancaId }
        })
        const statusApi =
          response.data.data?.status?.toUpperCase?.() ||
          response.data.data?.status
        if (
          statusApi === 'PAID' ||
          statusApi === 'COMPLETED' ||
          statusApi === 'CONFIRMED'
        ) {
          await processarPagamentoComControle(transacaoId, 'verificarStatus')
        }
      } catch (apiError) {
        console.error('❌ Erro ao consultar status:', apiError.message)
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
// RENOVAR COBRANÇA
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
      'nome email'
    )
    if (!transacao)
      return res
        .status(404)
        .json({ success: false, error: 'Transação não encontrada' })
    if (transacao.status !== 'pendente') {
      return res.status(400).json({
        success: false,
        error: 'Não é possível renovar esta cobrança – status inválido'
      })
    }

    const aindaNaRodada = await Rodada.findOne({
      'participantes.usuario': transacao.pagador._id,
      'participantes.transacaoId': transacaoId
    })
    if (!aindaNaRodada) {
      return res.status(400).json({
        success: false,
        error: 'Você não está mais na rodada. Renovação não permitida.'
      })
    }

    const valorCentavos = Math.round(VALOR_VERMELHO * 100)
    const payload = {
      amount: valorCentavos,
      description: `Giro Premiado - ${transacao.pagador.nome}`,
      expiresIn: 3600,
      metadata: { externalId: transacao._id.toString() }
    }
    const response = await abacate.post('/pixQrCode/create', payload)
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
    console.error('❌ Erro ao renovar PIX:', error)
    res.status(500).json({
      success: false,
      error:
        error.response?.data?.error || 'Erro ao renovar PIX. Tente novamente.'
    })
  }
}

// ===========================================
// CANCELAR EXPIRADO (chamado pelo frontend)
// AGORA DELETA O USUÁRIO EM VEZ DE COLOCAR NA FILA
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
      console.log(
        `[CANCELAR-EXPIRADO] Rodada não encontrada para transacao ${transacaoId}`
      )
      if (transacao.status === 'cancelada_expirada') {
        return res.json({
          success: true,
          message: 'Participante já havia sido removido'
        })
      }
      return res.status(404).json({ error: 'Rodada não encontrada' })
    }

    console.log(
      `[CANCELAR-EXPIRADO] Rodada encontrada: ${rodada.nome} (${rodada._id})`
    )
    const usuarioIdStr = usuarioId.toString()

    const updateResult = await Rodada.updateOne(
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

    if (updateResult.modifiedCount === 0) {
      console.log(
        `[CANCELAR-EXPIRADO] Nenhum documento alterado. Possivelmente já removido.`
      )
    } else {
      console.log(
        `[CANCELAR-EXPIRADO] Participante removido da rodada via $pull.`
      )
    }

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

    // 🔥 ALTERAÇÃO: DELETAR O USUÁRIO EM VEZ DE COLOCAR NA FILA
    const usuario = await User.findById(usuarioId)
    if (usuario) {
      await User.deleteOne({ _id: usuarioId })
      console.log(
        `🗑️ [CANCELAR-EXPIRADO] Usuário ${usuario.nome} (${usuarioId}) deletado por expiração manual.`
      )
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
// PROCESSAR TRANSAÇÕES EXPIRADAS (JOB)
// AGORA DELETA O USUÁRIO EM VEZ DE COLOCAR NA FILA
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
        console.log(
          `[JOB] Transação ${transacao._id} expirada, mas usuário não está mais na rodada. Cancelando transação.`
        )
        transacao.status = 'cancelada_expirada'
        await transacao.save()
        continue
      }

      // Remove o participante da rodada
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

      // 🔥 ALTERAÇÃO: DELETAR O USUÁRIO (não colocar na fila)
      const usuario = await User.findById(usuarioId)
      if (usuario) {
        await User.deleteOne({ _id: usuarioId })
        console.log(
          `🗑️ [JOB] Usuário ${usuario.nome} (${usuarioId}) deletado por inadimplência.`
        )
      }

      if (io) {
        io.to(`rodada-${rodada._id}`).emit('usuario-removido', {
          usuarioId: usuarioId,
          rodadaId: rodada._id,
          motivo: 'expirado'
        })
      }
    } catch (err) {
      console.error(`[JOB] Erro ao processar expiração ${transacao._id}:`, err)
    }
  }
}

// ===========================================
// REMOVER VERMELHOS INADIMPLENTES (JOB DIÁRIO - 24h)
// AGORA DELETA O USUÁRIO EM VEZ DE COLOCAR NA FILA
// ===========================================
async function removerVermelhosInadimplentes () {
  const agora = new Date()
  const limiteHoras = 24 // Considerar vermelhos que não pagaram há mais de 24 horas
  const dataLimite = new Date(agora.getTime() - limiteHoras * 60 * 60 * 1000)

  console.log(
    `\n🧹 [JOB-DIARIO] Removendo vermelhos que não pagaram há mais de ${limiteHoras} horas (antes de ${dataLimite.toISOString()})`
  )

  const rodadas = await Rodada.find({
    status: { $in: ['aguardando', 'em_andamento'] }
  }).lean()
  let totalRemovidos = 0

  for (const rodada of rodadas) {
    let modificado = false
    const participantesParaRemover = rodada.participantes.filter(
      p =>
        p.cor === 'vermelho' &&
        p.depositoConfirmado === false &&
        new Date(p.dataEntrada) < dataLimite
    )

    if (participantesParaRemover.length === 0) continue

    console.log(
      `   Rodada ${rodada.nome} (${rodada._id}): ${participantesParaRemover.length} vermelho(s) inadimplente(s).`
    )

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

      if (transacaoId) {
        await Transacao.updateOne(
          { _id: transacaoId },
          { $set: { status: 'cancelada_expirada' } }
        )
        console.log(`      Transação ${transacaoId} cancelada.`)
      }

      // 🔥 ALTERAÇÃO: DELETAR O USUÁRIO
      const usuario = await User.findById(usuarioId)
      if (usuario) {
        await User.deleteOne({ _id: usuarioId })
        console.log(
          `      🗑️ Usuário ${usuario.nome} (${usuarioId}) deletado por inadimplência >24h.`
        )
      }

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

  console.log(
    `✅ [JOB-DIARIO] Total de vermelhos removidos (e usuários deletados): ${totalRemovidos}`
  )
}

// ===========================================
// EXPORTAÇÕES
// ===========================================
module.exports = {
  criarCobrancaPix,
  verificarStatus,
  renovarCobrancaPix,
  processarPagamentoComControle,
  cancelarExpirado,
  processarTransacoesExpiradas,
  initializeIo,
  removerVermelhosInadimplentes,
  setRodadaService
}
