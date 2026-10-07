const User = require('../models/User')
const Rodada = require('../models/Rodada')
const Transacao = require('../models/Transacao')
const SolicitacaoSaque = require('../models/SolicitacaoSaque')
const { enviarPixSaque } = require('./pixController')
const mongoose = require('mongoose')

// ===========================================
// ESTATÍSTICAS GERAIS
// ===========================================
exports.getEstatisticas = async (req, res) => {
  try {
    const db = mongoose.connection.db
    const totalUsuarios = await User.countDocuments()

    const rodadas = await db
      .collection('rodadas')
      .aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }])
      .toArray()
    const rodadasAtivas =
      rodadas.find(r => r._id === 'em_andamento')?.count || 0
    const rodadasAguardando =
      rodadas.find(r => r._id === 'aguardando')?.count || 0
    const rodadasConcluidas =
      rodadas.find(r => r._id === 'concluida')?.count || 0

    const saques = await db
      .collection('solicitacaosaques')
      .aggregate([
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            total: { $sum: '$valor' }
          }
        }
      ])
      .toArray()
    const saquesPendentes = saques.find(s => s._id === 'pendente')?.count || 0
    const totalSolicitado = saques.reduce((acc, s) => acc + (s.total || 0), 0)
    const totalPago = saques.find(s => s._id === 'aprovado')?.total || 0
    const transacoesConfirmadas = await Transacao.countDocuments({
      status: 'confirmado'
    })

    // NOVO: métricas extras
    const usuariosNaFila = await User.countDocuments({
      aguardandoVermelho: true
    })
    const saldoTotalUsuarios = await User.aggregate([
      { $group: { _id: null, total: { $sum: '$saldoPremio' } } }
    ])
    const saldoTotal = saldoTotalUsuarios[0]?.total || 0
    const totalComissoesPagas = await User.aggregate([
      { $group: { _id: null, total: { $sum: '$totalComissao' } } }
    ])

    res.json({
      success: true,
      data: {
        usuarios: totalUsuarios,
        usuariosNaFila,
        saldoTotalUsuarios: saldoTotal,
        totalComissoesPagas: totalComissoesPagas[0]?.total || 0,
        rodadas: {
          total: rodadasAtivas + rodadasAguardando + rodadasConcluidas,
          ativas: rodadasAtivas,
          aguardando: rodadasAguardando,
          concluidas: rodadasConcluidas
        },
        saques: { pendentes: saquesPendentes, totalSolicitado, totalPago },
        transacoes: { confirmadas: transacoesConfirmadas }
      }
    })
  } catch (error) {
    console.error('Erro ao buscar estatisticas:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

// ===========================================
// LISTA COMPLETA DE USUÁRIOS (com estatísticas)
// ===========================================
exports.getUsuariosCompletos = async (req, res) => {
  try {
    const usuarios = await User.find()
      .select('-senha -resetPasswordToken -resetPasswordExpires')
      .populate('indicadoPor', 'nome email codigoConvite')
      .populate('meusIndicados', 'nome email createdAt')
      .sort({ createdAt: -1 })
      .lean()

    const usuariosCompletos = await Promise.all(
      usuarios.map(async u => {
        const rodadas = await Rodada.find({ 'participantes.usuario': u._id })
          .select('nome numero status participantes participantes.usuario')
          .lean()

        const rodadasJogadas = rodadas.filter(r =>
          r.participantes.some(p => p.usuario.toString() === u._id.toString())
        ).length

        const rodadasVencidas = rodadas.filter(r =>
          r.participantes.some(
            p =>
              p.usuario.toString() === u._id.toString() && p.cor === 'concluido'
          )
        ).length

        // Rodada ativa
        const rodadaAtiva = rodadas.find(r =>
          ['aguardando', 'em_andamento'].includes(r.status)
        )
        const participanteAtivo = rodadaAtiva?.participantes.find(
          p => p.usuario.toString() === u._id.toString()
        )

        // Total apostado (soma das transações confirmadas como pagador)
        const totalApostado = await Transacao.aggregate([
          { $match: { pagador: u._id, status: 'confirmado' } },
          { $group: { _id: null, total: { $sum: '$valor' } } }
        ])

        // Total recebido como verde
        const totalRecebido = await Transacao.aggregate([
          { $match: { recebedor: u._id, status: 'confirmado' } },
          { $group: { _id: null, total: { $sum: '$valor' } } }
        ])

        return {
          ...u,
          estatisticas: {
            rodadasJogadas,
            rodadasVencidas,
            totalIndicacoes: (u.meusIndicados || []).length,
            totalApostado: totalApostado[0]?.total || 0,
            totalRecebido: totalRecebido[0]?.total || 0,
            rodadaAtiva: rodadaAtiva
              ? {
                  nome: rodadaAtiva.nome,
                  numero: rodadaAtiva.numero,
                  status: rodadaAtiva.status,
                  cor: participanteAtivo?.cor,
                  depositoConfirmado: participanteAtivo?.depositoConfirmado
                }
              : null
          }
        }
      })
    )

    res.json({
      success: true,
      count: usuariosCompletos.length,
      data: usuariosCompletos
    })
  } catch (error) {
    console.error('Erro ao buscar usuários completos:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

// ===========================================
// DETALHE DE UM USUÁRIO (com todas rodadas + indicações)
// ===========================================
exports.getUsuarioDetalhe = async (req, res) => {
  try {
    const { id } = req.params
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'ID inválido' })
    }

    const usuario = await User.findById(id)
      .select('-senha -resetPasswordToken -resetPasswordExpires')
      .populate('indicadoPor', 'nome email codigoConvite')
      .populate('meusIndicados', 'nome email createdAt saldoPremio')
      .lean()

    if (!usuario) {
      return res
        .status(404)
        .json({ success: false, error: 'Usuário não encontrado' })
    }

    // Todas as rodadas que participou
    const rodadas = await Rodada.find({ 'participantes.usuario': id })
      .select(
        'nome numero status participantes verde pretos azuis vermelhos createdAt dataInicio dataFim'
      )
      .sort({ numero: -1 })
      .lean()

    const historicoRodadas = rodadas.map(r => {
      const p = r.participantes.find(p => p.usuario.toString() === id)
      return {
        rodadaId: r._id,
        nome: r.nome,
        numero: r.numero,
        status: r.status,
        cor: p?.cor,
        depositoConfirmado: p?.depositoConfirmado,
        dataEntrada: p?.dataEntrada,
        indicadoPor: p?.indicadoPor,
        createdAt: r.createdAt,
        dataFim: r.dataFim
      }
    })

    // Todas as transações
    const transacoes = await Transacao.find({
      $or: [{ pagador: id }, { recebedor: id }]
    })
      .populate('pagador', 'nome')
      .populate('recebedor', 'nome')
      .populate('rodada', 'nome numero')
      .sort({ createdAt: -1 })
      .lean()

    // Todos os saques
    const saques = await SolicitacaoSaque.find({ usuario: id })
      .populate('rodada', 'nome numero')
      .sort({ dataSolicitacao: -1 })
      .lean()

    res.json({
      success: true,
      data: {
        usuario,
        historicoRodadas,
        transacoes,
        saques
      }
    })
  } catch (error) {
    console.error('Erro ao buscar detalhe do usuário:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

// ===========================================
// SAQUES PENDENTES
// ===========================================
exports.getSaquesPendentes = async (req, res) => {
  try {
    const solicitacoes = await SolicitacaoSaque.find({ status: 'pendente' })
      .populate(
        'usuario',
        'nome email telefone cpf chavePix tipoChavePix totalComissao totalIndicacoesComissionadas saldoPremio totalGanho totalSacado'
      )
      .populate(
        'rodada',
        'nome numero status createdAt dataFim totalDepositosConfirmados participantes verde pretos azuis vermelhos todosDepositaram'
      )
      .sort({ dataSolicitacao: 1 })

    const solicitacoesCompletas = await Promise.all(
      solicitacoes.map(async s => {
        const rodada = s.rodada
        if (rodada) {
          const rodadaCompleta = await Rodada.findById(rodada._id).populate(
            'participantes.usuario',
            'nome email cpf chavePix'
          )
          const verdeGanhador = rodadaCompleta?.participantes?.find(
            p => p.cor === 'concluido'
          )
          return {
            ...s.toObject(),
            rodada: {
              ...rodada.toObject(),
              participantes: rodadaCompleta?.participantes || [],
              verdeGanhador: verdeGanhador
                ? {
                    nome: verdeGanhador.usuario?.nome,
                    email: verdeGanhador.usuario?.email,
                    cpf: verdeGanhador.usuario?.cpf,
                    chavePix: verdeGanhador.usuario?.chavePix
                  }
                : null,
              progresso: {
                participantes: rodada.participantes?.length || 0,
                vermelhos: rodada.vermelhos?.length || 0,
                pagos: rodada.totalDepositosConfirmados || 0
              }
            }
          }
        }
        return s
      })
    )
    res.json({ success: true, data: solicitacoesCompletas })
  } catch (error) {
    console.error('Erro ao buscar saques pendentes:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

// ===========================================
// HISTÓRICO DE SAQUES
// ===========================================
exports.getTodosSaques = async (req, res) => {
  try {
    const solicitacoes = await SolicitacaoSaque.find({})
      .populate(
        'usuario',
        'nome email telefone cpf chavePix tipoChavePix totalComissao saldoPremio'
      )
      .populate('rodada', 'nome numero status createdAt dataFim')
      .sort({ dataSolicitacao: -1 })
    res.json({ success: true, data: solicitacoes })
  } catch (error) {
    console.error('Erro ao buscar historico de saques:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

// ===========================================
// RECUSAR SAQUE
// ===========================================
exports.recusarSaque = async (req, res) => {
  try {
    const { id } = req.params
    const { motivo } = req.body
    console.log(`Recusando saque ID: ${id}, Motivo: ${motivo}`)

    const solicitacao = await SolicitacaoSaque.findById(id)
    if (!solicitacao)
      return res
        .status(404)
        .json({ success: false, error: 'Solicitacao nao encontrada' })
    if (solicitacao.status !== 'pendente')
      return res
        .status(400)
        .json({ success: false, error: 'Esta solicitacao ja foi processada' })

    solicitacao.status = 'recusado'
    solicitacao.motivoRecusa = motivo
    solicitacao.dataRecusa = new Date()
    solicitacao.recusadoPor = req.usuarioId
    await solicitacao.save()

    if (solicitacao.rodada) {
      await Rodada.findByIdAndUpdate(solicitacao.rodada, {
        $set: { premioVerdePago: false }
      })
      console.log(
        `Premio da rodada ${solicitacao.rodada} reativado para novo saque`
      )
    } else {
      console.log(`Saque de saldo recusado - saldo mantido no usuario`)
    }

    try {
      const usuario = await User.findById(solicitacao.usuario)
      const emailController = require('./emailController')
      if (emailController.notificarSaqueRecusado)
        await emailController.notificarSaqueRecusado(
          usuario,
          solicitacao,
          motivo
        )
    } catch (emailError) {
      console.error('Erro ao enviar email de recusa:', emailError)
    }

    res.json({
      success: true,
      message: 'Saque recusado. O usuario podera solicitar novamente o premio.'
    })
  } catch (error) {
    console.error('Erro ao recusar saque:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

// ===========================================
// DETALHE DE RODADA (com todos dados dos participantes)
// ===========================================
exports.getRodadaDetalhes = async (req, res) => {
  try {
    const { id } = req.params
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'ID inválido' })
    }

    const rodada = await Rodada.findById(id)
      .populate(
        'participantes.usuario',
        'nome email telefone cpf chavePix tipoChavePix saldoPremio totalGanho totalSacado meusIndicados indicadoPor'
      )
      .populate('verde', 'nome email')
      .populate('pretos', 'nome email')
      .populate('azuis', 'nome email')
      .populate('vermelhos', 'nome email')
      .lean()

    if (!rodada)
      return res
        .status(404)
        .json({ success: false, error: 'Rodada nao encontrada' })

    const participantes = rodada.participantes || []
    const vermelhos = participantes.filter(p => p.cor === 'vermelho')
    const pagos = vermelhos.filter(v => v.depositoConfirmado).length

    const stats = {
      totalParticipantes: participantes.length,
      verde: participantes.filter(p => p.cor === 'verde').length,
      preto: participantes.filter(p => p.cor === 'preto').length,
      azul: participantes.filter(p => p.cor === 'azul').length,
      vermelho: vermelhos.length,
      amarelo: participantes.filter(p => p.cor === 'amarelo').length,
      concluido: participantes.filter(p => p.cor === 'concluido').length,
      pagamentosConfirmados: pagos,
      percentualConcluido:
        vermelhos.length > 0 ? (pagos / vermelhos.length) * 100 : 0
    }

    // Transações da rodada
    const transacoes = await Transacao.find({ rodada: id })
      .populate('pagador', 'nome email')
      .populate('recebedor', 'nome email')
      .lean()

    res.json({
      success: true,
      data: {
        ...rodada,
        stats,
        transacoes
      }
    })
  } catch (error) {
    console.error('Erro ao buscar detalhes da rodada:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

// ===========================================
// APROVAR SAQUE (PIX automático)
// ===========================================
exports.aprovarSaque = async (req, res) => {
  try {
    const { id } = req.params
    console.log(`Aprovando saque ID: ${id}`)

    const solicitacao = await SolicitacaoSaque.findById(id)
    if (!solicitacao) {
      return res
        .status(404)
        .json({ success: false, error: 'Solicitacao nao encontrada' })
    }
    if (solicitacao.status !== 'pendente') {
      return res
        .status(400)
        .json({ success: false, error: 'Solicitacao ja foi processada' })
    }

    const usuario = await User.findById(solicitacao.usuario)
    if (!usuario) {
      return res
        .status(404)
        .json({ success: false, error: 'Usuario nao encontrado' })
    }
    if ((usuario.saldoPremio || 0) < solicitacao.valor) {
      return res
        .status(400)
        .json({ success: false, error: 'Saldo insuficiente' })
    }

    let transferId
    try {
      const resultadoPix = await enviarPixSaque(
        solicitacao.valor,
        solicitacao.chavePix,
        solicitacao.tipoChavePix,
        solicitacao._id,
        usuario.nome
      )
      transferId = resultadoPix.transferId
      console.log(`Transferencia PIX autorizada: ${transferId}`)
    } catch (pixError) {
      console.error('Falha no envio do PIX:', pixError.message)
      return res.status(500).json({
        success: false,
        error: `Nao foi possivel realizar o pagamento: ${pixError.message}`
      })
    }

    usuario.saldoPremio -= solicitacao.valor
    usuario.totalSacado = (usuario.totalSacado || 0) + solicitacao.valor
    await usuario.save()

    solicitacao.status = 'aprovado'
    solicitacao.dataAprovacao = new Date()
    solicitacao.aprovadoPor = req.usuarioId
    solicitacao.transferenciaPixId = transferId
    solicitacao.dataEnvioPix = new Date()
    await solicitacao.save()

    if (solicitacao.rodada) {
      await Rodada.findByIdAndUpdate(solicitacao.rodada, {
        premioVerdePago: true
      })
    }

    try {
      const emailController = require('./emailController')
      if (emailController.notificarUsuarioSaqueAprovado) {
        await emailController.notificarUsuarioSaqueAprovado(
          usuario,
          solicitacao
        )
      }
    } catch (emailError) {
      console.error('Erro ao enviar email:', emailError)
    }

    res.json({
      success: true,
      message: `Saque aprovado e PIX enviado para ${solicitacao.chavePix}. Saldo restante: R$ ${usuario.saldoPremio}`
    })
  } catch (error) {
    console.error('Erro ao aprovar saque:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}
