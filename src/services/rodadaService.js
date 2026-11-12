const Rodada = require('../models/Rodada')
const User = require('../models/User')
const Transacao = require('../models/Transacao')
const ChatMessage = require('../models/ChatMessage')
const { gerarQrCodeParaTransacao } = require('../utils/qrCodeHelper')
const {
  VALOR_VERMELHO,
  PREMIO_VERDE,
  VALOR_VERMELHO_TEXTO,
  PREMIO_VERDE_TEXTO,
  COMISSAO_INDICACAO
} = require('../config/constantes')
const pushService = require('./pushService')
const activityService = require('./activityService')
const notificationService = require('./notificationService')
const badgeService = require('./badgeService')
const emailController = require('../controllers/emailController')
const comissaoService = require('./comissaoService')
const pagamentosProcessadosService = new Map()
const processandoRodadas = new Map()
let alocandoFila = false
const processandoTransacoesVemelhos = new Map()

let ioInstance = null
const processandoVermelhoLock = new Map()

function rodadaTemEstruturaCompleta (rodada) {
  const verdeOk = !!rodada.verde
  const pretosOk = Array.isArray(rodada.pretos) && rodada.pretos.length === 2
  const azuisOk = Array.isArray(rodada.azuis) && rodada.azuis.length === 4

  console.log(`[rodadaTemEstruturaCompleta] Rodada: ${rodada?.nome || '?'}`)
  console.log(`   verde: ${rodada.verde} -> ${verdeOk ? 'OK' : 'FALHA'}`)
  console.log(
    `   pretos: ${rodada.pretos?.length || 0} -> ${pretosOk ? 'OK' : 'FALHA'}`
  )
  console.log(
    `   azuis: ${rodada.azuis?.length || 0} -> ${azuisOk ? 'OK' : 'FALHA'}`
  )

  const resultado = verdeOk && pretosOk && azuisOk
  console.log(`   Resultado: ${resultado ? 'SIM' : 'NAO'}`)
  return resultado
}

async function notificarPromocao ({ usuarioId, corAnterior, corNova, rodada }) {
  try {
    const u = await User.findById(usuarioId).select('nome email')
    if (!u) return

    let templatePush = null
    let mensagemInApp = null
    let iconeInApp = null
    let tipoNotif = 'rodada_avancou'
    let tituloNotif = 'Sua nova posicao'

    switch (corNova) {
      case 'azul':
        mensagemInApp =
          'Voce subiu para AZUL! Convide 2 amigos pra virar PRETO.'
        iconeInApp = '🔵'
        tituloNotif = 'Voce e AZUL!'
        break
      case 'preto':
        mensagemInApp = 'Voce subiu para PRETO! Continue firme.'
        iconeInApp = '⚫'
        tituloNotif = 'Voce e PRETO!'
        break
      case 'verde':
        templatePush = pushService.templates.voceEVerde(PREMIO_VERDE)
        mensagemInApp = `Voce e o VERDE! Aguarde os pagamentos pra receber ${PREMIO_VERDE_TEXTO}.`
        iconeInApp = '🟢'
        tipoNotif = 'voce_e_verde'
        tituloNotif = 'Voce e o VERDE!'
        break
      case 'concluido':
        templatePush = pushService.templates.premioLiberado(PREMIO_VERDE)
        mensagemInApp = `Parabens! ${PREMIO_VERDE_TEXTO} ja estao no seu saldo.`
        iconeInApp = '🏆'
        tipoNotif = 'premio_liberado'
        tituloNotif = 'Premio liberado!'
        break
    }

    if (templatePush) {
      pushService
        .enviarParaUsuario(u._id, templatePush)
        .catch(err => console.error('[push] notificarPromocao:', err.message))
    }

    if (mensagemInApp) {
      notificationService
        .criar({
          usuario: u._id,
          tipo: tipoNotif,
          titulo: tituloNotif,
          mensagem: mensagemInApp,
          icone: iconeInApp
        })
        .catch(err => console.error('[notif] notificarPromocao:', err.message))
    }

    emailController
      .enviarEmailRodadaAvancada(u, rodada, corNova, corAnterior)
      .catch(err => console.error('[email] notificarPromocao:', err.message))

    if (corNova === 'concluido') {
      emailController
        .enviarEmailPremio(u, rodada, PREMIO_VERDE)
        .catch(err => console.error('[email] premio:', err.message))

      badgeService
        .verificarAposVitoria(u._id)
        .catch(err => console.error('[badge] vitoria:', err.message))

      activityService
        .premio(u._id, u.nome, rodada._id, PREMIO_VERDE)
        .catch(err => console.error('[activity] premio:', err.message))
    } else {
      activityService
        .rodadaAvancou(u._id, u.nome, rodada._id, rodada.nome)
        .catch(() => {})
    }
  } catch (err) {
    console.error('[notificarPromocao] erro:', err.message)
  }
}

class RodadaService {
  async criarRodada (criadorId) {
    try {
      const ultimaRodada = await Rodada.findOne().sort({ numero: -1 })
      const novoNumero = ultimaRodada ? ultimaRodada.numero + 1 : 1

      const criador = await User.findById(criadorId)
      if (!criador) throw new Error('Criador nao encontrado')

      const rodada = new Rodada({
        numero: novoNumero,
        nome: `Rodada #${novoNumero}`,
        status: 'aguardando',
        participantes: [
          {
            usuario: criadorId,
            cor: 'amarelo',
            posicao: 1,
            dataEntrada: new Date(),
            depositoConfirmado: false
          }
        ],
        totalDepositosConfirmados: 0,
        todosDepositaram: false,
        historicoMovimentacoes: []
      })

      await rodada.save()
      console.log(
        `Rodada ${rodada.nome} criada com sucesso por ${criador.nome}`
      )
      return rodada
    } catch (error) {
      console.error('Erro ao criar rodada:', error)
      throw error
    }
  }

  async usuarioEstaEmRodadaAtiva (usuarioId) {
    try {
      const usuarioIdStr = usuarioId.toString()
      const rodadaAtiva = await Rodada.findOne({
        status: { $in: ['aguardando', 'em_andamento'] },
        participantes: {
          $elemMatch: { usuario: usuarioId, cor: { $ne: 'concluido' } }
        }
      })

      if (rodadaAtiva) {
        return true
      }
      return false
    } catch (error) {
      console.error('Erro ao verificar rodada ativa:', error)
      return false
    }
  }

