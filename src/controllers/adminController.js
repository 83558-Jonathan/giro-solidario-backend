const User = require('../models/User')
const Rodada = require('../models/Rodada')
const Transacao = require('../models/Transacao')
const SolicitacaoSaque = require('../models/SolicitacaoSaque')
const Comissao = require('../models/Comissao')
const { enviarPixSaque } = require('./pixController')
const { PREMIO_VERDE } = require('../config/constantes')
const mongoose = require('mongoose')

// ===========================================
// ESTATISTICAS GERAIS (enriquecido)
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

    // NOVO: breakdown de comissões por tipo
    const comissoesPorTipo = await Comissao.aggregate([
      {
        $group: {
          _id: '$tipo',
          total: { $sum: '$valor' },
          count: { $sum: 1 }
        }
      }
    ])
    const comissoesUnicas =
      comissoesPorTipo.find(c => c._id === 'unica')?.total || 0
    const comissoesRecorrentes =
      comissoesPorTipo.find(c => c._id === 'recorrente')?.total || 0

    // NOVO: volume total transacionado
    const totalTransacionadoAgg = await Transacao.aggregate([
      { $match: { status: 'confirmado' } },
      { $group: { _id: null, total: { $sum: '$valor' } } }
    ])
    const totalTransacionado = totalTransacionadoAgg[0]?.total || 0

    // AUDITORIA: pendencias criticas
    const quinzeMinAtras = new Date(Date.now() - 15 * 60 * 1000)
    const umDiaAtras = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const transacoesPendentesAntigas = await Transacao.countDocuments({
      status: 'pendente',
      createdAt: { $lt: quinzeMinAtras }
    })
    const saquesPendentesAntigos = await SolicitacaoSaque.countDocuments({
      status: 'pendente',
      dataSolicitacao: { $lt: umDiaAtras }
    })

    res.json({
      success: true,
      data: {
        usuarios: totalUsuarios,
        usuariosNaFila,
        saldoTotalUsuarios: saldoTotal,
        totalComissoesPagas: totalComissoesPagas[0]?.total || 0,
        totalTransacionado,
        comissoes: {
          unicas: comissoesUnicas,
          recorrentes: comissoesRecorrentes,
          total: comissoesUnicas + comissoesRecorrentes
        },
        rodadas: {
          total: rodadasAtivas + rodadasAguardando + rodadasConcluidas,
          ativas: rodadasAtivas,
          aguardando: rodadasAguardando,
          concluidas: rodadasConcluidas
        },
        saques: {
          pendentes: saquesPendentes,
          pendentesAntigos: saquesPendentesAntigos,
          totalSolicitado,
          totalPago
        },
        transacoes: {
          confirmadas: transacoesConfirmadas,
          pendentesAntigas: transacoesPendentesAntigas
        }
      }
    })
  } catch (error) {
    console.error('Erro ao buscar estatisticas:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

// ===========================================
// LISTA COMPLETA DE USUARIOS (com estatisticas + comissoes)
// ===========================================
exports.getUsuariosCompletos = async (req, res) => {
  try {
    const usuarios = await User.find()
      .select('-senha -resetPasswordToken -resetPasswordExpires')
      .populate('indicadoPor', 'nome email codigoConvite')
      .populate('meusIndicados', 'nome email createdAt')
      .sort({ createdAt: -1 })
      .lean()

    const todasRodadas = await Rodada.find({
      'participantes.usuario': { $in: usuarios.map(u => u._id) }
    })
      .select('nome numero status participantes')
      .lean()

    const apostasPorUsuario = await Transacao.aggregate([
      {
        $match: {
          status: 'confirmado',
          pagador: { $in: usuarios.map(u => u._id) }
        }
      },
      { $group: { _id: '$pagador', total: { $sum: '$valor' } } }
    ])
    const mapaApostas = new Map(
      apostasPorUsuario.map(a => [a._id.toString(), a.total])
    )

    const recebidosPorUsuario = await Transacao.aggregate([
      {
        $match: {
          status: 'confirmado',
          recebedor: { $in: usuarios.map(u => u._id) }
        }
      },
      { $group: { _id: '$recebedor', total: { $sum: '$valor' } } }
    ])
    const mapaRecebidos = new Map(
      recebidosPorUsuario.map(r => [r._id.toString(), r.total])
    )

    const comissoesPorUsuario = await Comissao.aggregate([
      { $match: { indicador: { $in: usuarios.map(u => u._id) } } },
      {
        $group: {
          _id: '$indicador',
          total: { $sum: 1 },
          valor: { $sum: '$valor' },
          unicas: { $sum: { $cond: [{ $eq: ['$tipo', 'unica'] }, 1, 0] } },
          recorrentes: {
            $sum: { $cond: [{ $eq: ['$tipo', 'recorrente'] }, 1, 0] }
          }
        }
      }
    ])
    const mapaComissoes = new Map(
      comissoesPorUsuario.map(c => [
        c._id.toString(),
        {
          total: c.total,
          valor: c.valor,
          unicas: c.unicas,
          recorrentes: c.recorrentes
        }
      ])
    )

    const usuariosCompletos = usuarios.map(u => {
      const uid = u._id.toString()
      const rodadasDoUsuario = todasRodadas.filter(r =>
        r.participantes.some(p => p.usuario.toString() === uid)
      )
      const rodadasJogadas = rodadasDoUsuario.length
      const rodadasVencidas = rodadasDoUsuario.filter(r =>
        r.participantes.some(
          p => p.usuario.toString() === uid && p.cor === 'concluido'
        )
      ).length
      const rodadaAtiva = rodadasDoUsuario.find(r =>
        ['aguardando', 'em_andamento'].includes(r.status)
      )
      const participanteAtivo = rodadaAtiva?.participantes.find(
        p => p.usuario.toString() === uid
      )

      return {
        ...u,
        estatisticas: {
          rodadasJogadas,
          rodadasVencidas,
          totalIndicacoes: (u.meusIndicados || []).length,
          totalApostado: mapaApostas.get(uid) || 0,
          totalRecebido: mapaRecebidos.get(uid) || 0,
          comissoes: mapaComissoes.get(uid) || {
            total: 0,
            valor: 0,
            unicas: 0,
            recorrentes: 0
          },
          rodadaAtiva: rodadaAtiva
            ? {
                id: rodadaAtiva._id,
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

    res.json({
      success: true,
      count: usuariosCompletos.length,
      data: usuariosCompletos
    })
  } catch (error) {
    console.error('Erro ao buscar usuarios completos:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

// ===========================================
// DETALHE DE UM USUARIO (auditoria completa)
// ===========================================
exports.getUsuarioDetalhe = async (req, res) => {
  try {
    const { id } = req.params
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'ID invalido' })
    }

    const usuario = await User.findById(id)
      .select('-senha -resetPasswordToken -resetPasswordExpires')
      .populate('indicadoPor', 'nome email codigoConvite')
      .populate(
        'meusIndicados',
        'nome email createdAt saldoPremio totalGanho isInfluenciador'
      )
      .lean()

    if (!usuario) {
      return res
        .status(404)
        .json({ success: false, error: 'Usuario nao encontrado' })
    }

    const rodadas = await Rodada.find({ 'participantes.usuario': id })
      .select(
        'nome numero status participantes verde pretos azuis vermelhos createdAt dataInicio dataFim premioVerdePago'
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
        dataDeposito: p?.dataDeposito,
        transacaoId: p?.transacaoId,
        indicadoPor: p?.indicadoPor,
        comissaoPaga: p?.comissaoPaga,
        createdAt: r.createdAt,
        dataFim: r.dataFim,
        premioVerdePago: r.premioVerdePago
      }
    })

    const transacoes = await Transacao.find({
      $or: [{ pagador: id }, { recebedor: id }]
    })
      .populate('pagador', 'nome email')
      .populate('recebedor', 'nome email')
      .populate('rodada', 'nome numero')
      .sort({ createdAt: -1 })
      .lean()

    const saques = await SolicitacaoSaque.find({ usuario: id })
      .populate('rodada', 'nome numero')
      .sort({ dataSolicitacao: -1 })
      .lean()

    const comissoes = await Comissao.find({ indicador: id })
      .populate('indicado', 'nome email')
      .populate('rodada', 'nome numero')
      .sort({ createdAt: -1 })
      .lean()

    // Resumo financeiro
    const saldoPremio = Number(usuario.saldoPremio) || 0
    const totalGanho = Number(usuario.totalGanho) || 0
    const totalSacado = Number(usuario.totalSacado) || 0
    const totalComissao = Number(usuario.totalComissao) || 0
    const totalApostado = transacoes
      .filter(
        t => t.pagador?._id?.toString() === id && t.status === 'confirmado'
      )
      .reduce((a, t) => a + (t.valor || 0), 0)
    const totalRecebido = transacoes
      .filter(
        t => t.recebedor?._id?.toString() === id && t.status === 'confirmado'
      )
      .reduce((a, t) => a + (t.valor || 0), 0)

    res.json({
      success: true,
      data: {
        usuario,
        historicoRodadas,
        transacoes,
        saques,
        comissoes,
        resumo: {
          saldoPremio,
          totalGanho,
          totalSacado,
          totalComissao,
          totalApostado,
          totalRecebido,
          saldoConsolidado: saldoPremio + totalSacado
        }
      }
    })
  } catch (error) {
    console.error('Erro ao buscar detalhe do usuario:', error)
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
// HISTORICO DE SAQUES
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
// DETALHE DE RODADA (AUDITORIA COMPLETA)
// ===========================================
exports.getRodadaDetalhes = async (req, res) => {
  try {
    const { id } = req.params
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'ID invalido' })
    }

    const rodada = await Rodada.findById(id)
      .populate(
        'participantes.usuario',
        'nome email telefone cpf chavePix tipoChavePix saldoPremio totalGanho totalSacado isInfluenciador totalIndicacoes meusIndicados indicadoPor createdAt'
      )
      .populate('verde', 'nome email cpf chavePix')
      .populate('pretos', 'nome email cpf')
      .populate('azuis', 'nome email cpf')
      .populate('vermelhos', 'nome email cpf')
      .populate('rodadasGeradas', 'nome numero status')
      .populate('rodadaOrigem', 'nome numero status')
      .lean()

    if (!rodada) {
      return res
        .status(404)
        .json({ success: false, error: 'Rodada nao encontrada' })
    }

    const participantes = rodada.participantes || []
    const vermelhos = participantes.filter(p => p.cor === 'vermelho')
    const pagos = vermelhos.filter(v => v.depositoConfirmado).length
    const pendentes = vermelhos.filter(v => !v.depositoConfirmado)

    // TRANSACOES
    const transacoes = await Transacao.find({ rodada: id })
      .populate('pagador', 'nome email cpf chavePix')
      .populate('recebedor', 'nome email cpf chavePix')
      .sort({ createdAt: -1 })
      .lean()

    const confirmadas = transacoes.filter(t => t.status === 'confirmado')
    const transacoesPendentes = transacoes.filter(t => t.status === 'pendente')
    const totalArrecadado = confirmadas.reduce((a, t) => a + (t.valor || 0), 0)
    const totalPendente = transacoesPendentes.reduce(
      (a, t) => a + (t.valor || 0),
      0
    )

    // COMISSOES
    const comissoes = await Comissao.find({ rodada: id })
      .populate('indicador', 'nome email isInfluenciador')
      .populate('indicado', 'nome email')
      .sort({ createdAt: -1 })
      .lean()
    const totalComissoes = comissoes.reduce((a, c) => a + (c.valor || 0), 0)

    // GANHADOR
    const ganhador = participantes.find(p => p.cor === 'concluido')

    // PREMIO
    const premioVerde = rodada.status === 'concluida' ? PREMIO_VERDE : 0
    const margem = totalArrecadado - premioVerde - totalComissoes

    // STATS DE CORES
    const stats = {
      totalParticipantes: participantes.length,
      verde: participantes.filter(p => p.cor === 'verde').length,
      preto: participantes.filter(p => p.cor === 'preto').length,
      azul: participantes.filter(p => p.cor === 'azul').length,
      vermelho: vermelhos.length,
      amarelo: participantes.filter(p => p.cor === 'amarelo').length,
      concluido: participantes.filter(p => p.cor === 'concluido').length,
      pagamentosConfirmados: pagos,
      pagamentosPendentes: pendentes.length,
      percentualConcluido:
        vermelhos.length > 0 ? (pagos / vermelhos.length) * 100 : 0
    }

    // FINANCEIRO
    const financeiro = {
      totalArrecadado,
      totalPendente,
      totalComissoes,
      premioVerde,
      margem,
      transacoesConfirmadas: confirmadas.length,
      transacoesPendentes: transacoesPendentes.length
    }

    // PENDENTES COM DETALHES
    const pendentesDetalhes = pendentes.map(p => ({
      usuarioId: p.usuario?._id,
      nome: p.usuario?.nome,
      email: p.usuario?.email,
      cpf: p.usuario?.cpf,
      chavePix: p.usuario?.chavePix,
      dataEntrada: p.dataEntrada,
      transacaoId: p.transacaoId,
      indicadoPor: p.indicadoPor
    }))

    res.json({
      success: true,
      data: {
        ...rodada,
        stats,
        financeiro,
        transacoes,
        comissoes,
        pendentesDetalhes,
        ganhador: ganhador
          ? {
              usuarioId: ganhador.usuario?._id,
              nome: ganhador.usuario?.nome,
              email: ganhador.usuario?.email,
              cpf: ganhador.usuario?.cpf,
              chavePix: ganhador.usuario?.chavePix,
              depositoConfirmado: ganhador.depositoConfirmado
            }
          : null
      }
    })
  } catch (error) {
    console.error('Erro ao buscar detalhes da rodada:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

// ===========================================
// NOVO: LISTAGEM DE RODADAS (admin, com stats inline)
// ===========================================
exports.getRodadasAdmin = async (req, res) => {
  try {
    const { status, limit = 100 } = req.query

    const filter = {}
    if (
      status &&
      ['aguardando', 'em_andamento', 'concluida'].includes(status)
    ) {
      filter.status = status
    }

    const rodadas = await Rodada.find(filter)
      .select('-__v')
      .sort({ numero: -1, createdAt: -1 })
      .limit(parseInt(limit))
      .lean()

    const rodadasComStats = rodadas.map(r => {
      const participantes = r.participantes || []
      const vermelhos = participantes.filter(p => p.cor === 'vermelho')
      const pagos = vermelhos.filter(p => p.depositoConfirmado)

      return {
        _id: r._id,
        nome: r.nome,
        numero: r.numero,
        status: r.status,
        createdAt: r.createdAt,
        dataInicio: r.dataInicio,
        dataFim: r.dataFim,
        premioVerdePago: r.premioVerdePago,
        rodadaOrigem: r.rodadaOrigem,
        rodadasGeradas: r.rodadasGeradas,
        formacao: {
          verde: participantes.filter(p => p.cor === 'verde').length,
          preto: participantes.filter(p => p.cor === 'preto').length,
          azul: participantes.filter(p => p.cor === 'azul').length,
          vermelho: vermelhos.length,
          concluido: participantes.filter(p => p.cor === 'concluido').length,
          total: participantes.length
        },
        pagamentos: {
          confirmados: pagos.length,
          pendentes: vermelhos.length - pagos.length,
          total: vermelhos.length,
          percentual:
            vermelhos.length > 0 ? (pagos.length / vermelhos.length) * 100 : 0
        }
      }
    })

    res.json({
      success: true,
      count: rodadasComStats.length,
      data: rodadasComStats
    })
  } catch (error) {
    console.error('[ADMIN][RODADAS] Erro:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

// ===========================================
// APROVAR SAQUE (PIX automatico)
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

// ===========================================
// MARCAR/DESMARCAR INFLUENCIADOR
// ===========================================
exports.setInfluenciador = async (req, res) => {
  try {
    const { id } = req.params
    const { isInfluenciador } = req.body

    if (typeof isInfluenciador !== 'boolean') {
      return res
        .status(400)
        .json({ success: false, error: 'isInfluenciador deve ser boolean' })
    }
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'ID invalido' })
    }

    const usuario = await User.findById(id)
    if (!usuario) {
      return res
        .status(404)
        .json({ success: false, error: 'Usuario nao encontrado' })
    }

    const eraInfluenciador = usuario.isInfluenciador === true

    if (isInfluenciador && !usuario.dataInfluenciador) {
      usuario.dataInfluenciador = new Date()
      console.log(
        `[ADMIN][INFLUENCIADOR] ${
          usuario.nome
        } virou influenciador em ${usuario.dataInfluenciador.toISOString()}`
      )
    }

    usuario.isInfluenciador = isInfluenciador
    await usuario.save()

    console.log(
      `[ADMIN][INFLUENCIADOR] ${usuario.nome} ${
        isInfluenciador
          ? eraInfluenciador
            ? 'reativado'
            : 'MARCADO'
          : 'DESMARCADO'
      } como influenciador`
    )

    res.json({
      success: true,
      message: `Usuario ${
        isInfluenciador ? 'marcado' : 'desmarcado'
      } como influenciador`,
      data: {
        id: usuario._id,
        nome: usuario.nome,
        isInfluenciador: usuario.isInfluenciador,
        dataInfluenciador: usuario.dataInfluenciador
      }
    })
  } catch (error) {
    console.error('[ADMIN][INFLUENCIADOR] Erro:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

// ===========================================
// LISTAR COMISSOES (com filtros)
// ===========================================
exports.getComissoes = async (req, res) => {
  try {
    const { indicadorId, tipo, from, to, limit = 200 } = req.query

    const filter = {}
    if (indicadorId && mongoose.Types.ObjectId.isValid(indicadorId)) {
      filter.indicador = indicadorId
    }
    if (tipo && ['unica', 'recorrente'].includes(tipo)) {
      filter.tipo = tipo
    }
    if (from || to) {
      filter.createdAt = {}
      if (from) filter.createdAt.$gte = new Date(from)
      if (to) filter.createdAt.$lte = new Date(to)
    }

    const comissoes = await Comissao.find(filter)
      .populate('indicador', 'nome email isInfluenciador')
      .populate('indicado', 'nome email')
      .populate('rodada', 'nome numero')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .lean()

    const totais = await Comissao.aggregate([
      { $match: filter },
      {
        $group: {
          _id: '$tipo',
          count: { $sum: 1 },
          total: { $sum: '$valor' }
        }
      }
    ])

    res.json({
      success: true,
      count: comissoes.length,
      totais,
      data: comissoes
    })
  } catch (error) {
    console.error('[ADMIN][COMISSOES] Erro:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

// ===========================================
// COMISSOES DE UM USUARIO ESPECIFICO
// ===========================================
exports.getComissoesUsuario = async (req, res) => {
  try {
    const { id } = req.params
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'ID invalido' })
    }

    const [comissoes, totais] = await Promise.all([
      Comissao.find({ indicador: id })
        .populate('indicado', 'nome email')
        .populate('rodada', 'nome numero')
        .sort({ createdAt: -1 })
        .lean(),
      Comissao.aggregate([
        { $match: { indicador: new mongoose.Types.ObjectId(id) } },
        {
          $group: {
            _id: '$tipo',
            count: { $sum: 1 },
            total: { $sum: '$valor' }
          }
        }
      ])
    ])

    res.json({
      success: true,
      count: comissoes.length,
      totais,
      data: comissoes
    })
  } catch (error) {
    console.error('[ADMIN][COMISSOES-USUARIO] Erro:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}
