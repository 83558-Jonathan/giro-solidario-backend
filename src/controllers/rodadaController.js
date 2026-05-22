const RodadaService = require('../services/rodadaService')
const User = require('../models/User')
const SolicitacaoSaque = require('../models/SolicitacaoSaque')
const mongoose = require('mongoose')
const Transacao = require('../models/Transacao')
const Rodada = require('../models/Rodada')

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
        .json({ success: false, error: 'Rodada não encontrada' })
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
        .json({ success: false, error: 'usuarioId é obrigatório' })
    const db = mongoose.connection.db
    const rodada = await db
      .collection('rodadas')
      .findOne({ _id: new mongoose.Types.ObjectId(rodadaId) })
    if (!rodada)
      return res
        .status(404)
        .json({ success: false, error: 'Rodada não encontrada' })
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
                  'Não há vagas para vermelhos no momento. Você foi adicionado à fila de espera.',
                data: { aguardandoVermelho: true, fila: true }
              })
          }
          throw error
        }
      } else
        return res
          .status(400)
          .json({ success: false, error: 'Rodada já concluída.' })
    } catch (error) {
      if (error.message.includes('já participa de uma rodada ativa'))
        return res
          .status(400)
          .json({
            success: false,
            error: error.message,
            code: 'USUARIO_JA_EM_RODADA'
          })
      throw error
    }
    res.json({
      success: true,
      message: entrouNaFila
        ? 'Adicionado à fila de espera'
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
    console.error('Erro ao avançar rodada:', error)
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
      message: `Alocação forçada concluída. ${alocados} usuários alocados.`,
      alocados,
      restantes
    })
  } catch (error) {
    console.error('Erro ao forçar alocação:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

exports.getMandala = async (req, res) => {
  try {
    const { rodadaId } = req.params
    if (!mongoose.Types.ObjectId.isValid(rodadaId))
      return res.status(400).json({ success: false, error: 'ID inválido' })
    let rodada = await Rodada.findById(rodadaId)
    if (!rodada)
      return res
        .status(404)
        .json({ success: false, error: 'Rodada não encontrada' })
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
              valor: 150,
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
    console.error('❌ Erro ao carregar mandala:', error)
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

exports.sacarPremio = async (req, res) => {
  try {
    const { rodadaId } = req.params
    const usuarioId = req.usuarioId
    console.log('\n' + '='.repeat(60))
    console.log('💰 [SACAR PRÊMIO] INICIANDO SOLICITAÇÃO')
    console.log('='.repeat(60))
    if (!mongoose.Types.ObjectId.isValid(rodadaId))
      return res
        .status(400)
        .json({ success: false, error: 'ID da rodada inválido' })
    const db = mongoose.connection.db
    const rodada = await db
      .collection('rodadas')
      .findOne({ _id: new mongoose.Types.ObjectId(rodadaId) })
    if (!rodada)
      return res
        .status(404)
        .json({ success: false, error: 'Rodada não encontrada' })
    if (rodada.status !== 'concluida')
      return res
        .status(400)
        .json({ success: false, error: 'Esta rodada ainda não foi concluída' })
    const verdeIdStr = rodada.verde?.toString
      ? rodada.verde.toString()
      : String(rodada.verde)
    const usuarioIdStr = String(usuarioId)
    const ehVerde = verdeIdStr === usuarioIdStr
    const participanteConcluido = rodada.participantes?.find(
      p => p.usuario.toString() === usuarioIdStr && p.cor === 'concluido'
    )
    if (!ehVerde && !participanteConcluido)
      return res
        .status(403)
        .json({
          success: false,
          error: 'Apenas o VERDE ou quem ganhou o prêmio pode solicitá-lo'
        })
    if (rodada.premioVerdePago === true)
      return res
        .status(400)
        .json({
          success: false,
          error: 'Prêmio já foi solicitado anteriormente'
        })
    const usuario = await User.findById(usuarioId)
    if (!usuario)
      return res
        .status(404)
        .json({ success: false, error: 'Usuário não encontrado' })
    const valorSaque = usuario.saldoPremio
    if (valorSaque <= 0)
      return res
        .status(400)
        .json({ success: false, error: 'Saldo insuficiente para saque' })
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
    await db
      .collection('rodadas')
      .updateOne(
        { _id: new mongoose.Types.ObjectId(rodadaId) },
        { $set: { premioVerdePago: true } }
      )
    console.log(
      `💰 Solicitação de saque criada por ${usuario.nome} - Rodada ${rodada.nome}`
    )
    try {
      const emailController = require('./emailController')
      await emailController.notificarAdminNovaSolicitacao(
        usuario,
        rodada,
        valorSaque
      )
    } catch (emailError) {
      console.error('❌ Erro ao notificar admin:', emailError)
    }
    res.json({
      success: true,
      message:
        'Solicitação de saque enviada! Aguarde a aprovação do administrador.',
      solicitacaoId: solicitacao._id
    })
  } catch (error) {
    console.error('\n💥 ERRO AO SOLICITAR SAQUE:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}