  // ===========================================
  // [NOVA FUNÇÃO] Busca a rodada mais cheia com vaga para vermelho
  // ===========================================
  async buscarRodadaMaisCheiaComVaga () {
    try {
      const result = await Rodada.aggregate([
        {
          $match: {
            status: { $in: ['em_andamento', 'aguardando'] },
            verde: { $exists: true, $ne: null },
            pretos: { $exists: true, $ne: [] },
            azuis: { $exists: true, $ne: [] }
          }
        },
        {
          $addFields: {
            totalParticipantes: { $size: '$participantes' },
            totalVermelhos: {
              $size: {
                $filter: {
                  input: '$participantes',
                  as: 'p',
                  cond: { $eq: ['$$p.cor', 'vermelho'] }
                }
              }
            }
          }
        },
        { $match: { totalVermelhos: { $lt: 8 } } },
        { $sort: { totalParticipantes: -1, createdAt: 1 } },
        { $limit: 1 }
      ])

      if (result.length > 0) {
        return await Rodada.findById(result[0]._id)
      }
      return null
    } catch (error) {
      console.error('[buscarRodadaMaisCheiaComVaga] Erro:', error)
      return null
    }
  }

  async adicionarParticipanteAmarelo (rodadaId, usuarioId, indicadorId = null) {
    try {
      const estaEmRodadaAtiva = await this.usuarioEstaEmRodadaAtiva(usuarioId)
      if (estaEmRodadaAtiva) {
        throw new Error(
          'Usuario ja participa de uma rodada ativa. Aguarde a conclusao para entrar em outra.'
        )
      }

      const rodada = await Rodada.findById(rodadaId)
      if (!rodada) throw new Error('Rodada nao encontrada')

      if (rodada.status !== 'aguardando') {
        throw new Error(
          'So e possivel adicionar participantes em rodadas que ainda nao iniciaram'
        )
      }

      if (rodada.participantes.length >= 15) {
        throw new Error('Rodada ja esta completa (15 participantes)')
      }

      const existe = rodada.participantes.find(
        p => p.usuario.toString() === usuarioId
      )
      if (existe) throw new Error('Usuario ja esta nesta rodada')

      const usuario = await User.findById(usuarioId)
      if (!usuario) throw new Error('Usuario nao encontrado')

      rodada.participantes.push({
        usuario: usuarioId,
        cor: 'amarelo',
        posicao: rodada.participantes.length + 1,
        dataEntrada: new Date(),
        depositoConfirmado: false,
        indicadoPor: indicadorId || null
      })

      if (indicadorId) {
        await User.findByIdAndUpdate(usuarioId, { indicadoPor: indicadorId })
        await User.findByIdAndUpdate(indicadorId, {
          $inc: { totalIndicacoes: 1 },
          $push: { meusIndicados: usuarioId }
        })
      }

      await rodada.save()

      if (rodada.participantes.length === 15) {
        await this.iniciarRodada(rodadaId)
      }

      return rodada
    } catch (error) {
      console.error('Erro ao adicionar participante amarelo:', error)
      throw error
    }
  }

