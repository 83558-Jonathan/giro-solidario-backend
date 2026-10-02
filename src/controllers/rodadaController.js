const RodadaService = require('../services/rodadaService')
const User = require('../models/User')
const SolicitacaoSaque = require('../models/SolicitacaoSaque')
const mongoose = require('mongoose')
const Transacao = require('../models/Transacao')
const Rodada = require('../models/Rodada')
const { VALOR_VERMELHO } = require('../config/constantes')

exports.criarRodada = async (req, res) => {
  try {
    const rodada = await RodadaService.criarRodada(req.usuarioId)
    res.status(201).json({ success: true, data: rodada })
  } catch (error) {
    console.error('Erro ao criar rodada:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

exports.listarRodadas = async (req, res) => {
  try {
    const db = mongoose.connection.db
    const rodadasEmAndamento = await db
      .collection('rodadas')
      .find({ status: 'em_andamento' })
      .toArray()
    for (const rodada of rodadasEmAndamento)
      await RodadaService.verificarEAvancarSeNecessario(rodada._id.toString())
    const rodadas = await db
      .collection('rodadas')
      .find({})
      .sort({ numero: -1 })
      .toArray()
    res.json({ success: true, count: rodadas.length, data: rodadas })
  } catch (error) {
    console.error('Erro ao listar rodadas:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

exports.buscarRodadaPorId = async (req, res) => {
  try {
    const db = mongoose.connection.db
    const rodada = await db
      .collection('rodadas')
      .findOne({ _id: new mongoose.Types.ObjectId(req.params.id) })
    if (!rodada)
      return res
        .status(404)
        .json({ success: false, error: 'Rodada nao encontrada' })
    res.json({ success: true, data: rodada })
  } catch (error) {
    console.error('Erro ao buscar rodada:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

exports.adicionarParticipante = async (req, res) => {
  try {
    const { rodadaId } = req.params
    const { usuarioId, indicadorId } = req.body
    if (!usuarioId)
      return res
        .status(400)
        .json({ success: false, error: 'usuarioId e obrigatorio' })
    const db = mongoose.connection.db
    const rodada = await db
      .collection('rodadas')
      .findOne({ _id: new mongoose.Types.ObjectId(rodadaId) })
    if (!rodada)
      return res
        .status(404)
        .json({ success: false, error: 'Rodada nao encontrada' })
    let rodadaAtualizada,
      entrouNaFila = false
    try {
      if (rodada.status === 'aguardando')
        rodadaAtualizada = await RodadaService.adicionarParticipanteAmarelo(
          rodadaId,
          usuarioId,
          indicadorId
        )
      else if (rodada.status === 'em_andamento') {
        try {
          rodadaAtualizada = await RodadaService.adicionarParticipanteVermelho(
            rodadaId,
            usuarioId,
            indicadorId
          )
        } catch (error) {
          if (
            error.message.includes('sem vagas') ||
            error.message.includes('aguardando')
          ) {
            entrouNaFila = true
            const usuario = await User.findById(usuarioId)
            if (usuario?.aguardandoVermelho)
              return res.json({
                success: true,
                message:
                  'Nao ha vagas para vermelhos no momento. Voce foi adicionado a fila de espera.',
                data: { aguardandoVermelho: true, fila: true }
              })
          }
          throw error
        }
      } else
        return res
          .status(400)
          .json({ success: false, error: 'Rodada ja concluida.' })
    } catch (error) {
      if (error.message.includes('ja participa de uma rodada ativa'))
        return res.status(400).json({
          success: false,
          error: error.message,
          code: 'USUARIO_JA_EM_RODADA'
        })
      throw error
    }
    res.json({
      success: true,
      message: entrouNaFila
        ? 'Adicionado a fila de espera'
        : 'Participante adicionado com sucesso',
      data: rodadaAtualizada,
      entrouNaFila
    })
  } catch (error) {
    console.error('Erro ao adicionar participante:', error)
    res.status(400).json({ success: false, error: error.message })
  }
}

exports.iniciarRodada = async (req, res) => {
  try {
    const rodada = await RodadaService.iniciarRodada(req.params.rodadaId)
    res.json({ success: true, data: rodada })
  } catch (error) {
    console.error('Erro ao iniciar rodada:', error)
    res.status(400).json({ success: false, error: error.message })
  }
}

exports.avancarRodada = async (req, res) => {
  try {
    const rodada = await RodadaService.avancarRodada(req.params.rodadaId)
    res.json({ success: true, data: rodada })
  } catch (error) {
    console.error('Erro ao avancar rodada:', error)
    res.status(400).json({ success: false, error: error.message })
  }
}

exports.forcarAlocacaoFila = async (req, res) => {
  try {
    const user = await User.findById(req.usuarioId)
    if (user.role !== 'admin')
      return res.status(403).json({ success: false, error: 'Acesso negado' })
    const alocados = await RodadaService.alocarFilaEmTodasRodadas()
    const restantes = await User.countDocuments({ aguardandoVermelho: true })
    res.json({
      success: true,
      message: `Alocacao forcada concluida. ${alocados} usuarios alocados.`,
      alocados,
      restantes
    })
  } catch (error) {
    console.error('Erro ao forcar alocacao:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

exports.getMandala = async (req, res) => {
  try {
    const { rodadaId } = req.params
    if (!mongoose.Types.ObjectId.isValid(rodadaId))
      return res.status(400).json({ success: false, error: 'ID invalido' })
    let rodada = await Rodada.findById(rodadaId)
    if (!rodada)
      return res
        .status(404)
        .json({ success: false, error: 'Rodada nao encontrada' })
    const podeTerTransacao =
      rodada.status === 'em_andamento' ||
      (rodada.status === 'aguardando' && rodada.verde)
    if (podeTerTransacao && rodada.verde) {
      let modificado = false
      for (const participante of rodada.participantes) {
        if (participante.cor === 'vermelho' && !participante.transacaoId) {
          let transacao = await Transacao.findOne({
            pagador: participante.usuario,
            rodada: rodada._id,
            status: 'pendente'
          })
          if (!transacao) {
            transacao = new Transacao({
              tipo: 'deposito',
              pagador: participante.usuario,
              recebedor: rodada.verde,
              valor: VALOR_VERMELHO,
              rodada: rodada._id,
              status: 'pendente'
            })
            await transacao.save()
          }
          participante.transacaoId = transacao._id
          modificado = true
        }
      }
      if (modificado) {
        rodada.vermelhos = rodada.participantes
          .filter(p => p.cor === 'vermelho')
          .map(p => p.usuario)
        await rodada.save()
      }
    }
    rodada.vermelhos = rodada.participantes
      .filter(p => p.cor === 'vermelho')
      .map(p => p.usuario)
    rodada.azuis = rodada.participantes
      .filter(p => p.cor === 'azul')
      .map(p => p.usuario)
    rodada.pretos = rodada.participantes
      .filter(p => p.cor === 'preto')
      .map(p => p.usuario)
    rodada.verde =
      rodada.participantes.find(p => p.cor === 'verde')?.usuario || null
    const UserModel = require('../models/User')
    const participantesComNomes = []
    for (const p of rodada.participantes) {
      const user = await UserModel.findById(p.usuario).select('nome email')
      participantesComNomes.push({
        ...p.toObject(),
        nome: user?.nome || 'Desconhecido',
        email: user?.email || ''
      })
    }
    const mandala = {
      ...rodada.toObject(),
      participantes: participantesComNomes,
      azuis: rodada.azuis,
      pretos: rodada.pretos,
      vermelhos: rodada.vermelhos,
      verde: rodada.verde
    }
    res.json({ success: true, data: mandala })
  } catch (error) {
    console.error('Erro ao carregar mandala:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

exports.verificarStatusUsuario = async (req, res) => {
  try {
    const status = await RodadaService.verificarStatusUsuario(req.usuarioId)
    res.json({ success: true, data: status })
  } catch (error) {
    console.error('Erro ao verificar status:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

exports.jogarNovamente = async (req, res) => {
  try {
    const result = await RodadaService.jogarNovamente(req.usuarioId)
    const response = { success: true, message: result.message, data: result }
    if (result.cor) response.cor = result.cor
    if (result.aguardando !== undefined) response.aguardando = result.aguardando
    if (result.rodadaId) response.rodadaId = result.rodadaId
    if (result.pagoAutomaticamente !== undefined)
      response.pagoAutomaticamente = result.pagoAutomaticamente
    if (result.saldoRestante !== undefined)
      response.saldoRestante = result.saldoRestante
    res.json(response)
  } catch (error) {
    console.error('Erro ao jogar novamente:', error)
    res.status(400).json({ success: false, error: error.message })
  }
}

// ===========================================
// SACAR PREMIO — vinculado a uma rodada
// ===========================================
exports.sacarPremio = async (req, res) => {
  try {
    const { rodadaId } = req.params
    const usuarioId = req.usuarioId
    console.log('\n' + '='.repeat(60))
    console.log('SACAR PREMIO - INICIANDO SOLICITACAO')
    console.log('='.repeat(60))

    if (!mongoose.Types.ObjectId.isValid(rodadaId)) {
      return res
        .status(400)
        .json({ success: false, error: 'ID da rodada invalido' })
    }

    const usuario = await User.findById(usuarioId)
    if (!usuario) {
      return res
        .status(404)
        .json({ success: false, error: 'Usuario nao encontrado' })
    }

    if (!usuario.chavePix || !usuario.tipoChavePix) {
      return res.status(400).json({
        success: false,
        error: 'Cadastre sua chave PIX antes de solicitar o saque.',
        codigo: 'SEM_CHAVE_PIX'
      })
    }

    const jaPendente = await SolicitacaoSaque.findOne({
      usuario: usuarioId,
      status: 'pendente'
    })
    if (jaPendente) {
      return res.status(400).json({
        success: false,
        error: 'Voce ja tem uma solicitacao de saque pendente.',
        codigo: 'SAQUE_PENDENTE',
        solicitacaoId: jaPendente._id
      })
    }

    const rodada = await Rodada.findOneAndUpdate(
      {
        _id: rodadaId,
        status: 'concluida',
        premioVerdePago: { $ne: true },
        $or: [
          { verde: usuarioId },
          {
            participantes: {
              $elemMatch: { usuario: usuarioId, cor: 'concluido' }
            }
          }
        ]
      },
      { $set: { premioVerdePago: true } },
      { new: true }
    )

    if (!rodada) {
      const rodadaCheck = await Rodada.findById(rodadaId)
      if (!rodadaCheck) {
        return res
          .status(404)
          .json({ success: false, error: 'Rodada nao encontrada' })
      }
      if (rodadaCheck.status !== 'concluida') {
        return res
          .status(400)
          .json({
            success: false,
            error: 'Esta rodada ainda nao foi concluida'
          })
      }
      if (rodadaCheck.premioVerdePago === true) {
        return res.status(400).json({
          success: false,
          error: 'Premio ja foi solicitado anteriormente'
        })
      }
      return res.status(403).json({
        success: false,
        error: 'Apenas o VERDE ou quem ganhou o premio pode solicita-lo'
      })
    }

    console.log(`Lock adquirido por ${usuario.nome} - Rodada ${rodada.nome}`)

    const valorSaque = usuario.saldoPremio
    if (valorSaque < 100) {
      await Rodada.updateOne(
        { _id: rodadaId },
        { $set: { premioVerdePago: false } }
      )
      return res.status(400).json({
        success: false,
        error: `Saldo minimo para saque e R$ 100,00. Voce tem R$ ${valorSaque.toFixed(
          2
        )}.`,
        codigo: 'SALDO_INSUFICIENTE'
      })
    }

    const solicitacao = new SolicitacaoSaque({
      usuario: usuarioId,
      rodada: rodadaId,
      valor: valorSaque,
      chavePix: usuario.chavePix,
      tipoChavePix: usuario.tipoChavePix,
      status: 'pendente',
      dataSolicitacao: new Date()
    })
    await solicitacao.save()

    console.log(
      `Solicitacao de saque criada por ${usuario.nome} - Rodada ${rodada.nome}`
    )

    try {
      const emailController = require('./emailController')
      await emailController.notificarAdminNovaSolicitacao(
        usuario,
        rodada,
        valorSaque
      )
    } catch (emailError) {
      console.error('Erro ao notificar admin:', emailError)
    }

    res.json({
      success: true,
      message:
        'Solicitacao de saque enviada! Aguarde a aprovacao do administrador.',
      solicitacaoId: solicitacao._id
    })
  } catch (error) {
    console.error('ERRO AO SOLICITAR SAQUE:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

// ===========================================
// SACAR SALDO (premios + comissoes) — sem rodada especifica
// ===========================================
exports.sacarSaldo = async (req, res) => {
  try {
    const usuarioId = req.usuarioId
    console.log('\n' + '='.repeat(60))
    console.log('SACAR SALDO - INICIANDO SOLICITACAO')
    console.log('='.repeat(60))

    const usuario = await User.findById(usuarioId)
    if (!usuario) {
      return res
        .status(404)
        .json({ success: false, error: 'Usuario nao encontrado' })
    }

    if (!usuario.chavePix || !usuario.tipoChavePix) {
      return res.status(400).json({
        success: false,
        error: 'Cadastre sua chave PIX antes de solicitar o saque.',
        codigo: 'SEM_CHAVE_PIX'
      })
    }

    const saldoDisponivel = Number(usuario.saldoPremio) || 0
    if (saldoDisponivel < 100) {
      return res.status(400).json({
        success: false,
        error: `Saldo minimo para saque e R$ 100,00. Voce tem R$ ${saldoDisponivel.toFixed(
          2
        )}.`,
        codigo: 'SALDO_INSUFICIENTE',
        saldoDisponivel,
        minimo: 100
      })
    }

    const jaPendente = await SolicitacaoSaque.findOne({
      usuario: usuarioId,
      status: 'pendente'
    })
    if (jaPendente) {
      return res.status(400).json({
        success: false,
        error: 'Voce ja tem uma solicitacao de saque pendente.',
        codigo: 'SAQUE_PENDENTE',
        solicitacaoId: jaPendente._id
      })
    }

    const solicitacao = new SolicitacaoSaque({
      usuario: usuarioId,
      rodada: null,
      valor: saldoDisponivel,
      chavePix: usuario.chavePix,
      tipoChavePix: usuario.tipoChavePix,
      status: 'pendente',
      dataSolicitacao: new Date(),
      observacao: 'Saque de saldo acumulado (premios + comissoes)'
    })
    await solicitacao.save()

    console.log(
      `Solicitacao ${solicitacao._id} criada - R$ ${saldoDisponivel} para ${usuario.nome}`
    )

    try {
      const emailController = require('./emailController')
      if (typeof emailController.notificarAdminNovaSolicitacao === 'function') {
        await emailController.notificarAdminNovaSolicitacao(
          usuario,
          { nome: 'Saldo acumulado' },
          saldoDisponivel
        )
      }
    } catch (emailError) {
      console.error('Erro ao notificar admin:', emailError.message)
    }

    res.json({
      success: true,
      message: `Solicitacao de saque de R$ ${saldoDisponivel.toFixed(
        2
      )} enviada! Aguarde aprovacao.`,
      solicitacaoId: solicitacao._id,
      valor: saldoDisponivel
    })
  } catch (error) {
    console.error('ERRO AO SOLICITAR SAQUE DE SALDO:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

// ===========================================
// Rodadas prestes a girar (7/8 ou 8/8 pagos)
// ===========================================
exports.rodadasEmGiro = async (req, res) => {
  try {
    const rodadas = await Rodada.find({ status: 'em_andamento' })
      .select(
        '_id numero nome participantes.cor participantes.depositoConfirmado'
      )
      .lean()

    const emGiro = rodadas
      .map(r => {
        const vermelhos = r.participantes.filter(p => p.cor === 'vermelho')
        const pagos = vermelhos.filter(v => v.depositoConfirmado).length
        return {
          _id: r._id,
          numero: r.numero,
          nome: r.nome,
          pagos,
          total: vermelhos.length,
          faltam: Math.max(0, vermelhos.length - pagos)
        }
      })
      .filter(r => r.total === 8 && r.faltam > 0 && r.faltam <= 2)
      .sort((a, b) => a.faltam - b.faltam || a.numero - b.numero)

    res.json({
      success: true,
      data: {
        total: emGiro.length,
        rodadas: emGiro.slice(0, 5)
      }
    })
  } catch (error) {
    console.error('[rodadasEmGiro]', error.message)
    res.status(500).json({ success: false, error: 'Erro ao carregar' })
  }
}
