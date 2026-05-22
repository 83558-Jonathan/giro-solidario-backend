const Transacao = require('../models/Transacao')
const Rodada = require('../models/Rodada')
const mongoose = require('mongoose')

exports.minhasTransacoes = async (req, res) => {
  try {
    const transacoes = await Transacao.find({
      $or: [{ pagador: req.usuarioId }, { recebedor: req.usuarioId }]
    })
      .populate('pagador', 'nome')
      .populate('recebedor', 'nome')
      .populate('rodada', 'nome numero')
      .sort({ createdAt: -1 })
    res.json({ success: true, count: transacoes.length, data: transacoes })
  } catch (error) {
    console.error('❌ Erro ao buscar transações:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

exports.porRodada = async (req, res) => {
  try {
    const { rodadaId } = req.params
    if (!mongoose.Types.ObjectId.isValid(rodadaId))
      return res
        .status(400)
        .json({ success: false, error: 'ID da rodada inválido' })
    const transacoes = await Transacao.find({ rodada: rodadaId })
      .populate('pagador', 'nome')
      .populate('recebedor', 'nome')
    res.json({ success: true, count: transacoes.length, data: transacoes })
  } catch (error) {
    console.error('❌ Erro ao listar transações da rodada:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

exports.confirmarDeposito = async (req, res) => {
  try {
    const { transacaoId } = req.params
    const { comprovante } = req.body
    if (!comprovante)
      return res
        .status(400)
        .json({ success: false, error: 'Comprovante é obrigatório' })
    if (!mongoose.Types.ObjectId.isValid(transacaoId))
      return res
        .status(400)
        .json({ success: false, error: 'ID da transação inválido' })
    const transacao = await Transacao.findById(transacaoId)
    if (!transacao)
      return res
        .status(404)
        .json({ success: false, error: 'Transação não encontrada' })
    if (transacao.status !== 'pendente')
      return res
        .status(400)
        .json({ success: false, error: `Transação já foi ${transacao.status}` })
    transacao.status = 'confirmado'
    transacao.comprovante = comprovante
    transacao.dataConfirmacao = new Date()
    transacao.confirmadoPor = req.usuarioId
    await transacao.save()
    const rodada = await Rodada.findById(transacao.rodada)
    if (rodada) {
      const participante = rodada.participantes.find(
        p => p.usuario.toString() === transacao.pagador.toString()
      )
      if (participante) {
        if (participante.depositoConfirmado === true)
          return res.json({
            success: true,
            data: transacao,
            message: 'Depósito já estava confirmado anteriormente.'
          })
        participante.depositoConfirmado = true
        participante.dataDeposito = new Date()
        participante.comprovantePix = comprovante
        const vermelhos = rodada.participantes.filter(p => p.cor === 'vermelho')
        const vermelhosPagos = vermelhos.filter(
          v => v.depositoConfirmado === true
        )
        rodada.totalDepositosConfirmados = vermelhosPagos.length
        await rodada.save()
        if (
          vermelhosPagos.length === vermelhos.length &&
          vermelhos.length === 8
        ) {
          if (!rodada.todosDepositaram) {
            rodada.todosDepositaram = true
            rodada.dataTodosDepositaram = new Date()
            await rodada.save()
          }
          try {
            const RodadaService = require('../services/rodadaService')
            await RodadaService.avancarRodada(rodada._id)
          } catch (err) {
            console.error('❌ Erro ao avançar rodada:', err)
          }
        }
      }
    }
    const transacaoAtualizada = await Transacao.findById(transacaoId)
      .populate('pagador', 'nome')
      .populate('recebedor', 'nome')
    res.json({
      success: true,
      data: transacaoAtualizada,
      message: 'Depósito confirmado com sucesso!'
    })
  } catch (error) {
    console.error('❌ Erro ao confirmar depósito:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

exports.cancelarTransacao = async (req, res) => {
  try {
    const { transacaoId } = req.params
    const { motivo } = req.body
    if (!mongoose.Types.ObjectId.isValid(transacaoId))
      return res
        .status(400)
        .json({ success: false, error: 'ID da transação inválido' })
    const transacao = await Transacao.findById(transacaoId)
    if (!transacao)
      return res
        .status(404)
        .json({ success: false, error: 'Transação não encontrada' })
    if (transacao.status !== 'pendente')
      return res
        .status(400)
        .json({
          success: false,
          error: `Não é possível cancelar transação ${transacao.status}`
        })
    transacao.status = 'cancelado'
    transacao.motivoCancelamento = motivo || 'Cancelado pelo usuário'
    transacao.dataCancelamento = new Date()
    await transacao.save()
    res.json({ success: true, message: 'Transação cancelada com sucesso' })
  } catch (error) {
    console.error('❌ Erro ao cancelar transação:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

exports.estatisticas = async (req, res) => {
  try {
    const [
      totalPendente,
      totalConfirmado,
      totalComoPagador,
      totalComoRecebedor
    ] = await Promise.all([
      Transacao.countDocuments({
        $or: [{ pagador: req.usuarioId }, { recebedor: req.usuarioId }],
        status: 'pendente'
      }),
      Transacao.countDocuments({
        $or: [{ pagador: req.usuarioId }, { recebedor: req.usuarioId }],
        status: 'confirmado'
      }),
      Transacao.countDocuments({
        pagador: req.usuarioId,
        status: 'confirmado'
      }),
      Transacao.countDocuments({
        recebedor: req.usuarioId,
        status: 'confirmado'
      })
    ])
    res.json({
      success: true,
      data: {
        pendente: totalPendente,
        confirmado: totalConfirmado,
        comoPagador: totalComoPagador,
        comoRecebedor: totalComoRecebedor,
        total: totalPendente + totalConfirmado
      }
    })
  } catch (error) {
    console.error('❌ Erro ao buscar estatísticas:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

exports.buscarTransacaoPorId = async (req, res) => {
  try {
    const { id } = req.params
    if (!mongoose.Types.ObjectId.isValid(id))
      return res
        .status(400)
        .json({ success: false, error: 'ID da transação inválido' })
    const transacao = await Transacao.findById(id)
      .populate('pagador', 'nome email')
      .populate('recebedor', 'nome email')
      .populate('rodada', 'nome numero')
    if (!transacao)
      return res
        .status(404)
        .json({ success: false, error: 'Transação não encontrada' })
    res.json({ success: true, data: transacao })
  } catch (error) {
    console.error('❌ Erro ao buscar transação:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}
