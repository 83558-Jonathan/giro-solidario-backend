const abacate = require('../config/abacate')
const Transacao = require('../models/Transacao')
const Rodada = require('../models/Rodada')
const User = require('../models/User')
const RodadaService = require('../services/rodadaService')

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

    // Impedir processamento se já expirou ou foi cancelada
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

    const vermelhos = rodada.participantes.filter(p => p.cor === 'vermelho')
    const vermelhosPagos = vermelhos.filter(v => v.depositoConfirmado === true)
    rodada.totalDepositosConfirmados = vermelhosPagos.length
    await rodada.save()

    // Remover da fila de espera (se estiver nela)
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
    console.log(
      `📊 [${source}] Progresso: ${vermelhosPagos.length}/${vermelhos.length}`
    )

    if (vermelhosPagos.length === vermelhos.length && vermelhos.length === 8) {
      console.log(`🎉 [${source}] TODOS OS 8 VERMELHOS PAGARAM!`)
      if (!rodada.todosDepositaram) {
        rodada.todosDepositaram = true
        rodada.dataTodosDepositaram = new Date()
        await rodada.save()
      }
      try {
        await RodadaService.avancarRodada(rodada._id)
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
      progresso: `${vermelhosPagos.length}/${vermelhos.length}`
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
exports.criarCobrancaPix = async (req, res) => {
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
    // Impedir criação se já expirou
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

    // Envio de email (opcional)
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
exports.verificarStatus = async (req, res) => {
  try {
    const { transacaoId } = req.params
    const transacao = await Transacao.findById(transacaoId)
    if (!transacao)
      return res
        .status(404)
        .json({ success: false, error: 'Transação não encontrada' })

    let expirado = false
    // 1. Verificar expiração por data
    if (
      transacao.metadata?.expiraEm &&
      new Date() > new Date(transacao.metadata.expiraEm)
    ) {
      expirado = true
    }
    // 2. Verificar status "cancelada_expirada"
    if (transacao.status === 'cancelada_expirada') {
      expirado = true
    }

    if (transacao.status === 'confirmado') {
      return res.json({
        success: true,
        status: transacao.status,
        confirmadoEm: transacao.dataConfirmacao,
        cobrancaId: transacao.cobrancaId,
        expirado
      })
    }

    // Se ainda está pendente, consulta API externa (apenas se não estiver expirada)
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
exports.renovarCobrancaPix = async (req, res) => {
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

    // ✅ BLOQUEAR RENOVAÇÃO SE NÃO ESTIVER PENDENTE
    if (transacao.status !== 'pendente') {
      return res.status(400).json({
        success: false,
        error: 'Não é possível renovar esta cobrança – status inválido'
      })
    }

    // Verificar se o usuário ainda está na rodada (não foi removido por expiração)
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
// ===========================================
exports.cancelarExpirado = async (req, res) => {
  const { transacaoId } = req.body;
  const usuarioId = req.usuario.id;

  try {
    console.log(`[CANCELAR-EXPIRADO] Iniciando para transacao ${transacaoId}, usuario ${usuarioId}`);

    const transacao = await Transacao.findById(transacaoId);
    if (!transacao) {
      return res.status(404).json({ error: 'Transação não encontrada' });
    }
    if (transacao.status === 'confirmado') {
      return res.status(400).json({ error: 'Transação já foi paga' });
    }

    // Buscar a rodada de forma mais direta
    const rodada = await Rodada.findOne({
      'participantes.transacaoId': transacaoId,
      'participantes.usuario': usuarioId,
      'participantes.cor': 'vermelho'
    });

    if (!rodada) {
      console.log(`[CANCELAR-EXPIRADO] Rodada não encontrada para transacao ${transacaoId}`);
      // Se a transação já está expirada e não tem rodada, consideramos já removido
      if (transacao.status === 'cancelada_expirada') {
        return res.json({ success: true, message: 'Participante já havia sido removido' });
      }
      return res.status(404).json({ error: 'Rodada não encontrada' });
    }

    console.log(`[CANCELAR-EXPIRADO] Rodada encontrada: ${rodada.nome} (${rodada._id})`);

    // REMOÇÃO FORÇADA usando operadores atômicos $pull
    const usuarioIdStr = usuarioId.toString();

    const updateResult = await Rodada.updateOne(
      { _id: rodada._id },
      {
        $pull: {
          participantes: { transacaoId: transacaoId },
          vermelhos: usuarioId,
          azuis: usuarioId,
          pretos: usuarioId
        },
        $unset: { verde: usuarioId } // se for o verde, remove
      }
    );

    if (updateResult.modifiedCount === 0) {
      console.log(`[CANCELAR-EXPIRADO] Nenhum documento alterado. Possivelmente já removido.`);
    } else {
      console.log(`[CANCELAR-EXPIRADO] Participante removido da rodada via $pull.`);
    }

    // Recalcular totalDepositosConfirmados (buscar rodada atualizada)
    const rodadaAtualizada = await Rodada.findById(rodada._id);
    const vermelhosRestantes = rodadaAtualizada.participantes.filter(p => p.cor === 'vermelho');
    const vermelhosPagos = vermelhosRestantes.filter(v => v.depositoConfirmado === true);
    rodadaAtualizada.totalDepositosConfirmados = vermelhosPagos.length;
    await rodadaAtualizada.save();

    // Atualizar status da transação
    if (transacao.status !== 'cancelada_expirada') {
      transacao.status = 'cancelada_expirada';
      await transacao.save();
    }

    // Colocar na fila de espera
    const usuario = await User.findById(usuarioId);
    if (usuario && !usuario.aguardandoVermelho) {
      usuario.aguardandoVermelho = true;
      usuario.rodadaBloqueada = rodada._id;
      usuario.dataEntradaFila = new Date();
      const ultimoNaFila = await User.findOne({ aguardandoVermelho: true }).sort('-posicaoFila');
      usuario.posicaoFila = (ultimoNaFila?.posicaoFila || 0) + 1;
      await usuario.save();
      console.log(`✅ Usuário ${usuario.nome} colocado na fila (posição ${usuario.posicaoFila})`);
    }

    res.json({
      success: true,
      message: 'Participante removido e colocado na fila de espera'
    });
  } catch (error) {
    console.error('Erro no cancelarExpirado:', error);
    res.status(500).json({ error: 'Erro interno ao processar expiração' });
  }
};

// ===========================================
// PROCESSAR TRANSAÇÕES EXPIRADAS (JOB)
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
      if (!rodada) continue

      // ===========================================
      // REMOÇÃO COMPLETA DO PARTICIPANTE
      // ===========================================
      rodada.participantes = rodada.participantes.filter(
        p => p.transacaoId !== transacao._id
      )

      rodada.vermelhos = rodada.vermelhos.filter(
        id => id.toString() !== usuarioIdStr
      )
      rodada.azuis = rodada.azuis.filter(id => id.toString() !== usuarioIdStr)
      rodada.pretos = rodada.pretos.filter(id => id.toString() !== usuarioIdStr)
      if (rodada.verde && rodada.verde.toString() === usuarioIdStr) {
        rodada.verde = null
      }

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
      if (!usuario.aguardandoVermelho) {
        usuario.aguardandoVermelho = true
        usuario.rodadaBloqueada = rodada._id
        usuario.dataEntradaFila = new Date()
        const ultimoNaFila = await User.findOne({
          aguardandoVermelho: true
        }).sort('-posicaoFila')
        usuario.posicaoFila = (ultimoNaFila?.posicaoFila || 0) + 1
        await usuario.save()
      }
      console.log(
        `[JOB] Transação ${transacao._id} expirada - usuário ${usuario.nome} removido da rodada ${rodada.nome} e colocado na fila`
      )
    } catch (err) {
      console.error(`[JOB] Erro ao processar expiração ${transacao._id}:`, err)
    }
  }
}

module.exports = {
  criarCobrancaPix: exports.criarCobrancaPix,
  verificarStatus: exports.verificarStatus,
  renovarCobrancaPix: exports.renovarCobrancaPix,
  processarPagamentoComControle,
  cancelarExpirado: exports.cancelarExpirado,
  processarTransacoesExpiradas
}
