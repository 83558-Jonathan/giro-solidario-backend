const User = require('../models/User')
const Comissao = require('../models/Comissao')
const { COMISSAO_INDICACAO } = require('../config/constantes')
const activityService = require('./activityService')
const notificationService = require('./notificationService')

/**
 * Processa uma comissão de indicação (única ou recorrente).
 *
 * Regras:
 *  - Comum: paga 1x (participanteJaRecebeu controla)
 *  - Influenciador + indicado criado DEPOIS de virar influenciador: paga sempre
 *  - Influenciador + indicado ANTERIOR: paga 1x (regra comum)
 *
 * Anti-duplicidade:
 *  - Checa Comissao.findOne({ transacao })
 *  - Índice unique na transacao protege contra race
 */
async function processarComissao ({
  indicadorId,
  indicadoId,
  transacaoId,
  rodadaId = null,
  participanteJaRecebeu = false,
  source = 'sistema'
}) {
  try {
    if (!indicadorId || !indicadoId || !transacaoId) {
      return { success: false, reason: 'dados_incompletos' }
    }

    // Anti-duplicidade: já existe comissão para esta transação?
    const jaExiste = await Comissao.findOne({ transacao: transacaoId }).lean()
    if (jaExiste) {
      console.log(
        `[COMISSAO][${source}] Comissao ja registrada para transacao ${transacaoId} (tipo: ${jaExiste.tipo}). Ignorando.`
      )
      return { success: false, reason: 'ja_registrada', tipo: jaExiste.tipo }
    }

    // Busca indicador + indicado
    const [indicador, indicado] = await Promise.all([
      User.findById(indicadorId).select(
        'nome saldoPremio isInfluenciador dataInfluenciador'
      ),
      User.findById(indicadoId).select('nome createdAt')
    ])

    if (!indicador) {
      console.log(
        `[COMISSAO][${source}] Indicador ${indicadorId} nao encontrado. Ignorando.`
      )
      return { success: false, reason: 'indicador_nao_encontrado' }
    }

    // Decide tipo de comissão
    let tipo = 'unica'
    let devePagar = false

    const ehInfluenciador =
      indicador.isInfluenciador === true && indicador.dataInfluenciador

    if (ehInfluenciador) {
      const dataCriacaoIndicado = indicado?.createdAt
        ? new Date(indicado.createdAt)
        : new Date(0)
      const dataInfluenciador = new Date(indicador.dataInfluenciador)

      if (dataCriacaoIndicado >= dataInfluenciador) {
        // Indicado criado DEPOIS de virar influenciador → recorrente
        devePagar = true
        tipo = 'recorrente'
        console.log(
          `[COMISSAO][${source}] Influenciador ${indicador.nome} - indicado ${indicado?.nome} foi criado APOS virar influenciador. Pagando RECORRENTE.`
        )
      } else {
        // Indicado antigo → só paga única se ainda não pagou
        devePagar = !participanteJaRecebeu
        tipo = 'unica'
        console.log(
          `[COMISSAO][${source}] Influenciador ${indicador.nome} - indicado ${indicado?.nome} e ANTERIOR. Pagando so UNICA (jaRecebeu=${participanteJaRecebeu}).`
        )
      }
    } else {
      devePagar = !participanteJaRecebeu
      tipo = 'unica'
    }

    if (!devePagar) {
      console.log(
        `[COMISSAO][${source}] Comissao nao aplicavel (indicador=${indicador.nome}, jaRecebeu=${participanteJaRecebeu}). Ignorando.`
      )
      return { success: false, reason: 'ja_paga' }
    }

    // Registra a comissão (índice unique protege contra race)
    await Comissao.create({
      indicador: indicador._id,
      indicado: indicadoId,
      transacao: transacaoId,
      rodada: rodadaId,
      valor: COMISSAO_INDICACAO,
      tipo
    })

    // Credita no saldo do indicador
    const inc = {
      saldoPremio: COMISSAO_INDICACAO,
      totalComissao: COMISSAO_INDICACAO
    }
    // Só incrementa o contador de "indicados comissionados" para o tipo 'unica'
    if (tipo === 'unica') {
      inc.totalIndicacoesComissionadas = 1
    }

    await User.updateOne({ _id: indicador._id }, { $inc: inc })

    console.log(
      `[COMISSAO][${source}] ✅ R$${COMISSAO_INDICACAO} (${tipo}) creditada para ${
        indicador.nome
      } (indicou ${indicado?.nome || '?'})`
    )

    // Notificações
    const nomeIndicado = indicado?.nome || 'Alguem'
    const primeiroNome = nomeIndicado.split(' ')[0]

    activityService
      .comissaoRecebida(
        indicador._id,
        indicador.nome,
        nomeIndicado,
        COMISSAO_INDICACAO
      )
      .catch(err => console.error('[activity comissao]', err.message))

    notificationService
      .comissaoRecebida(indicador._id, primeiroNome, COMISSAO_INDICACAO)
      .catch(err => console.error('[notif comissao]', err.message))

    return {
      success: true,
      tipo,
      valor: COMISSAO_INDICACAO,
      indicadorNome: indicador.nome
    }
  } catch (err) {
    // E11000 = duplicidade no índice unique (race condition)
    if (err.code === 11000) {
      console.log(
        `[COMISSAO][${source}] Race condition detectada para transacao ${transacaoId}. Ignorando.`
      )
      return { success: false, reason: 'race_condition' }
    }
    console.error(`[COMISSAO][${source}] Erro:`, err.message)
    return { success: false, reason: 'erro', error: err.message }
  }
}

module.exports = { processarComissao }
