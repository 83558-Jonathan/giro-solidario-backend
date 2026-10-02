const Rodada = require('../models/Rodada')
const User = require('../models/User')
const Transacao = require('../models/Transacao')
const ChatMessage = require('../models/ChatMessage')
const { gerarQrCodeParaTransacao } = require('../utils/qrCodeHelper')
const {
  VALOR_VERMELHO,
  PREMIO_VERDE,
  VALOR_VERMELHO_TEXTO,
  PREMIO_VERDE_TEXTO
} = require('../config/constantes')
const pushService = require('./pushService')
const activityService = require('./activityService')
const notificationService = require('./notificationService')
const badgeService = require('./badgeService')
const emailController = require('../controllers/emailController')

const pagamentosProcessadosService = new Map()
const processandoRodadas = new Map()
let alocandoFila = false
const processandoTransacoesVemelhos = new Map()

let ioInstance = null

const processandoVermelhoLock = new Map()

// ===========================================
// FUNÇÃO AUXILIAR PARA VERIFICAR ESTRUTURA COMPLETA
// ===========================================
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

// ===========================================
// NOVO: helper para notificar promoção de cor
// ===========================================
async function notificarPromocao ({ usuarioId, corAnterior, corNova, rodada }) {
  try {
    const u = await User.findById(usuarioId).select('nome email')
    if (!u) return

    let templatePush = null
    let mensagemInApp = null
    let iconeInApp = null
    let tipoNotif = 'rodada_avancou'
    let tituloNotif = '🎯 Sua nova posição'

    switch (corNova) {
      case 'azul':
        mensagemInApp =
          'Você subiu para AZUL! Convide 2 amigos pra virar PRETO.'
        iconeInApp = '🔵'
        tituloNotif = '🔵 Você é AZUL!'
        break
      case 'preto':
        mensagemInApp = 'Você subiu para PRETO! Continue firme.'
        iconeInApp = '⚫'
        tituloNotif = '⚫ Você é PRETO!'
        break
      case 'verde':
        templatePush = pushService.templates.voceEVerde(PREMIO_VERDE)
        mensagemInApp = `Você é o VERDE! Aguarde os pagamentos pra receber ${PREMIO_VERDE_TEXTO}.`
        iconeInApp = '🟢'
        tipoNotif = 'voce_e_verde'
        tituloNotif = '🟢 Você é o VERDE!'
        break
      case 'concluido':
        templatePush = pushService.templates.premioLiberado(PREMIO_VERDE)
        mensagemInApp = `Parabéns! ${PREMIO_VERDE_TEXTO} já estão no seu saldo.`
        iconeInApp = '🏆'
        tipoNotif = 'premio_liberado'
        tituloNotif = '🏆 Prêmio liberado!'
        break
      case 'concluido':
        templatePush = pushService.templates.premioLiberado(PREMIO_VERDE)
        mensagemInApp = `Parabéns! R$ ${PREMIO_VERDE} já estão no seu saldo.`
        iconeInApp = '🏆'
        tipoNotif = 'premio_liberado'
        tituloNotif = '🏆 Prêmio liberado!'
        break
    }

    // Push
    if (templatePush) {
      pushService
        .enviarParaUsuario(u._id, templatePush)
        .catch(err =>
          console.error('❌ [push] notificarPromocao:', err.message)
        )
    }

    // Notificação in-app
    if (mensagemInApp) {
      notificationService
        .criar({
          usuario: u._id,
          tipo: tipoNotif,
          titulo: tituloNotif,
          mensagem: mensagemInApp,
          icone: iconeInApp
        })
        .catch(err =>
          console.error('❌ [notif] notificarPromocao:', err.message)
        )
    }

    // Email
    emailController
      .enviarEmailRodadaAvancada(u, rodada, corNova, corAnterior)
      .catch(err => console.error('❌ [email] notificarPromocao:', err.message))

    // Se virou concluído → envio email de prêmio + badge + activity
    if (corNova === 'concluido') {
      emailController
        .enviarEmailPremio(u, rodada, PREMIO_VERDE)
        .catch(err => console.error('❌ [email] prêmio:', err.message))

      badgeService
        .verificarAposVitoria(u._id)
        .catch(err => console.error('❌ [badge] vitória:', err.message))

      activityService
        .premio(u._id, u.nome, rodada._id, PREMIO_VERDE)
        .catch(err => console.error('❌ [activity] prêmio:', err.message))
    } else {
      activityService.rodadaAvancou(u._id, u.nome, rodada._id).catch(() => {})
    }
  } catch (err) {
    console.error('❌ [notificarPromocao] erro:', err.message)
  }
}

class RodadaService {
  // ===========================================
  // CRIAR NOVA RODADA
  // ===========================================
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
      console.log(`Participante inicial: ${criador.nome} (amarelo) - 1/15`)