  async adicionarParticipanteVermelho (rodadaId, usuarioId, indicadorId = null) {
    const lockKey = `${rodadaId}_${usuarioId}`
    while (processandoVermelhoLock.has(lockKey)) {
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    processandoVermelhoLock.set(lockKey, Date.now())

    try {
      const estaEmRodadaAtiva = await this.usuarioEstaEmRodadaAtiva(usuarioId)
      if (estaEmRodadaAtiva) {
        await User.findByIdAndUpdate(usuarioId, { aguardandoVermelho: true })
        return { rodada: null, transacao: null }
      }

      let rodada = await Rodada.findById(rodadaId)
      if (!rodada) throw new Error('Rodada nao encontrada')

      if (rodada.participantes.some(p => p.usuario.toString() === usuarioId)) {
        return { rodada, transacao: null }
      }

      if (!rodada.verde) {
        const verdeParticipante = rodada.participantes.find(
          p => p.cor === 'verde'
        )
        if (verdeParticipante) {
          rodada.verde = verdeParticipante.usuario
          await rodada.save()
        } else {
          const rodadaAtualizada = await this.adicionarParticipanteAmarelo(
            rodadaId,
            usuarioId,
            indicadorId
          )
          return {
            rodada: rodadaAtualizada,
            transacao: null,
            entrouComoAmarelo: true
          }
        }
      }

      const temEstrutura = rodadaTemEstruturaCompleta(rodada)
      const podeReceberVermelho =
        rodada.status === 'em_andamento' ||
        (rodada.status === 'aguardando' && temEstrutura)
      const vermelhosAtuais = rodada.participantes.filter(
        p => p.cor === 'vermelho'
      ).length
      if (!podeReceberVermelho || vermelhosAtuais >= 8) {
        await User.findByIdAndUpdate(usuarioId, { aguardandoVermelho: true })
        return { rodada, transacao: null }
      }

      const novaPosicao = rodada.participantes.length + 1
      const update = {
        $push: {
          participantes: {
            usuario: usuarioId,
            cor: 'vermelho',
            posicao: novaPosicao,
            dataEntrada: new Date(),
            depositoConfirmado: false,
            indicadoPor: indicadorId || null
          }
        },
        $addToSet: { vermelhos: usuarioId }
      }

      const updatedRodada = await Rodada.findOneAndUpdate(
        { _id: rodadaId, 'participantes.usuario': { $ne: usuarioId } },
        update,
        { new: true }
      )

      if (!updatedRodada) {
        return { rodada: await Rodada.findById(rodadaId), transacao: null }
      }

      rodada = updatedRodada

      let transacao = null
      const verdeId = rodada.verde
      if (verdeId) {
        transacao = await Transacao.findOne({
          pagador: usuarioId,
          rodada: rodadaId,
          status: 'pendente'
        })
        if (!transacao) {
          transacao = new Transacao({
            tipo: 'deposito',
            pagador: usuarioId,
            recebedor: verdeId,
            valor: VALOR_VERMELHO,
            rodada: rodadaId,
            status: 'pendente'
          })
          await transacao.save()
          await Rodada.updateOne(
            { _id: rodadaId, 'participantes.usuario': usuarioId },
            { $set: { 'participantes.$.transacaoId': transacao._id } }
          )
          try {
            await gerarQrCodeParaTransacao(transacao._id)
          } catch (qrError) {
            console.error(`[QR] Falha ao gerar QR Code:`, qrError.message)
          }
        }
      }

      if (
        rodada.participantes.length === 15 &&
        rodada.status === 'aguardando'
      ) {
        await this.iniciarRodada(rodadaId)
      }

      let transacaoData = null
      if (transacao) {
        try {
          const transacaoAtualizada = await Transacao.findById(
            transacao._id
          ).lean()
          if (transacaoAtualizada) {
            transacaoData = {
              id: transacaoAtualizada._id,
              qrCode: transacaoAtualizada.metadata?.qrCode || null,
              qrCodeImage: transacaoAtualizada.metadata?.qrCodeImage || null,
              expiraEm: transacaoAtualizada.metadata?.expiraEm || null,
              valor: transacaoAtualizada.valor
            }
          }
        } catch (err) {
          console.error(
            `[VERMELHO] Erro ao recarregar transacao ${transacao._id}:`,
            err.message
          )
        }
      }

      return { rodada, transacao: transacaoData }
    } catch (error) {
      console.error(`\n[VERMELHO] ERRO:`, error)
      throw error
    } finally {
      processandoVermelhoLock.delete(lockKey)
    }
  }

  async criarTransacaoParaVermelho (rodadaId, vermelhoId) {
    try {
      const rodada = await Rodada.findById(rodadaId)
      if (!rodada) throw new Error('Rodada nao encontrada')

      const verdeId = rodada.verde
      if (!verdeId) throw new Error('Verde nao definido na rodada')

      const valor = VALOR_VERMELHO
      const transacao = new Transacao({
        tipo: 'deposito',
        pagador: vermelhoId,
        recebedor: verdeId,
        valor: valor,
        rodada: rodadaId,
        status: 'pendente'
      })

      await transacao.save()

      const participante = rodada.participantes.find(
        p => p.usuario.toString() === vermelhoId.toString()
      )
      if (participante) {
        participante.transacaoId = transacao._id
        await rodada.save()
      }

      return transacao
    } catch (error) {
      console.error('Erro ao criar transacao para vermelho:', error)
      throw error
    }
  }

  async iniciarRodada (rodadaId) {
    try {
      const rodada = await Rodada.findById(rodadaId)
      if (!rodada) throw new Error('Rodada nao encontrada')

      if (rodada.participantes.length !== 15) {
        throw new Error(
          `Rodada precisa ter 15 participantes (tem ${rodada.participantes.length})`
        )
      }

      if (rodada.status !== 'aguardando') {
        throw new Error(`Rodada ja esta ${rodada.status}`)
      }

      const temEstrutura =
        !!rodada.verde &&
        rodada.pretos?.length === 2 &&
        rodada.azuis?.length === 4

      if (temEstrutura) {
        const coresDefinidas = rodada.participantes.filter(
          p => p.cor !== 'amarelo'
        ).length
        const amarelosRestantes = rodada.participantes.filter(
          p => p.cor === 'amarelo'
        )

        if (coresDefinidas === 15) {
          rodada.status = 'em_andamento'
          rodada.dataInicio = new Date()
          await rodada.save()
          this._notificarVermelhosPagar(rodada).catch(() => {})
          return rodada
        }

        if (amarelosRestantes.length === 8) {
          for (const p of amarelosRestantes) {
            p.cor = 'vermelho'
            if (!rodada.vermelhos.includes(p.usuario)) {
              rodada.vermelhos.push(p.usuario)
            }
            let transacao = await Transacao.findOne({
              pagador: p.usuario,
              rodada: rodadaId
            })
            if (!transacao) {
              transacao = new Transacao({
                tipo: 'deposito',
                pagador: p.usuario,
                recebedor: rodada.verde,
                valor: VALOR_VERMELHO,
                rodada: rodadaId,
                status: 'pendente'
              })
              await transacao.save()
              p.transacaoId = transacao._id
              gerarQrCodeParaTransacao(transacao._id).catch(err =>
                console.error(`[QR] Erro: ${err.message}`)
              )
            }
          }
          rodada.status = 'em_andamento'
          rodada.dataInicio = new Date()
          await rodada.save()
          this._notificarVermelhosPagar(rodada).catch(() => {})
          return rodada
        }

        throw new Error(
          `Estrutura definida, mas numero de amarelos e ${amarelosRestantes.length} (esperado 0 ou 8).`
        )
      }

      const shuffled = [...rodada.participantes].sort(() => Math.random() - 0.5)
      shuffled[0].cor = 'verde'
      shuffled[1].cor = 'preto'
      shuffled[2].cor = 'preto'
      for (let i = 3; i < 7; i++) shuffled[i].cor = 'azul'
      for (let i = 7; i < 15; i++) shuffled[i].cor = 'vermelho'

      rodada.verde = shuffled[0].usuario
      rodada.pretos = [shuffled[1].usuario, shuffled[2].usuario]
      rodada.azuis = shuffled.slice(3, 7).map(p => p.usuario)
      rodada.vermelhos = shuffled.slice(7, 15).map(p => p.usuario)

      shuffled.forEach(p => {
        rodada.historicoMovimentacoes.push({
          usuario: p.usuario,
          corAnterior: 'amarelo',
          corNova: p.cor,
          observacao: 'Inicio da rodada',
          data: new Date()
        })
      })

      rodada.status = 'em_andamento'
      rodada.dataInicio = new Date()
      rodada.participantes = shuffled
      await rodada.save()

      await this.criarTransacoesParaVermelhos(rodadaId)

      if (ioInstance) {
        const mensagemInicio = new ChatMessage({
          rodadaId: rodada._id,
          mensagem: `A rodada foi iniciada! Os 8 VERMELHOS devem pagar ${VALOR_VERMELHO_TEXTO} para que a rodada avance. O VERDE recebera ${PREMIO_VERDE_TEXTO} quando todos pagarem.`,
          tipo: 'sistema',
          acao: 'rodada_iniciada',
          createdAt: new Date()
        })
        await mensagemInicio.save()
        ioInstance.to(`rodada-${rodada._id}`).emit('mensagem', {
          _id: mensagemInicio._id,
          mensagem: mensagemInicio.mensagem,
          tipo: 'sistema',
          acao: 'rodada_iniciada',
          createdAt: mensagemInicio.createdAt
        })
      }

      this._notificarVermelhosPagar(rodada).catch(() => {})
      return rodada
    } catch (error) {
      console.error('Erro ao iniciar rodada:', error)
      throw error
    }
  }

  async _notificarVermelhosPagar (rodada) {
    const vermelhos = rodada.participantes.filter(p => p.cor === 'vermelho')
    for (const v of vermelhos) {
      try {
        const u = await User.findById(v.usuario).select('nome email')
        if (!u) continue

        pushService
          .enviarParaUsuario(u._id, {
            title: 'Voce e VERMELHO!',
            body: `Pague ${VALOR_VERMELHO_TEXTO} pra rodada girar. Faltam 8 pagamentos.`,
            icon: '/icon-192.png',
            url: '/dashboard'
          })
          .catch(() => {})

        notificationService
          .criar({
            usuario: u._id,
            tipo: 'aviso',
            titulo: 'Voce e VERMELHO!',
            mensagem: `Pague ${VALOR_VERMELHO_TEXTO} pra rodada girar.`,
            icone: '💳'
          })
          .catch(() => {})
      } catch (err) {
        console.error('[_notificarVermelhosPagar]', err.message)
      }
    }
  }

  async confirmarDeposito (transacaoId, comprovanteUrl, confirmadoPorId) {
    try {
      if (pagamentosProcessadosService.has(transacaoId)) {
        return { transacao: null, todosDepositaram: false, jaProcessado: true }
      }

      pagamentosProcessadosService.set(transacaoId, Date.now())

      setTimeout(() => {
        if (pagamentosProcessadosService.has(transacaoId)) {
          pagamentosProcessadosService.delete(transacaoId)
        }
      }, 10 * 60 * 1000)

      const transacao = await Transacao.findById(transacaoId)
      if (!transacao) {
        pagamentosProcessadosService.delete(transacaoId)
        throw new Error('Transacao nao encontrada')
      }

      if (transacao.status !== 'pendente') {
        pagamentosProcessadosService.delete(transacaoId)
        return { transacao, todosDepositaram: false, jaProcessado: true }
      }

      transacao.status = 'confirmado'
      transacao.comprovante = comprovanteUrl
      transacao.dataConfirmacao = new Date()
      transacao.confirmadoPor = confirmadoPorId
      await transacao.save()

      const rodada = await Rodada.findById(transacao.rodada)
      if (!rodada) {
        pagamentosProcessadosService.delete(transacaoId)
        throw new Error('Rodada nao encontrada')
      }

      const participante = rodada.participantes.find(
        p => p.usuario.toString() === transacao.pagador.toString()
      )

      if (!participante) {
        pagamentosProcessadosService.delete(transacaoId)
        throw new Error('Participante nao encontrado na rodada')
      }

      if (participante.depositoConfirmado === true) {
        pagamentosProcessadosService.delete(transacaoId)
        return { transacao, todosDepositaram: false, jaProcessado: true }
      }

      participante.depositoConfirmado = true
      participante.dataDeposito = new Date()
      participante.comprovantePix = comprovanteUrl

      const usuarioPagadorComissao = await User.findById(
        transacao.pagador
      ).select('indicadoPor')
      const indicadorId =
        usuarioPagadorComissao?.indicadoPor || participante.indicadoPor || null

      if (indicadorId) {
        const resultadoComissao = await comissaoService.processarComissao({
          indicadorId,
          indicadoId: transacao.pagador,
          transacaoId: transacao._id,
          rodadaId: rodada._id,
          participanteJaRecebeu: participante.comissaoPaga === true,
          source: 'confirmarDeposito'
        })

        if (resultadoComissao.success && resultadoComissao.tipo === 'unica') {
          participante.comissaoPaga = true
        }
      }

      const vermelhos = rodada.participantes.filter(p => p.cor === 'vermelho')
      const vermelhosPagos = vermelhos.filter(
        v => v.depositoConfirmado === true
      )

      rodada.totalDepositosConfirmados = vermelhosPagos.length
      await rodada.save()

      let todosDepositaram = false
      if (vermelhosPagos.length === vermelhos.length && vermelhos.length > 0) {
        if (!rodada.todosDepositaram) {
          rodada.todosDepositaram = true
          rodada.dataTodosDepositaram = new Date()
          await rodada.save()
        }

        todosDepositaram = true
        await this.avancarRodada(rodada._id)
      }

      return {
        transacao,
        todosDepositaram,
        progresso: `${vermelhosPagos.length}/${vermelhos.length}`,
        jaProcessado: false
      }
    } catch (error) {
      console.error('[confirmarDeposito] Erro:', error)
      if (transacaoId) pagamentosProcessadosService.delete(transacaoId)
      throw error
    }
  }

  async criarTransacoesParaVermelhos (rodadaId) {
    if (processandoTransacoesVemelhos.has(rodadaId)) return []
    processandoTransacoesVemelhos.set(rodadaId, Date.now())

    try {
      const rodada = await Rodada.findById(rodadaId)
      if (!rodada) throw new Error('Rodada nao encontrada')

      const verdeId = rodada.verde
      if (!verdeId) throw new Error('Verde nao definido na rodada')

      const vermelhos = rodada.participantes.filter(p => p.cor === 'vermelho')
      if (vermelhos.length === 0) return []

      const transacoes = []
      const valor = VALOR_VERMELHO

      for (const participante of vermelhos) {
        const vermelhoId = participante.usuario

        if (!participante.transacaoId) {
          const transacao = new Transacao({
            tipo: 'deposito',
            pagador: vermelhoId,
            recebedor: verdeId,
            valor: valor,
            rodada: rodadaId,
            status: 'pendente'
          })
          await transacao.save()
          transacoes.push(transacao)

          participante.transacaoId = transacao._id

          if (!rodada.vermelhos.includes(vermelhoId)) {
            rodada.vermelhos.push(vermelhoId)
          }
        }
      }

      if (transacoes.length > 0) {
        await rodada.save()
      }

      return transacoes
    } catch (error) {
      console.error('Erro ao criar transacoes para vermelhos:', error)
      throw error
    } finally {
      processandoTransacoesVemelhos.delete(rodadaId)
    }
  }

  async verificarTodosDepositos (rodadaId) {
    try {
      const rodada = await Rodada.findById(rodadaId)
      if (!rodada) throw new Error('Rodada nao encontrada')

      const vermelhos = rodada.participantes.filter(p => p.cor === 'vermelho')
      const vermelhosPagos = vermelhos.filter(
        v => v.depositoConfirmado === true
      )
      const todosDepositaram =
        vermelhosPagos.length === vermelhos.length && vermelhos.length > 0

      if (todosDepositaram && !rodada.todosDepositaram) {
        rodada.todosDepositaram = true
        rodada.dataTodosDepositaram = new Date()
        rodada.totalDepositosConfirmados = vermelhosPagos.length
        await rodada.save()
        await this.avancarRodada(rodadaId)
      } else {
        if (rodada.totalDepositosConfirmados !== vermelhosPagos.length) {
          rodada.totalDepositosConfirmados = vermelhosPagos.length
          await rodada.save()
        }
      }

      return todosDepositaram
    } catch (error) {
      console.error('Erro ao verificar depositos:', error)
      throw error
    }
  }

  async alocarFilaEmTodasRodadas () {
    if (alocandoFila) return 0
    alocandoFila = true

    try {
      // [PRIORIDADE 2] Busca todas as rodadas com vagas, ordenando da MAIS CHEIA para a mais vazia
      const rodadasComVagasAgg = await Rodada.aggregate([
        {
          $match: {
            status: { $in: ['aguardando', 'em_andamento'] },
            verde: { $exists: true, $ne: null },
            pretos: { $exists: true, $ne: [] },
            azuis: { $exists: true, $ne: [] }
          }
        },
        {
          $addFields: {
            totalParticipantes: { $size: '$participantes' },
            totalVermelhos: {
              $size: {
                $filter: {
                  input: '$participantes',
                  as: 'p',
                  cond: { $eq: ['$$p.cor', 'vermelho'] }
                }
              }
            }
          }
        },
        { $match: { totalVermelhos: { $lt: 8 } } },
        { $sort: { totalParticipantes: -1, createdAt: 1 } }
      ])

      if (rodadasComVagasAgg.length === 0) {
        alocandoFila = false
        return 0
      }

      const filaUsuarios = await User.find({ aguardandoVermelho: true }).sort({
        posicaoFila: 1
      })
      if (filaUsuarios.length === 0) {
        alocandoFila = false
        return 0
      }

      let alocados = 0
      let indexFila = 0

      for (
        let i = 0;
        i < rodadasComVagasAgg.length && indexFila < filaUsuarios.length;
        i++
      ) {
        let rodadaAtual = await Rodada.findById(rodadasComVagasAgg[i]._id)
        if (!rodadaAtual) continue

        let vermelhosAtuais = rodadaAtual.participantes.filter(
          p => p.cor === 'vermelho'
        ).length
        if (vermelhosAtuais >= 8) continue

        let vagasRestantes = 8 - vermelhosAtuais

        while (vagasRestantes > 0 && indexFila < filaUsuarios.length) {
          rodadaAtual = await Rodada.findById(rodadaAtual._id)
          if (!rodadaAtual) break

          vermelhosAtuais = rodadaAtual.participantes.filter(
            p => p.cor === 'vermelho'
          ).length
          if (vermelhosAtuais >= 8) break

          vagasRestantes = 8 - vermelhosAtuais
          if (vagasRestantes <= 0) break

          const usuario = filaUsuarios[indexFila]

          const usuarioAtual = await User.findById(usuario._id)
          if (!usuarioAtual.aguardandoVermelho) {
            indexFila++
            continue
          }

          if (
            usuarioAtual.rodadaBloqueada &&
            usuarioAtual.rodadaBloqueada.toString() ===
              rodadaAtual._id.toString()
          ) {
            indexFila++
            continue
          }

          const emRodadaAtiva = await this.usuarioEstaEmRodadaAtiva(usuario._id)
          if (emRodadaAtiva) {
            await User.updateOne(
              { _id: usuario._id },
              {
                aguardandoVermelho: false,
                posicaoFila: null,
                dataEntradaFila: null,
                rodadaBloqueada: null
              }
            )
            indexFila++
            continue
          }

          const jaNaRodada = rodadaAtual.participantes.some(
            p => p.usuario.toString() === usuario._id.toString()
          )
          if (jaNaRodada) {
            await User.updateOne(
              { _id: usuario._id },
              {
                aguardandoVermelho: false,
                posicaoFila: null,
                dataEntradaFila: null,
                rodadaBloqueada: null
              }
            )
            indexFila++
            continue
          }

          let adicionado = false
          try {
            const resultado = await this.adicionarParticipanteVermelho(
              rodadaAtual._id,
              usuario._id,
              null
            )
            const rodadaDepois = await Rodada.findById(rodadaAtual._id)
            adicionado = rodadaDepois.participantes.some(
              p => p.usuario.toString() === usuario._id.toString()
            )
          } catch (error) {
            adicionado = false
          }

          if (adicionado) {
            const usuarioAlocado = await User.findById(usuario._id)
            if (usuarioAlocado.saldoPremio >= VALOR_VERMELHO) {
              const transacao = await Transacao.findOne({
                pagador: usuario._id,
                rodada: rodadaAtual._id,
                status: 'pendente'
              })
              if (transacao) {
                transacao.status = 'confirmado'
                transacao.dataConfirmacao = new Date()
                transacao.metadata = {
                  pagoComSaldo: true,
                  valorDescontado: VALOR_VERMELHO
                }
                await transacao.save()

                await User.updateOne(
                  { _id: usuario._id },
                  { $inc: { saldoPremio: -VALOR_VERMELHO } }
                )

                await Rodada.updateOne(
                  {
                    _id: rodadaAtual._id,
                    'participantes.usuario': usuario._id
                  },
                  { $set: { 'participantes.$.depositoConfirmado': true } }
                )
              }
            }

            try {
              const usuarioNotif = await User.findById(usuario._id).select(
                'nome email'
              )
              if (usuarioNotif) {
                pushService
                  .enviarParaUsuario(
                    usuarioNotif._id,
                    pushService.templates.filaAlocado(rodadaAtual.nome)
                  )
                  .catch(err => console.error('[push] fila:', err.message))

                notificationService
                  .filaAlocado(usuarioNotif._id, rodadaAtual.nome)
                  .catch(err => console.error('[notif] fila:', err.message))

                activityService
                  .filaAlocado(
                    usuarioNotif._id,
                    usuarioNotif.nome,
                    rodadaAtual._id
                  )
                  .catch(err => console.error('[activity] fila:', err.message))
              }
            } catch (err) {
              console.error('[alocarFila notif] erro:', err.message)
            }

            await User.updateOne(
              { _id: usuario._id },
              {
                aguardandoVermelho: false,
                posicaoFila: null,
                dataEntradaFila: null,
                rodadaBloqueada: null
              }
            )
            alocados++
            indexFila++
            rodadaAtual = await Rodada.findById(rodadaAtual._id)
            vermelhosAtuais = rodadaAtual.participantes.filter(
              p => p.cor === 'vermelho'
            ).length
            vagasRestantes = 8 - vermelhosAtuais
          } else {
            indexFila++
          }
        }

        if (indexFila >= filaUsuarios.length) break
      }

      alocandoFila = false
      return alocados
    } catch (error) {
      console.error('[ALOCAR FILA] Erro na alocacao:', error)
      alocandoFila = false
      throw error
    }
  }

  async avancarRodada (rodadaId) {
    if (processandoRodadas.has(rodadaId)) return null
    processandoRodadas.set(rodadaId, Date.now())

    setTimeout(() => {
      if (processandoRodadas.has(rodadaId)) {
        processandoRodadas.delete(rodadaId)
      }
    }, 30 * 1000)

    try {
      const rodada = await Rodada.findById(rodadaId)
      if (!rodada) throw new Error('Rodada nao encontrada')

      if (rodada.status === 'concluida') return rodada
      if (rodada.status !== 'em_andamento') {
        throw new Error(
          `Rodada nao esta em andamento. Status: ${rodada.status}`
        )
      }
      if (rodada.rodadasGeradas && rodada.rodadasGeradas.length > 0)
        return rodada

      const vermelhos = rodada.participantes.filter(p => p.cor === 'vermelho')
      const vermelhosPagos = vermelhos.filter(
        v => v.depositoConfirmado === true
      )

      if (vermelhosPagos.length !== 8) {
        return rodada
      }

      const verdeAtual = rodada.participantes.find(p => p.cor === 'verde')
      const notificacoesPosPromocao = []

      for (const p of rodada.participantes) {
        const corAnterior = p.cor
        let corNova = corAnterior

        if (p.cor === 'vermelho') corNova = 'azul'
        else if (p.cor === 'azul') corNova = 'preto'
        else if (p.cor === 'preto') corNova = 'verde'
        else if (p.cor === 'verde') corNova = 'concluido'

        if (corNova !== corAnterior) {
          p.cor = corNova

          if (corNova === 'concluido') {
            try {
              await User.findByIdAndUpdate(p.usuario, {
                $inc: { saldoPremio: PREMIO_VERDE, totalGanho: PREMIO_VERDE }
              })
            } catch (err) {
              console.error(`   Erro ao creditar premio: ${err.message}`)
            }
          }

          notificacoesPosPromocao.push({
            usuarioId: p.usuario,
            corAnterior,
            corNova
          })
        }
      }

      if (notificacoesPosPromocao.length > 0) {
        setImmediate(async () => {
          for (const notif of notificacoesPosPromocao) {
            try {
              await notificarPromocao({
                usuarioId: notif.usuarioId,
                corAnterior: notif.corAnterior,
                corNova: notif.corNova,
                rodada
              })
            } catch (err) {
              console.error('[avancarRodada notif]', err.message)
            }
          }
        })
      }

      const uniqueMap = new Map()
      for (const p of rodada.participantes) {
        const key = p.usuario.toString()
        if (!uniqueMap.has(key)) {
          uniqueMap.set(key, p)
        }
      }
      rodada.participantes = Array.from(uniqueMap.values())

      const novosVerdes = rodada.participantes.filter(p => p.cor === 'verde')
      const novosPretos = rodada.participantes.filter(p => p.cor === 'preto')
      const novosAzuis = rodada.participantes.filter(p => p.cor === 'azul')

      if (novosVerdes.length !== 2) {
        await rodada.save()
        return rodada
      }

      const verdesIds = novosVerdes.map(v => v.usuario)
      const pretosIds = novosPretos.map(p => p.usuario)
      const azuisIds = novosAzuis.map(a => a.usuario)

      const grupo1Pretos = pretosIds.slice(0, 2)
      const grupo2Pretos = pretosIds.slice(2, 4)
      const grupo1Azuis = azuisIds.slice(0, 4)
      const grupo2Azuis = azuisIds.slice(4, 8)

      const proximoNumero = await this.getProximoNumeroRodada()

      const novaRodada1 = await this.criarRodadaAvancada(
        proximoNumero,
        verdesIds[0],
        grupo1Pretos,
        grupo1Azuis,
        rodada._id
      )

      const novaRodada2 = await this.criarRodadaAvancada(
        proximoNumero + 1,
        verdesIds[1],
        grupo2Pretos,
        grupo2Azuis,
        rodada._id
      )

      rodada.rodadasGeradas = [novaRodada1._id, novaRodada2._id]

      await this.alocarFilaEmTodasRodadas()

      rodada.historicoMovimentacoes.push({
        usuario: verdeAtual.usuario,
        corAnterior: 'verde',
        corNova: 'concluido',
        observacao: `RODADA CONCLUIDA! Premio de ${PREMIO_VERDE_TEXTO} disponivel para saque.`,
        data: new Date()
      })

      rodada.status = 'concluida'
      rodada.dataFim = new Date()
      rodada.premioVerdePago = false

      let salvo = false
      let tentativas = 0
      const maxTentativas = 3
      while (!salvo && tentativas < maxTentativas) {
        try {
          await rodada.save()
          salvo = true
        } catch (err) {
          if (err.name === 'VersionError') {
            tentativas++
            const rodadaRecarregada = await Rodada.findById(rodada._id)
            rodada.participantes = rodadaRecarregada.participantes.map(p => {
              const alterado = rodada.participantes.find(
                np => np.usuario.toString() === p.usuario.toString()
              )
              return alterado || p
            })
            rodada.rodadasGeradas =
              rodadaRecarregada.rodadasGeradas || rodada.rodadasGeradas
            rodada.historicoMovimentacoes =
              rodadaRecarregada.historicoMovimentacoes ||
              rodada.historicoMovimentacoes
            rodada.status =
              rodadaRecarregada.status === 'concluida'
                ? rodadaRecarregada.status
                : rodada.status
            rodada.dataFim = rodadaRecarregada.dataFim || rodada.dataFim
            rodada.premioVerdePago =
              rodadaRecarregada.premioVerdePago || rodada.premioVerdePago
          } else {
            throw err
          }
        }
      }
      if (!salvo) {
        throw new Error(
          `Nao foi possivel salvar a rodada apos ${maxTentativas} tentativas.`
        )
      }

      if (ioInstance) {
        const mensagemConclusao = new ChatMessage({
          rodadaId: rodada._id,
          mensagem: `PARABENS! A rodada foi concluida. O VERDE ganhou ${PREMIO_VERDE_TEXTO}! Duas novas rodadas foram criadas.`,
          tipo: 'sistema',
          acao: 'rodada_concluida',
          createdAt: new Date()
        })
        await mensagemConclusao.save()
        ioInstance.to(`rodada-${rodada._id}`).emit('mensagem', {
          _id: mensagemConclusao._id,
          mensagem: mensagemConclusao.mensagem,
          tipo: 'sistema',
          acao: 'rodada_concluida',
          createdAt: mensagemConclusao.createdAt
        })
        ioInstance.to(`rodada-${rodada._id}`).emit('rodada-atualizada', {
          rodadaId: rodada._id,
          status: rodada.status
        })
      }

      return rodada
    } catch (error) {
      console.error('Erro ao avancar rodada:', error)
      throw error
    } finally {
      processandoRodadas.delete(rodadaId)
    }
  }

  async criarRodadaAvancada (
    numero,
    verdeId,
    pretosIds,
    azuisIds,
    rodadaOrigemId
  ) {
    try {
      const rodada = new Rodada({
        numero: numero,
        nome: `Rodada #${numero}`,
        status: 'aguardando',
        participantes: [],
        totalDepositosConfirmados: 0,
        todosDepositaram: false,
        historicoMovimentacoes: [],
        rodadaOrigem: rodadaOrigemId
      })

      rodada.participantes.push({
        usuario: verdeId,
        cor: 'verde',
        posicao: 1,
        dataEntrada: new Date(),
        depositoConfirmado: false
      })

      pretosIds.forEach(id => {
        rodada.participantes.push({
          usuario: id,
          cor: 'preto',
          posicao: rodada.participantes.length + 1,
          dataEntrada: new Date(),
          depositoConfirmado: false
        })
      })

      azuisIds.forEach(id => {
        rodada.participantes.push({
          usuario: id,
          cor: 'azul',
          posicao: rodada.participantes.length + 1,
          dataEntrada: new Date(),
          depositoConfirmado: false
        })
      })

      rodada.verde = verdeId
      rodada.pretos = pretosIds
      rodada.azuis = azuisIds
      rodada.vermelhos = []

      await rodada.save()
      return rodada
    } catch (error) {
      console.error('Erro ao criar rodada avancada:', error)
      throw error
    }
  }

  async getProximoNumeroRodada () {
    try {
      const ultimaRodada = await Rodada.findOne().sort({ numero: -1 })
      return ultimaRodada ? ultimaRodada.numero + 1 : 1
    } catch (error) {
      console.error('Erro ao obter proximo numero:', error)
      return 1
    }
  }

  async buscarRodadaAtivaDoUsuario (usuarioId) {
    try {
      const usuarioIdStr = usuarioId.toString()
      const rodada = await Rodada.findOne({
        status: { $in: ['aguardando', 'em_andamento'] },
        participantes: {
          $elemMatch: { usuario: usuarioId, cor: { $ne: 'concluido' } }
        }
      })
      return rodada
    } catch (error) {
      console.error('Erro ao buscar rodada ativa:', error)
      return null
    }
  }

  async buscarRodadaParaNovoVermelho (usuarioId) {
    try {
      const rodadasDoUsuario = await Rodada.find({
        'participantes.usuario': usuarioId,
        status: { $in: ['em_andamento', 'aguardando'] }
      }).sort({ numero: -1 })

      if (rodadasDoUsuario.length === 0) {
        return null
      }

      for (const rodada of rodadasDoUsuario) {
        const vermelhosAtuais = rodada.participantes.filter(
          p => p.cor === 'vermelho'
        ).length
        const temEstrutura = rodadaTemEstruturaCompleta(rodada)
        const podeReceberVermelho =
          rodada.status === 'em_andamento' ||
          (rodada.status === 'aguardando' && temEstrutura)

        if (vermelhosAtuais < 8 && podeReceberVermelho) {
          return rodada
        }
      }

      return null
    } catch (error) {
      console.error('Erro ao buscar rodada para novo vermelho:', error)
      return null
    }
  }

  async verificarStatusUsuario (usuarioId) {
    try {
      const usuario = await User.findById(usuarioId)
      const rodadaAtiva = await this.buscarRodadaAtivaDoUsuario(usuarioId)
      const rodadaEmAndamento = await this.buscarRodadaParaNovoVermelho(
        usuarioId
      )
      const historico = await this.buscarHistoricoUsuario(usuarioId)

      const rodadasConcluidas = historico.filter(
        r =>
          r.status === 'concluida' &&
          r.participantes.some(
            p =>
              p.usuario.toString() === usuarioId.toString() &&
              p.cor === 'concluido'
          )
      )

      const totalGanho = rodadasConcluidas.length * PREMIO_VERDE
      const naFilaEspera =
        usuario?.aguardandoVermelho === true &&
        !rodadaAtiva &&
        !rodadaEmAndamento

      return {
        temRodadaAtiva: !!rodadaAtiva,
        temRodadaEmAndamento: !!rodadaEmAndamento,
        rodadaAtiva: rodadaAtiva
          ? {
              id: rodadaAtiva._id,
              numero: rodadaAtiva.numero,
              cor: rodadaAtiva.participantes.find(
                p => p.usuario.toString() === usuarioId.toString()
              )?.cor
            }
          : null,
        rodadaEmAndamento: rodadaEmAndamento
          ? {
              id: rodadaEmAndamento._id,
              numero: rodadaEmAndamento.numero,
              cor: rodadaEmAndamento.participantes.find(
                p => p.usuario.toString() === usuarioId.toString()
              )?.cor,
              vagasVermelho:
                8 -
                rodadaEmAndamento.participantes.filter(
                  p => p.cor === 'vermelho'
                ).length
            }
          : null,
        rodadasConcluidas: rodadasConcluidas.length,
        totalGanho: totalGanho,
        historico: historico,
        aguardandoVermelho: usuario?.aguardandoVermelho || false,
        naFilaEspera: naFilaEspera,
        posicaoFila: usuario?.posicaoFila || null,
        totalComissao: usuario?.totalComissao || 0,
        totalIndicacoesComissionadas:
          usuario?.totalIndicacoesComissionadas || 0,
        saldoPremio: usuario?.saldoPremio || 0
      }
    } catch (error) {
      console.error('Erro ao verificar status:', error)
      throw error
    }
  }

  async verificarEAvancarSeNecessario (rodadaId) {
    try {
      const rodada = await Rodada.findById(rodadaId)
      if (!rodada) return false
      if (rodada.status === 'concluida') return true
      if (rodada.rodadasGeradas && rodada.rodadasGeradas.length > 0) return true
      if (rodada.status !== 'em_andamento') return false

      const vermelhos = rodada.participantes.filter(p => p.cor === 'vermelho')
      const vermelhosPagos = vermelhos.filter(
        v => v.depositoConfirmado === true
      )
      const todosPagos = vermelhosPagos.length === 8

      if (todosPagos) {
        await this.avancarRodada(rodadaId)
        return true
      }

      return false
    } catch (error) {
      console.error('[AUTO] Erro ao verificar e avancar:', error)
      return false
    }
  }

  async jogarNovamente (usuarioId) {
    try {
      let usuario = await User.findById(usuarioId)
      if (!usuario) throw new Error('Usuario nao encontrado')

      const saldoAtual = Number(usuario.saldoPremio) || 0

      const SolicitacaoSaque = require('../models/SolicitacaoSaque')
      const solicitacaoPendente = await SolicitacaoSaque.findOne({
        usuario: usuarioId,
        status: 'pendente'
      })
      if (solicitacaoPendente) {
        solicitacaoPendente.status = 'recusado'
        solicitacaoPendente.motivoRecusa = 'Cancelado ao jogar novamente'
        solicitacaoPendente.dataRecusa = new Date()
        await solicitacaoPendente.save()

        const rodadaOriginal = await Rodada.findById(solicitacaoPendente.rodada)
        if (rodadaOriginal) {
          rodadaOriginal.premioVerdePago = false
          await rodadaOriginal.save()
        }
      }

      if (usuario.aguardandoVermelho) {
        try {
          await this.alocarFilaEmTodasRodadas()
        } catch (err) {
          console.error('[REENTRADA] Erro ao alocar fila:', err.message)
        }

        const usuarioRecarregado = await User.findById(usuarioId)
        if (usuarioRecarregado) {
          usuario = usuarioRecarregado
        }

        if (!usuario.aguardandoVermelho) {
          const rodadaAgora = await this.buscarRodadaAtivaDoUsuario(usuarioId)
          if (rodadaAgora) {
            const participanteAgora = rodadaAgora.participantes.find(
              p => p.usuario.toString() === usuarioId.toString()
            )
            const corAgora = participanteAgora?.cor || 'amarelo'
            const saldoAtualizado = Number(usuario.saldoPremio) || 0
            return {
              success: true,
              message: `Voce entrou na ${
                rodadaAgora.nome
              } como ${corAgora.toUpperCase()}.`,
              cor: corAgora,
              rodadaId: rodadaAgora._id,
              rodadaNome: rodadaAgora.nome,
              aguardando: false,
              pagoAutomaticamente: false,
              saldoRestante: saldoAtualizado,
              transacaoId: participanteAgora?.transacaoId || null
            }
          }
        }

        // [PRIORIDADE 2] Usa a helper para buscar a mais cheia
        let rodadaExistente = await this.buscarRodadaMaisCheiaComVaga()

        if (
          rodadaExistente &&
          usuario.rodadaBloqueada &&
          usuario.rodadaBloqueada.toString() === rodadaExistente._id.toString()
        ) {
          rodadaExistente = null
        }

        if (rodadaExistente) {
          usuario.aguardandoVermelho = false
          usuario.posicaoFila = null
          usuario.dataEntradaFila = null
          await usuario.save()
        } else {
          const totalNaFila = await User.countDocuments({
            aguardandoVermelho: true
          })
          return {
            success: true,
            message: `Voce ja esta na fila de espera! Posicao: ${usuario.posicaoFila} de ${totalNaFila}.`,
            cor: 'amarelo',
            aguardando: true,
            posicao: usuario.posicaoFila,
            totalNaFila,
            pagoAutomaticamente: false,
            saldoRestante: saldoAtual
          }
        }
      }

      const rodadaAtiva = await this.buscarRodadaAtivaDoUsuario(usuarioId)
      if (rodadaAtiva) {
        const participante = rodadaAtiva.participantes.find(
          p => p.usuario.toString() === usuarioId
        )
        if (participante && participante.cor !== 'concluido') {
          throw new Error('Voce ja esta participando de uma rodada ativa')
        }
      }

      const temSaldo = saldoAtual >= VALOR_VERMELHO
      let pagoAutomaticamente = false
      let saldoRestante = saldoAtual

      // [PRIORIDADE 2] Usa a helper para buscar a mais cheia
      let rodadaParaEntrar = await this.buscarRodadaMaisCheiaComVaga()

      if (rodadaParaEntrar) {
        if (usuario.aguardandoVermelho) {
          usuario.aguardandoVermelho = false
          usuario.posicaoFila = null
          usuario.dataEntradaFila = null
          await usuario.save()
        }

        const resultadoAdd = await this.adicionarParticipanteVermelho(
          rodadaParaEntrar._id,
          usuarioId,
          null
        )

        if (resultadoAdd && resultadoAdd.entrouComoAmarelo) {
          const rodadaAgora = await Rodada.findById(rodadaParaEntrar._id)
          const participanteAgora = rodadaAgora?.participantes.find(
            p => p.usuario.toString() === usuarioId.toString()
          )
          const corAgora = participanteAgora?.cor || 'amarelo'
          return {
            success: true,
            message: `Voce entrou na ${
              rodadaParaEntrar.nome
            } como ${corAgora.toUpperCase()}. Aguarde completar 15 participantes para a rodada iniciar.`,
            cor: corAgora,
            rodadaId: rodadaParaEntrar._id,
            rodadaNome: rodadaParaEntrar.nome,
            aguardando: false,
            pagoAutomaticamente: false,
            saldoRestante: saldoAtual,
            transacaoId: null
          }
        }

        const verdeId = rodadaParaEntrar.verde
        let transacaoId = null
        if (!verdeId) {
          // Sem verde
        } else {
          let transacao = await Transacao.findOne({
            pagador: usuarioId,
            rodada: rodadaParaEntrar._id
          })
          if (!transacao) {
            transacao = new Transacao({
              tipo: 'deposito',
              pagador: usuarioId,
              recebedor: verdeId,
              valor: VALOR_VERMELHO,
              rodada: rodadaParaEntrar._id,
              status: 'pendente'
            })
            await transacao.save()
          }
          transacaoId = transacao._id

          if (temSaldo) {
            transacao.status = 'confirmado'
            transacao.dataConfirmacao = new Date()
            transacao.metadata = {
              pagoComSaldo: true,
              valorDescontado: VALOR_VERMELHO
            }
            await transacao.save()

            const rodadaAtualizada = await Rodada.findById(rodadaParaEntrar._id)
            if (!rodadaAtualizada)
              throw new Error('Rodada nao encontrada apos adicionar')

            const participante = rodadaAtualizada.participantes.find(
              p => p.usuario.toString() === usuarioId.toString()
            )
            if (!participante)
              throw new Error('Participante nao encontrado apos pagar')

            participante.depositoConfirmado = true
            participante.dataDeposito = new Date()
            participante.comprovantePix = 'PAGO_COM_SALDO'
            participante.transacaoId = transacao._id

            const vermelhos = rodadaAtualizada.participantes.filter(
              p => p.cor === 'vermelho'
            )
            const pagos = vermelhos.filter(v => v.depositoConfirmado === true)
            rodadaAtualizada.totalDepositosConfirmados = pagos.length
            await rodadaAtualizada.save()

            const usuarioAtualizado = await User.findOneAndUpdate(
              { _id: usuarioId, saldoPremio: saldoAtual },
              { $inc: { saldoPremio: -VALOR_VERMELHO } },
              { new: true }
            )
            if (!usuarioAtualizado) {
              throw new Error('Falha ao descontar saldo. Tente novamente.')
            }

            pagoAutomaticamente = true
            saldoRestante = usuarioAtualizado.saldoPremio

            if (
              pagos.length === 8 &&
              rodadaAtualizada.participantes.length === 15
            ) {
              await this.verificarEAvancarSeNecessario(rodadaParaEntrar._id)
            }
          }
        }

        try {
          const u = await User.findById(usuarioId).select('nome')
          if (u) {
            activityService
              .entrada(usuarioId, u.nome, rodadaParaEntrar._id)
              .catch(() => {})
          }
        } catch (err) {
          console.error('[jogarNovamente activity]', err.message)
        }

        const message = pagoAutomaticamente
          ? `Entrou como VERMELHO na ${rodadaParaEntrar.nome}. Pagamento de R$${VALOR_VERMELHO} descontado. Saldo restante: R$ ${saldoRestante}.`
          : `Entrou como VERMELHO na ${rodadaParaEntrar.nome}. Gere o QR Code para pagar R$ ${VALOR_VERMELHO}.`

        return {
          success: true,
          message,
          cor: 'vermelho',
          rodadaId: rodadaParaEntrar._id,
          rodadaNome: rodadaParaEntrar.nome,
          aguardando: false,
          pagoAutomaticamente,
          saldoRestante,
          transacaoId
        }
      }

      if (!usuario.aguardandoVermelho) {
        const ultimo = await User.findOne({ aguardandoVermelho: true }).sort({
          posicaoFila: -1
        })
        const novaPos = ultimo ? ultimo.posicaoFila + 1 : 1
        usuario.aguardandoVermelho = true
        usuario.posicaoFila = novaPos
        usuario.dataEntradaFila = new Date()
        await usuario.save()
      }
      const totalFila = await User.countDocuments({ aguardandoVermelho: true })
      return {
        success: true,
        message: `Voce foi colocado na fila de espera (posicao ${usuario.posicaoFila} de ${totalFila}).`,
        cor: 'amarelo',
        aguardando: true,
        posicao: usuario.posicaoFila,
        totalNaFila: totalFila,
        pagoAutomaticamente: false,
        saldoRestante: saldoAtual
      }
    } catch (error) {
      console.error('Erro ao jogar novamente:', error)
      throw error
    }
  }

  initializeIo (io) {
    ioInstance = io
  }
}

module.exports = new RodadaService()