      return rodada
    } catch (error) {
      console.error('Erro ao criar rodada:', error)
      throw error
    }
  }

  // ===========================================
  // VERIFICAR SE USUÁRIO JÁ ESTÁ EM ALGUMA RODADA ATIVA
  // ===========================================
  async usuarioEstaEmRodadaAtiva (usuarioId) {
    try {
      const usuarioIdStr = usuarioId.toString()

      const rodadaAtiva = await Rodada.findOne({
        status: { $in: ['aguardando', 'em_andamento'] },
        participantes: {
          $elemMatch: {
            usuario: usuarioId,
            cor: { $ne: 'concluido' }
          }
        }
      })

      if (rodadaAtiva) {
        console.log(
          `[VERIFICACAO] Usuário ${usuarioIdStr} já está na rodada ativa ${rodadaAtiva.nome} (status: ${rodadaAtiva.status})`
        )
        return true
      }
      return false
    } catch (error) {
      console.error('Erro ao verificar rodada ativa:', error)
      return false
    }
  }

  // ===========================================
  // ADICIONAR PARTICIPANTE AMARELO (rodada aguardando)
  // ===========================================
  async adicionarParticipanteAmarelo (rodadaId, usuarioId, indicadorId = null) {
    try {
      console.log(
        `[AMARELO] Tentando adicionar usuario ${usuarioId} a rodada ${rodadaId}`
      )

      const estaEmRodadaAtiva = await this.usuarioEstaEmRodadaAtiva(usuarioId)
      if (estaEmRodadaAtiva) {
        console.error(
          `[AMARELO] Usuário ${usuarioId} já está em outra rodada ativa.`
        )
        throw new Error(
          'Usuário já participa de uma rodada ativa. Aguarde a conclusão para entrar em outra.'
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

      console.log(
        `Participante ${usuario.nome} adicionado a ${rodada.nome} (amarelo)`
      )
      console.log(`Progresso: ${rodada.participantes.length}/15 participantes`)

      if (rodada.participantes.length === 15) {
        console.log(
          `Rodada ${rodada.nome} completou 15 participantes! Iniciando...`
        )
        await this.iniciarRodada(rodadaId)
      }

      return rodada
    } catch (error) {
      console.error('Erro ao adicionar participante amarelo:', error)
      throw error
    }
  }

  // ===========================================
  // ADICIONAR PARTICIPANTE VERMELHO (ATÔMICO, SEM DUPLICATAS)
  // ===========================================
  async adicionarParticipanteVermelho (rodadaId, usuarioId, indicadorId = null) {
    const lockKey = `${rodadaId}_${usuarioId}`
    while (processandoVermelhoLock.has(lockKey)) {
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    processandoVermelhoLock.set(lockKey, Date.now())

    try {
      console.log(`\n${'='.repeat(60)}`)
      console.log(`[VERMELHO] INICIANDO PROCESSO`)
      console.log(`${'='.repeat(60)}`)
      console.log(`   Rodada ID: ${rodadaId}`)
      console.log(`   Usuario ID: ${usuarioId}`)
      console.log(`   Indicador ID: ${indicadorId || 'nenhum'}`)

      const estaEmRodadaAtiva = await this.usuarioEstaEmRodadaAtiva(usuarioId)
      if (estaEmRodadaAtiva) {
        console.log(
          `[VERMELHO] Usuário ${usuarioId} já está em outra rodada ativa. Colocando na fila.`
        )
        await User.findByIdAndUpdate(usuarioId, { aguardandoVermelho: true })
        return { rodada: null, transacao: null }
      }

      let rodada = await Rodada.findById(rodadaId)
      if (!rodada) throw new Error('Rodada não encontrada')

      if (rodada.participantes.some(p => p.usuario.toString() === usuarioId)) {
        console.warn(
          `[VERMELHO] Usuário ${usuarioId} já é participante da rodada ${rodada.nome}. Ignorando.`
        )
        return { rodada, transacao: null }
      }

      if (!rodada.verde) {
        const verdeParticipante = rodada.participantes.find(
          p => p.cor === 'verde'
        )
        if (verdeParticipante) {
          rodada.verde = verdeParticipante.usuario
          await rodada.save()
          console.log(`[VERMELHO] Campo verde restaurado para ${rodada.verde}.`)
        } else {
          console.log(
            `[VERMELHO] Rodada ${rodada.nome} não tem VERDE. Usuário vai para fila.`
          )
          await User.findByIdAndUpdate(usuarioId, { aguardandoVermelho: true })
          return { rodada, transacao: null }
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
        console.log(
          `[VERMELHO] Rodada não pode receber vermelhos (estrutura ou cheia). Usuário vai para fila.`
        )
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
        console.log(
          `[VERMELHO] Concorrência detectada: usuário ${usuarioId} já foi adicionado.`
        )
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
            console.log(
              `[QR] QR Code gerado com sucesso para transação ${transacao._id}`
            )
          } catch (qrError) {
            console.error(`[QR] ❌ Falha ao gerar QR Code:`, qrError.message)
          }
        } else {
          console.log(
            `[QR] ♻️ Transação já existente reaproveitada: ${transacao._id}`
          )
        }
      }

      if (
        rodada.participantes.length === 15 &&
        rodada.status === 'aguardando'
      ) {
        console.log(
          `Rodada ${rodada.nome} completou 15 participantes! Iniciando...`
        )
        await this.iniciarRodada(rodadaId)
      }

      let transacaoData = null
      if (transacao) {
        await transacao.populate('metadata')
        transacaoData = {
          id: transacao._id,
          qrCode: transacao.metadata?.qrCode,
          qrCodeImage: transacao.metadata?.qrCodeImage,
          expiraEm: transacao.metadata?.expiraEm,
          valor: transacao.valor
        }
      }

      console.log(`\n[VERMELHO] PROCESSO CONCLUÍDO COM SUCESSO!`)
      console.log(`   Usuario: ${(await User.findById(usuarioId)).nome}`)
      console.log(`   Rodada: ${rodada.nome}`)
      console.log(
        `   Transação: ${transacaoData ? transacaoData.id : 'nenhuma'}`
      )
      console.log(`${'='.repeat(60)}\n`)

      return { rodada, transacao: transacaoData }
    } catch (error) {
      console.error(`\n[VERMELHO] ERRO:`, error)
      throw error
    } finally {
      processandoVermelhoLock.delete(lockKey)
    }
  }

  // ===========================================
  // CRIAR TRANSACAO INDIVIDUAL PARA VERMELHO
  // ===========================================
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

      console.log(
        `Transacao criada para vermelho ${vermelhoId} pagar ao verde ${verdeId} (R$ ${valor})`
      )
      return transacao
    } catch (error) {
      console.error('Erro ao criar transacao para vermelho:', error)
      throw error
    }
  }

  // ===========================================
  // INICIAR RODADA (distribuir cores)
  // ===========================================
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
          console.log(
            `Rodada ${rodada.nome} já possui todos os participantes com cores definidas. Apenas iniciando.`
          )
          rodada.status = 'em_andamento'
          rodada.dataInicio = new Date()
          await rodada.save()

          // NOVO: notifica vermelhos a pagar
          this._notificarVermelhosPagar(rodada).catch(() => {})
          return rodada
        }

        if (amarelosRestantes.length === 8) {
          console.log(
            `Rodada ${rodada.nome} possui estrutura. Promovendo ${amarelosRestantes.length} amarelos para vermelho.`
          )
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

          // NOVO: notifica vermelhos a pagar
          this._notificarVermelhosPagar(rodada).catch(() => {})
          return rodada
        }

        throw new Error(
          `Estrutura definida, mas número de amarelos é ${amarelosRestantes.length} (esperado 0 ou 8).`
        )
      }

      console.log(
        `Rodada ${rodada.nome} sem estrutura. Distribuindo cores aleatoriamente.`
      )
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
          mensagem: `🎲 A rodada foi iniciada! Os 8 VERMELHOS devem pagar ${VALOR_VERMELHO_TEXTO} para que a rodada avance. O VERDE receberá ${PREMIO_VERDE_TEXTO} quando todos pagarem.`,
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

      // NOVO: notifica todos os vermelhos para pagar
      this._notificarVermelhosPagar(rodada).catch(() => {})

      console.log(`Rodada ${rodada.nome} iniciada com sucesso!`)
      return rodada
    } catch (error) {
      console.error('Erro ao iniciar rodada:', error)
      throw error
    }
  }

  // ===========================================
  // NOVO: notifica todos os vermelhos de uma rodada
  // ===========================================
  async _notificarVermelhosPagar (rodada) {
    const vermelhos = rodada.participantes.filter(p => p.cor === 'vermelho')
    for (const v of vermelhos) {
      try {
        const u = await User.findById(v.usuario).select('nome email')
        if (!u) continue

        pushService
          .enviarParaUsuario(u._id, {
            title: '💳 Você é VERMELHO!',
            body: `Pague ${VALOR_VERMELHO_TEXTO} pra rodada girar. Faltam 8 pagamentos.`,
            icon: '/icon-192.png',
            url: '/dashboard'
          })
          .catch(() => {})

        notificationService
          .criar({
            usuario: u._id,
            tipo: 'aviso',
            titulo: '💳 Você é VERMELHO!',
            mensagem: `Pague ${VALOR_VERMELHO_TEXTO} pra rodada girar.`,
            icone: '💳'
          })
          .catch(() => {})
      } catch (err) {
        console.error('❌ [_notificarVermelhosPagar]', err.message)
      }
    }
  }

  // ===========================================
  // CRIAR TRANSACOES INICIAIS (8 vermelhos)
  // ===========================================
  async criarTransacoesIniciais (rodadaId) {
    try {
      const rodada = await Rodada.findById(rodadaId)
      if (!rodada) throw new Error('Rodada nao encontrada')

      const transacoes = []
      const verde = rodada.verde
      const valor = VALOR_VERMELHO
      const vermelhos = rodada.participantes.filter(p => p.cor === 'vermelho')

      if (!verde) throw new Error('Verde nao definido')
      if (vermelhos.length === 0) throw new Error('Vermelhos nao definidos')

      for (const vermelhoId of vermelhos) {
        const existe = await Transacao.findOne({
          pagador: vermelhoId,
          rodada: rodadaId
        })

        if (!existe) {
          const transacao = new Transacao({
            tipo: 'deposito',
            pagador: vermelhoId,
            recebedor: verde,
            valor: valor,
            rodada: rodadaId,
            status: 'pendente'
          })

          await transacao.save()
          transacoes.push(transacao)

          const participante = rodada.participantes.find(
            p => p.usuario.toString() === vermelhoId.toString()
          )
          if (participante) {
            participante.transacaoId = transacao._id
          }
        }
      }

      if (transacoes.length > 0) {
        await rodada.save()
      }

      console.log(
        `${transacoes.length} transacoes criadas para rodada ${rodada.nome} (R$ ${valor} cada)`
      )
      return transacoes
    } catch (error) {
      console.error('Erro ao criar transacoes:', error)
      throw error
    }
  }

  // ===========================================
  // CONFIRMAR DEPOSITO
  // ===========================================
  async confirmarDeposito (transacaoId, comprovanteUrl, confirmadoPorId) {
    try {
      if (pagamentosProcessadosService.has(transacaoId)) {
        const processadoEm = pagamentosProcessadosService.get(transacaoId)
        const segundosDesdeProcessamento = (Date.now() - processadoEm) / 1000
        console.log(
          `[confirmarDeposito] Pagamento ${transacaoId} ja foi processado ha ${segundosDesdeProcessamento.toFixed(
            1
          )}s. Ignorando.`
        )
        return { transacao: null, todosDepositaram: false, jaProcessado: true }
      }

      pagamentosProcessadosService.set(transacaoId, Date.now())

      setTimeout(() => {
        if (pagamentosProcessadosService.has(transacaoId)) {
          pagamentosProcessadosService.delete(transacaoId)
          console.log(
            `[confirmarDeposito] Cache do pagamento ${transacaoId} removido apos 10 minutos`
          )
        }
      }, 10 * 60 * 1000)

      console.log(
        `[confirmarDeposito] Iniciando confirmacao de deposito para transacao: ${transacaoId}`
      )

      const transacao = await Transacao.findById(transacaoId)
      if (!transacao) {
        console.error(
          `[confirmarDeposito] Transacao nao encontrada: ${transacaoId}`
        )
        pagamentosProcessadosService.delete(transacaoId)
        throw new Error('Transacao nao encontrada')
      }

      console.log(`[confirmarDeposito] Transacao encontrada:`, {
        id: transacao._id,
        pagador: transacao.pagador,
        status: transacao.status,
        rodada: transacao.rodada
      })

      if (transacao.status !== 'pendente') {
        console.log(
          `[confirmarDeposito] Transacao ${transacaoId} ja foi processada. Status atual: ${transacao.status}`
        )
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
        console.error(
          `[confirmarDeposito] Rodada nao encontrada: ${transacao.rodada}`
        )
        pagamentosProcessadosService.delete(transacaoId)
        throw new Error('Rodada nao encontrada')
      }

      const participante = rodada.participantes.find(
        p => p.usuario.toString() === transacao.pagador.toString()
      )

      if (!participante) {
        console.error(
          `[confirmarDeposito] Participante nao encontrado na rodada para usuario: ${transacao.pagador}`
        )
        pagamentosProcessadosService.delete(transacaoId)
        throw new Error('Participante nao encontrado na rodada')
      }

      if (participante.depositoConfirmado === true) {
        console.log(
          `[confirmarDeposito] Participante ${participante.usuario} ja estava marcado como pago. Ignorando.`
        )
        pagamentosProcessadosService.delete(transacaoId)
        return { transacao, todosDepositaram: false, jaProcessado: true }
      }

      participante.depositoConfirmado = true
      participante.dataDeposito = new Date()
      participante.comprovantePix = comprovanteUrl

      const vermelhos = rodada.participantes.filter(p => p.cor === 'vermelho')
      const vermelhosPagos = vermelhos.filter(
        v => v.depositoConfirmado === true
      )

      rodada.totalDepositosConfirmados = vermelhosPagos.length
      await rodada.save()

      let todosDepositaram = false
      if (vermelhosPagos.length === vermelhos.length && vermelhos.length > 0) {
        console.log(
          `[confirmarDeposito] TODOS OS ${vermelhos.length} VERMELHOS PAGARAM!`
        )

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

  // ===========================================
  // CRIAR TRANSACOES PARA VERMELHOS
  // ===========================================
  async criarTransacoesParaVermelhos (rodadaId) {
    if (processandoTransacoesVemelhos.has(rodadaId)) {
      console.log(
        `[criarTransacoesParaVermelhos] Já processando transações para rodada ${rodadaId}. Ignorando.`
      )
      return []
    }
    processandoTransacoesVemelhos.set(rodadaId, Date.now())

    try {
      const rodada = await Rodada.findById(rodadaId)
      if (!rodada) throw new Error('Rodada nao encontrada')

      const verdeId = rodada.verde
      if (!verdeId) throw new Error('Verde nao definido na rodada')

      const vermelhos = rodada.participantes.filter(p => p.cor === 'vermelho')
      if (vermelhos.length === 0) {
        console.log(
          `Nenhum vermelho para criar transacoes na rodada ${rodada.nome}`
        )
        return []
      }

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

      console.log(
        `${transacoes.length} novas transacoes criadas para rodada ${rodada.nome}`
      )
      return transacoes
    } catch (error) {
      console.error('Erro ao criar transacoes para vermelhos:', error)
      throw error
    } finally {
      processandoTransacoesVemelhos.delete(rodadaId)
    }
  }

  // ===========================================
  // VERIFICAR SE TODOS DEPOSITARAM
  // ===========================================
  async verificarTodosDepositos (rodadaId) {
    try {
      console.log(`[DEBUG] Verificando depositos da rodada: ${rodadaId}`)

      const rodada = await Rodada.findById(rodadaId)
      if (!rodada) {
        console.error(`[DEBUG] Rodada nao encontrada: ${rodadaId}`)
        throw new Error('Rodada nao encontrada')
      }

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

  // ===========================================
  // ALOCAR FILA EM TODAS AS RODADAS COM VAGAS
  // ===========================================
  async alocarFilaEmTodasRodadas () {
    if (alocandoFila) {
      console.log(
        '[ALOCAR FILA] Já existe uma alocação em andamento. Ignorando...'
      )
      return 0
    }
    alocandoFila = true

    console.log(`\n${'='.repeat(60)}`)
    console.log(`[ALOCAR FILA TOTAL] Verificando todas as rodadas com vagas`)
    console.log(`${'='.repeat(60)}`)

    try {
      let rodadasComVagas = await Rodada.find({
        status: { $in: ['aguardando', 'em_andamento'] },
        $expr: {
          $lt: [
            {
              $size: {
                $filter: {
                  input: '$participantes',
                  as: 'p',
                  cond: { $eq: ['$$p.cor', 'vermelho'] }
                }
              }
            },
            8
          ]
        }
      }).sort({ createdAt: 1 })

      if (rodadasComVagas.length === 0) {
        console.log(`   Nenhuma rodada com vaga para vermelho`)
        alocandoFila = false
        return 0
      }

      let totalVagas = 0
      for (const rodada of rodadasComVagas) {
        const vermelhosAtuais = rodada.participantes.filter(
          p => p.cor === 'vermelho'
        ).length
        totalVagas += 8 - vermelhosAtuais
        console.log(
          `   ${rodada.nome}: ${
            8 - vermelhosAtuais
          } vagas (${vermelhosAtuais}/8)`
        )
      }

      const filaUsuarios = await User.find({ aguardandoVermelho: true }).sort({
        posicaoFila: 1
      })
      if (filaUsuarios.length === 0) {
        console.log(`   Nenhum usuário na fila`)
        alocandoFila = false
        return 0
      }

      console.log(`\n   Total de vagas disponíveis: ${totalVagas}`)
      console.log(`   Usuários na fila: ${filaUsuarios.length}`)
      console.log(
        `   Serão alocados: ${Math.min(
          totalVagas,
          filaUsuarios.length
        )} usuários`
      )

      let alocados = 0
      let indexFila = 0

      for (
        let i = 0;
        i < rodadasComVagas.length && indexFila < filaUsuarios.length;
        i++
      ) {
        let rodadaAtual = await Rodada.findById(rodadasComVagas[i]._id)
        if (!rodadaAtual) continue

        let vermelhosAtuais = rodadaAtual.participantes.filter(
          p => p.cor === 'vermelho'
        ).length
        if (vermelhosAtuais >= 8) {
          console.log(`   Rodada ${rodadaAtual.nome} já está cheia. Ignorando.`)
          continue
        }

        let vagasRestantes = 8 - vermelhosAtuais
        console.log(
          `\n   Processando ${rodadaAtual.nome}: ${vagasRestantes} vagas`
        )

        while (vagasRestantes > 0 && indexFila < filaUsuarios.length) {
          rodadaAtual = await Rodada.findById(rodadaAtual._id)
          if (!rodadaAtual) break

          vermelhosAtuais = rodadaAtual.participantes.filter(
            p => p.cor === 'vermelho'
          ).length
          if (vermelhosAtuais >= 8) {
            console.log(
              `   Rodada ${rodadaAtual.nome} agora está cheia. Saindo do loop.`
            )
            break
          }
          vagasRestantes = 8 - vermelhosAtuais
          if (vagasRestantes <= 0) break

          const usuario = filaUsuarios[indexFila]
          console.log(
            `      Alocando Pos ${usuario.posicaoFila}: ${usuario.nome}`
          )

          const usuarioAtual = await User.findById(usuario._id)
          if (!usuarioAtual.aguardandoVermelho) {
            console.log(`         ⚠️ Usuário não está mais na fila. Pulando...`)
            indexFila++
            continue
          }

          if (
            usuarioAtual.rodadaBloqueada &&
            usuarioAtual.rodadaBloqueada.toString() ===
              rodadaAtual._id.toString()
          ) {
            console.log(
              `         ⛔ Usuário bloqueado para esta rodada. Avançando...`
            )
            indexFila++
            continue
          }

          const emRodadaAtiva = await this.usuarioEstaEmRodadaAtiva(usuario._id)
          if (emRodadaAtiva) {
            console.log(
              `         ⚠️ Usuário já está em rodada ativa. Removendo da fila...`
            )
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
            console.warn(
              `         ⚠️ Usuário ${usuario.nome} já está na rodada ${rodadaAtual.nome}. Removendo da fila.`
            )
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
            console.error(
              `         ❌ Erro ao adicionar participante: ${error.message}`
            )
            adicionado = false
          }

          if (adicionado) {
            // Pagamento automático com saldo
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

                console.log(
                  `💰 Pagamento automático (fila): usuário ${usuario.nome} pagou R$${VALOR_VERMELHO} com saldo.`
                )
              }
            }

            // NOVO: notifica o usuário que saiu da fila
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
                  .catch(err => console.error('❌ [push] fila:', err.message))

                notificationService
                  .filaAlocado(usuarioNotif._id, rodadaAtual.nome)
                  .catch(err => console.error('❌ [notif] fila:', err.message))

                activityService
                  .filaAlocado(
                    usuarioNotif._id,
                    usuarioNotif.nome,
                    rodadaAtual._id
                  )
                  .catch(err =>
                    console.error('❌ [activity] fila:', err.message)
                  )
              }
            } catch (err) {
              console.error('❌ [alocarFila notif] erro:', err.message)
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
            console.log(`         Alocado como VERMELHO na ${rodadaAtual.nome}`)
            alocados++
            indexFila++
            rodadaAtual = await Rodada.findById(rodadaAtual._id)
            vermelhosAtuais = rodadaAtual.participantes.filter(
              p => p.cor === 'vermelho'
            ).length
            vagasRestantes = 8 - vermelhosAtuais
          } else {
            console.log(
              `         ⚠️ Falha ao alocar ${usuario.nome}. Mantendo na fila.`
            )
            indexFila++
          }
        }

        if (indexFila >= filaUsuarios.length) {
          console.log(`   Fim da fila alcançado`)
          break
        }
      }

      const restantes = await User.countDocuments({ aguardandoVermelho: true })
      console.log(`\nALOCAÇÃO TOTAL CONCLUÍDA: ${alocados} usuários alocados`)
      console.log(`   Restam na fila: ${restantes} (aguardando próximas vagas)`)
      console.log(`${'='.repeat(60)}\n`)

      alocandoFila = false
      return alocados
    } catch (error) {
      console.error('[ALOCAR FILA] Erro na alocação:', error)
      alocandoFila = false
      throw error
    }
  }

  // ===========================================
  // AVANCAR RODADA - PROMOVER CORES E GERAR NOVAS RODADAS
  // ===========================================
  async avancarRodada (rodadaId) {
    if (processandoRodadas.has(rodadaId)) {
      console.log(
        `[avancarRodada] Rodada ${rodadaId} já está sendo processada. Ignorando.`
      )
      return null
    }
    processandoRodadas.set(rodadaId, Date.now())

    setTimeout(() => {
      if (processandoRodadas.has(rodadaId)) {
        processandoRodadas.delete(rodadaId)
        console.log(
          `[avancarRodada] Cache da rodada ${rodadaId} removido (timeout)`
        )
      }
    }, 30 * 1000)

    try {
      console.log(`[DEBUG] INICIANDO avancarRodada para: ${rodadaId}`)

      const rodada = await Rodada.findById(rodadaId)
      if (!rodada) throw new Error('Rodada não encontrada')

      if (rodada.status === 'concluida') {
        console.log(
          `[DEBUG] Rodada ${rodada.nome} já está concluída. Ignorando.`
        )
        return rodada
      }

      if (rodada.status !== 'em_andamento') {
        throw new Error(
          `Rodada não está em andamento. Status: ${rodada.status}`
        )
      }

      if (rodada.rodadasGeradas && rodada.rodadasGeradas.length > 0) {
        console.log(
          `[DEBUG] Rodada ${rodada.nome} já gerou rodadas. Ignorando.`
        )
        return rodada
      }

      const vermelhos = rodada.participantes.filter(p => p.cor === 'vermelho')
      const vermelhosPagos = vermelhos.filter(
        v => v.depositoConfirmado === true
      )

      if (vermelhosPagos.length !== 8) {
        console.log(
          `[DEBUG] Apenas ${vermelhosPagos.length}/8 vermelhos pagaram. Aguardando...`
        )
        return rodada
      }

      console.log(`[DEBUG] Todos os 8 vermelhos pagaram! Prosseguindo...`)

      const verdeAtual = rodada.participantes.find(p => p.cor === 'verde')
      console.log(
        `[DEBUG] Verde atual que ganhou R$ ${PREMIO_VERDE}: ${verdeAtual?.usuario}`
      )

      // ===========================================
      // Promover cores + emitir notificações
      // ===========================================
      console.log(`[DEBUG] Promovendo cores...`)

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
          console.log(`   ${corAnterior}->${corNova} ${p.usuario}`)

          if (corNova === 'concluido') {
            try {
              await User.findByIdAndUpdate(p.usuario, {
                $inc: { saldoPremio: PREMIO_VERDE, totalGanho: PREMIO_VERDE }
              })
              console.log(
                `   💰 Prêmio de R$ ${PREMIO_VERDE} creditado ao usuário ${p.usuario}`
              )
            } catch (err) {
              console.error(`   ❌ Erro ao creditar prêmio: ${err.message}`)
            }
          }

          notificacoesPosPromocao.push({
            usuarioId: p.usuario,
            corAnterior,
            corNova
          })
        }
      }

      // NOVO: dispara notificações DEPOIS do loop
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
              console.error('❌ [avancarRodada notif]', err.message)
            }
          }
        })
      }

      // Remove duplicatas
      const uniqueMap = new Map()
      for (const p of rodada.participantes) {
        const key = p.usuario.toString()
        if (!uniqueMap.has(key)) {
          uniqueMap.set(key, p)
        } else {
          console.warn(
            `⚠️ Duplicata removida para usuário ${key} na rodada ${rodada.nome}`
          )
        }
      }
      rodada.participantes = Array.from(uniqueMap.values())

      const novosVerdes = rodada.participantes.filter(p => p.cor === 'verde')
      const novosPretos = rodada.participantes.filter(p => p.cor === 'preto')
      const novosAzuis = rodada.participantes.filter(p => p.cor === 'azul')

      console.log(
        `[DEBUG] Após promoção: Verdes: ${novosVerdes.length}, Pretos: ${novosPretos.length}, Azuis: ${novosAzuis.length}`
      )

      if (novosVerdes.length !== 2) {
        console.error(
          `[DEBUG] ERRO: Número de verdes insuficiente: ${novosVerdes.length}. Esperado: 2`
        )
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

      console.log(`[DEBUG] Criando rodada #${proximoNumero}...`)
      const novaRodada1 = await this.criarRodadaAvancada(
        proximoNumero,
        verdesIds[0],
        grupo1Pretos,
        grupo1Azuis,
        rodada._id
      )

      console.log(`[DEBUG] Criando rodada #${proximoNumero + 1}...`)
      const novaRodada2 = await this.criarRodadaAvancada(
        proximoNumero + 1,
        verdesIds[1],
        grupo2Pretos,
        grupo2Azuis,
        rodada._id
      )

      rodada.rodadasGeradas = [novaRodada1._id, novaRodada2._id]
      console.log(`[DEBUG] Rodadas geradas com sucesso!`)

      await this.alocarFilaEmTodasRodadas()

      console.log(
        `\n[FINALIZACAO] Finalizando rodada original como concluída...`
      )
      rodada.historicoMovimentacoes.push({
        usuario: verdeAtual.usuario,
        corAnterior: 'verde',
        corNova: 'concluido',
        observacao: `RODADA CONCLUÍDA! Prêmio de ${PREMIO_VERDE_TEXTO} disponível para saque.`,
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
            console.log(
              `[avancarRodada] Conflito de versão (tentativa ${tentativas}/${maxTentativas}). Recarregando documento...`
            )
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
          `Não foi possível salvar a rodada após ${maxTentativas} tentativas.`
        )
      }

      console.log(`[FINALIZACAO] Rodada ${rodada.nome} concluída com sucesso!`)
      console.log(`   🏆 Verde vencedor ganhou R$ ${PREMIO_VERDE}`)
      console.log(`   Novas rodadas geradas: ${rodada.rodadasGeradas.length}`)

      if (ioInstance) {
        const mensagemConclusao = new ChatMessage({
          rodadaId: rodada._id,
          mensagem: `🏆 PARABÉNS! A rodada foi concluída. O VERDE ganhou ${PREMIO_VERDE_TEXTO}! Duas novas rodadas foram criadas.`,
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
      console.error('Erro ao avançar rodada:', error)
      throw error
    } finally {
      processandoRodadas.delete(rodadaId)
      console.log(`[avancarRodada] Cache da rodada ${rodadaId} removido`)
    }
  }

  // ===========================================
  // CRIAR RODADA AVANÇADA (auxiliar)
  // ===========================================
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

      console.log(
        `Rodada avancada ${rodada.nome} criada com ${rodada.participantes.length} participantes`
      )
      return rodada
    } catch (error) {
      console.error('Erro ao criar rodada avancada:', error)
      throw error
    }
  }

  // ===========================================
  // UTILITARIOS
  // ===========================================
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
          $elemMatch: {
            usuario: usuarioId,
            cor: { $ne: 'concluido' }
          }
        }
      })

      if (rodada) {
        const participante = rodada.participantes.find(
          p => p.usuario.toString() === usuarioIdStr
        )
        console.log(
          `[buscarRodadaAtivaDoUsuario] ${usuarioIdStr} na ${
            rodada.nome
          } → cor: ${participante?.cor ?? 'NÃO ENCONTRADO'}`
        )
      }

      return rodada
    } catch (error) {
      console.error('Erro ao buscar rodada ativa:', error)
      return null
    }
  }

  async buscarRodadaParaNovoVermelho (usuarioId) {
    try {
      console.log(`\n${'='.repeat(60)}`)
      console.log(`[buscarRodadaParaNovoVermelho] INICIANDO BUSCA`)
      console.log(`${'='.repeat(60)}`)
      console.log(`   Usuario ID: ${usuarioId}`)

      const user = await User.findById(usuarioId)
      console.log(`   Usuario: ${user?.nome || 'nao encontrado'}`)

      const rodadasDoUsuario = await Rodada.find({
        'participantes.usuario': usuarioId,
        status: { $in: ['em_andamento', 'aguardando'] }
      }).sort({ numero: -1 })

      console.log(`\nRODADAS ENCONTRADAS: ${rodadasDoUsuario.length}`)

      if (rodadasDoUsuario.length === 0) {
        console.log(`   Nenhuma rodada encontrada para o usuario`)
        console.log(`${'='.repeat(60)}\n`)
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
          console.log(`   Rodada ${rodada.nome} SELECIONADA!`)
          return rodada
        }
      }

      console.log(
        `\n   Nenhuma rodada com estrutura e vagas encontrada. Usuário irá para FILA.`
      )
      console.log(`${'='.repeat(60)}\n`)
      return null
    } catch (error) {
      console.error('Erro ao buscar rodada para novo vermelho:', error)
      return null
    }
  }

  async buscarRodadaParaConvite (usuarioId) {
    try {
      const rodadaDoUsuario = await this.buscarRodadaParaNovoVermelho(usuarioId)
      if (rodadaDoUsuario) return rodadaDoUsuario

      const rodadaComVagas = await Rodada.findOne({
        status: 'em_andamento',
        'participantes.0': { $exists: true }
      }).sort({ numero: -1 })

      if (rodadaComVagas) {
        const vermelhosAtuais = rodadaComVagas.participantes.filter(
          p => p.cor === 'vermelho'
        ).length
        if (vermelhosAtuais < 8) return rodadaComVagas
      }

      return null
    } catch (error) {
      console.error('Erro ao buscar rodada para convite:', error)
      return null
    }
  }

  async garantirRodadaParaUsuario (usuarioId) {
    try {
      let rodada = await this.buscarRodadaAtivaDoUsuario(usuarioId)
      if (!rodada) {
        console.log(`Criando rodada automatica para usuario ${usuarioId}`)
        rodada = await this.criarRodada(usuarioId)
      }
      return rodada
    } catch (error) {
      console.error('Erro ao garantir rodada:', error)
      throw error
    }
  }

  async buscarHistoricoUsuario (usuarioId) {
    try {
      const rodadas = await Rodada.find({
        'participantes.usuario': usuarioId
      }).sort({ numero: -1 })
      return rodadas
    } catch (error) {
      console.error('Erro ao buscar historico:', error)
      throw error
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
        posicaoFila: usuario?.posicaoFila || null
      }
    } catch (error) {
      console.error('Erro ao verificar status:', error)
      throw error
    }
  }

  async verificarEAvancarSeNecessario (rodadaId) {
    try {
      console.log(
        `[AUTO] Verificando rodada ${rodadaId} para avanco automatico...`
      )

      const rodada = await Rodada.findById(rodadaId)
      if (!rodada) {
        console.error(`[AUTO] Rodada nao encontrada: ${rodadaId}`)
        return false
      }

      if (rodada.status === 'concluida') {
        console.log(`[AUTO] Rodada ${rodada.nome} ja esta concluida.`)
        return true
      }

      if (rodada.rodadasGeradas && rodada.rodadasGeradas.length > 0) {
        console.log(
          `[AUTO] Rodada ${rodada.nome} ja gerou ${rodada.rodadasGeradas.length} rodadas. Ignorando.`
        )
        return true
      }

      if (rodada.status !== 'em_andamento') {
        console.log(
          `[AUTO] Rodada ${rodada.nome} nao esta em andamento (status: ${rodada.status})`
        )
        return false
      }

      const vermelhos = rodada.participantes.filter(p => p.cor === 'vermelho')
      const vermelhosPagos = vermelhos.filter(
        v => v.depositoConfirmado === true
      )
      const todosPagos = vermelhosPagos.length === 8

      console.log(
        `[AUTO] Rodada ${rodada.nome}: ${vermelhosPagos.length}/8 vermelhos pagos`
      )

      if (todosPagos) {
        console.log(`[AUTO] Todos pagaram! Avancando rodada...`)
        await this.avancarRodada(rodadaId)
        console.log(`[AUTO] Rodada ${rodada.nome} avancada com sucesso!`)
        return true
      }

      return false
    } catch (error) {
      console.error('[AUTO] Erro ao verificar e avancar:', error)
      return false
    }
  }

  // ===========================================
  // JOGAR NOVAMENTE
  // ===========================================
  async jogarNovamente (usuarioId) {
    try {
      console.log(`\n[REENTRADA] Usuario ${usuarioId} quer jogar novamente`)

      const usuario = await User.findById(usuarioId)
      if (!usuario) throw new Error('Usuario nao encontrado')

      const saldoAtual = Number(usuario.saldoPremio) || 0
      console.log(`💰 Saldo de prêmio atual: R$ ${saldoAtual}`)
      console.log(
        `⏳ Aguardando vermelho: ${usuario.aguardandoVermelho || false}`
      )
      console.log(`📍 Posição na fila: ${usuario.posicaoFila || 'nenhuma'}`)

      // 1. Cancelar saque pendente
      const SolicitacaoSaque = require('../models/SolicitacaoSaque')
      const solicitacaoPendente = await SolicitacaoSaque.findOne({
        usuario: usuarioId,
        status: 'pendente'
      })
      if (solicitacaoPendente) {
        console.log(`⏳ Saque pendente encontrado. Cancelando...`)
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

      // 2. Se já está na fila, tenta alocar
      if (usuario.aguardandoVermelho) {
        let rodadaExistente = await Rodada.findOne({
          status: 'em_andamento',
          $expr: {
            $lt: [
              {
                $size: {
                  $filter: {
                    input: '$participantes',
                    as: 'p',
                    cond: { $eq: ['$$p.cor', 'vermelho'] }
                  }
                }
              },
              8
            ]
          }
        }).sort({ createdAt: 1 })

        if (!rodadaExistente) {
          rodadaExistente = await Rodada.findOne({
            status: 'aguardando',
            verde: { $ne: null },
            pretos: { $ne: [] },
            azuis: { $ne: [] },
            $expr: {
              $lt: [
                {
                  $size: {
                    $filter: {
                      input: '$participantes',
                      as: 'p',
                      cond: { $eq: ['$$p.cor', 'vermelho'] }
                    }
                  }
                },
                8
              ]
            }
          }).sort({ createdAt: 1 })
        }

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
            message: `⏳ Você já está na fila de espera! Posição: ${usuario.posicaoFila} de ${totalNaFila}.`,
            cor: 'amarelo',
            aguardando: true,
            posicao: usuario.posicaoFila,
            totalNaFila,
            pagoAutomaticamente: false,
            saldoRestante: saldoAtual
          }
        }
      }

      // 3. Verificar rodada ativa
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

      // 4. Buscar rodada com vaga
      let rodadaParaEntrar = await Rodada.findOne({
        status: 'em_andamento',
        $expr: {
          $lt: [
            {
              $size: {
                $filter: {
                  input: '$participantes',
                  as: 'p',
                  cond: { $eq: ['$$p.cor', 'vermelho'] }
                }
              }
            },
            8
          ]
        }
      }).sort({ createdAt: 1 })

      if (!rodadaParaEntrar) {
        rodadaParaEntrar = await Rodada.findOne({
          status: 'aguardando',
          verde: { $ne: null },
          pretos: { $ne: [] },
          azuis: { $ne: [] },
          $expr: {
            $lt: [
              {
                $size: {
                  $filter: {
                    input: '$participantes',
                    as: 'p',
                    cond: { $eq: ['$$p.cor', 'vermelho'] }
                  }
                }
              },
              8
            ]
          }
        }).sort({ createdAt: 1 })
      }

      // 5. Caso 1: rodada encontrada
      if (rodadaParaEntrar) {
        console.log(`Rodada encontrada: ${rodadaParaEntrar.nome}`)

        if (usuario.aguardandoVermelho) {
          usuario.aguardandoVermelho = false
          usuario.posicaoFila = null
          usuario.dataEntradaFila = null
          await usuario.save()
        }

        await this.adicionarParticipanteVermelho(
          rodadaParaEntrar._id,
          usuarioId,
          null
        )

        const verdeId = rodadaParaEntrar.verde
        let transacaoId = null
        if (!verdeId) {
          console.log(
            `⚠️ Rodada ${rodadaParaEntrar.nome} não tem VERDE definido!`
          )
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
            console.log(
              `💰 Pagando com saldo. Desconto de R$ ${VALOR_VERMELHO}.`
            )

            transacao.status = 'confirmado'
            transacao.dataConfirmacao = new Date()
            transacao.metadata = {
              pagoComSaldo: true,
              valorDescontado: VALOR_VERMELHO
            }
            await transacao.save()

            const rodadaAtualizada = await Rodada.findById(rodadaParaEntrar._id)
            if (!rodadaAtualizada)
              throw new Error('Rodada não encontrada após adicionar')

            const participante = rodadaAtualizada.participantes.find(
              p => p.usuario.toString() === usuarioId.toString()
            )
            if (!participante)
              throw new Error('Participante não encontrado após pagar')

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
            console.log(`Pago. Saldo restante: R$ ${saldoRestante}`)

            if (
              pagos.length === 8 &&
              rodadaAtualizada.participantes.length === 15
            ) {
              await this.verificarEAvancarSeNecessario(rodadaParaEntrar._id)
            }
          }
        }

        // NOVO: activity de reentrada
        try {
          const u = await User.findById(usuarioId).select('nome')
          if (u) {
            activityService
              .entrada(usuarioId, u.nome, rodadaParaEntrar._id)
              .catch(() => {})
          }
        } catch (err) {
          console.error('❌ [jogarNovamente activity]', err.message)
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

      // 6. Caso 2: fila
      console.log(`❌ Nenhuma rodada com vaga. Indo para a FILA.`)
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
        message: `⏳ Você foi colocado na fila de espera (posição ${usuario.posicaoFila} de ${totalFila}).`,
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

  // ===========================================
  // INICIALIZAR IO
  // ===========================================
  initializeIo (io) {
    ioInstance = io
    console.log('io inicializado no RodadaService')
  }
}

module.exports = new RodadaService()
