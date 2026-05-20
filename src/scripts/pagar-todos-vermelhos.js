// pagar-todos-vermelhos.js
// Execute: node src/scripts/pagar-todos-vermelhos.js

const mongoose = require('mongoose')
require('dotenv').config()

const Rodada = require('../models/Rodada')
const Transacao = require('../models/Transacao')
const User = require('../models/User')
const RodadaService = require('../services/rodadaService')

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  bright: '\x1b[1m'
}

function logSuccess (msg) {
  console.log(`${colors.green}✅ ${msg}${colors.reset}`)
}
function logError (msg) {
  console.log(`${colors.red}❌ ${msg}${colors.reset}`)
}
function logInfo (msg) {
  console.log(`${colors.blue}📌 ${msg}${colors.reset}`)
}
function logWarning (msg) {
  console.log(`${colors.yellow}⚠️ ${msg}${colors.reset}`)
}
function logSection (title) {
  console.log(`\n${colors.cyan}${'='.repeat(70)}${colors.reset}`)
  console.log(`${colors.bright}${colors.magenta}${title}${colors.reset}`)
  console.log(`${colors.cyan}${'='.repeat(70)}${colors.reset}`)
}

async function main () {
  console.log(
    `\n${colors.bright}${colors.magenta}${'💰'.repeat(35)}${colors.reset}`
  )
  console.log(
    `${colors.bright}${colors.magenta}    PAGAMENTO AUTOMÁTICO DE TODOS OS VERMELHOS    ${colors.reset}`
  )
  console.log(
    `${colors.bright}${colors.magenta}${'💰'.repeat(35)}${colors.reset}\n`
  )

  try {
    const MONGODB_URI =
      process.env.MONGODB_URI || 'mongodb://localhost:27017/giro-solidario'
    logInfo(`Conectando ao MongoDB: ${MONGODB_URI}`)
    await mongoose.connect(MONGODB_URI)
    logSuccess('Conectado ao MongoDB')

    const admin = await User.findOne({ email: 'admin@giropremiados.com.br' })
    if (!admin) {
      logError('Admin não encontrado!')
      return
    }
    logInfo(`Admin: ${admin.nome} (${admin.email})`)

    // ===========================================
    // 1. Buscar TODAS as rodadas que podem ter vermelhos pendentes
    //    (em_andamento ou aguardando com estrutura e verde definido)
    // ===========================================
    const rodadas = await Rodada.find({
      $or: [
        { status: 'em_andamento' },
        {
          status: 'aguardando',
          verde: { $ne: null },
          pretos: { $ne: [] },
          azuis: { $ne: [] }
        }
      ]
    }).sort({ numero: 1 })

    logSection(
      `ENCONTRADAS ${rodadas.length} RODADA(S) COM POSSÍVEIS VERMELHOS`
    )

    let totalPagos = 0
    let totalErros = 0

    for (const rodada of rodadas) {
      console.log(
        `\n${colors.cyan}📋 Processando ${rodada.nome}${colors.reset}`
      )
      console.log(`   Status: ${rodada.status}`)
      console.log(`   Verde definido: ${rodada.verde ? 'SIM' : 'NÃO'}`)
      console.log(`   Participantes: ${rodada.participantes.length}/15`)

      // Buscar vermelhos que ainda NÃO pagaram
      const vermelhosNaoPagos = rodada.participantes.filter(
        p => p.cor === 'vermelho' && p.depositoConfirmado !== true
      )

      if (vermelhosNaoPagos.length === 0) {
        logSuccess(`   Nenhum vermelho pendente nesta rodada.`)
        continue
      }

      console.log(`   🔴 Vermelhos pendentes: ${vermelhosNaoPagos.length}`)

      // Para cada vermelho pendente, encontrar a transação associada (deve existir)
      for (const participante of vermelhosNaoPagos) {
        const usuario = await User.findById(participante.usuario)
        console.log(
          `\n   💰 Processando ${usuario?.nome || participante.usuario}...`
        )

        // Buscar transação pendente para este usuário nesta rodada
        let transacao = null
        if (participante.transacaoId) {
          transacao = await Transacao.findById(participante.transacaoId)
        }
        if (!transacao) {
          transacao = await Transacao.findOne({
            pagador: participante.usuario,
            rodada: rodada._id,
            status: 'pendente'
          })
        }

        if (!transacao) {
          logWarning(
            `      ⚠️ Nenhuma transação pendente encontrada para ${
              usuario?.nome || participante.usuario
            }. Pulando.`
          )
          totalErros++
          continue
        }

        // Confirmar depósito usando o serviço (já tem controle de duplicidade)
        try {
          await RodadaService.confirmarDeposito(
            transacao._id.toString(),
            `pagamento_auto_${Date.now()}_${transacao._id}.png`,
            admin._id.toString()
          )
          logSuccess(`      ✅ Pagamento confirmado!`)
          totalPagos++

          // Pequeno delay para não sobrecarregar e permitir que o `avancarRodada` (se acionado) possa executar
          await new Promise(resolve => setTimeout(resolve, 300))
        } catch (err) {
          logError(`      ❌ Erro ao confirmar pagamento: ${err.message}`)
          totalErros++
        }
      }
    }

    // ===========================================
    // 2. Verificar resultado final (incluindo possíveis novas rodadas geradas)
    // ===========================================
    logSection('RESULTADO FINAL')

    // Buscar todas as rodadas novamente (algumas podem ter avançado)
    const todasRodadas = await Rodada.find({}).sort({ numero: 1 })

    console.log(`\n📊 STATUS DAS RODADAS APÓS PAGAMENTOS:\n`)

    for (const rodada of todasRodadas) {
      const vermelhos = rodada.participantes.filter(p => p.cor === 'vermelho')
      const vermelhosPagos = vermelhos.filter(
        v => v.depositoConfirmado === true
      )

      let icon = '🔄'
      if (rodada.status === 'concluida') icon = '✅'
      else if (rodada.status === 'aguardando') icon = '⏳'

      console.log(
        `   ${icon} ${rodada.nome} (${rodada.status}) – Pagamentos: ${vermelhosPagos.length}/${vermelhos.length}`
      )

      if (rodada.status === 'concluida' && rodada.rodadasGeradas?.length) {
        console.log(
          `      → Gerou ${rodada.rodadasGeradas.length} nova(s) rodada(s):`
        )
        for (const id of rodada.rodadasGeradas) {
          const novaRodada = await Rodada.findById(id)
          if (novaRodada) {
            console.log(
              `         📌 ${novaRodada.nome} (${novaRodada.participantes.length}/15 participantes)`
            )
          }
        }
      }
    }

    // Verificar fila restante
    const filaRestante = await User.find({ aguardandoVermelho: true }).sort({
      posicaoFila: 1
    })

    console.log(`\n⏳ FILA DE ESPERA:`)
    if (filaRestante.length === 0) {
      logSuccess(`   ✅ Fila vazia! Todos os usuários foram alocados.`)
    } else {
      console.log(`   ${filaRestante.length} usuário(s) na fila:`)
      for (const user of filaRestante) {
        console.log(
          `      Pos ${user.posicaoFila}: ${user.nome} (${user.email})`
        )
      }
    }

    // Estatísticas finais
    const totalUsuarios = await User.countDocuments()
    const usuariosEmRodadas = await User.countDocuments({
      aguardandoVermelho: false
    })
    const usuariosAguardando = await User.countDocuments({
      aguardandoVermelho: true
    })
    const totalRodadas = await Rodada.countDocuments()
    const rodadasConcluidas = await Rodada.countDocuments({
      status: 'concluida'
    })

    console.log(`\n${colors.cyan}📊 ESTATÍSTICAS FINAIS:${colors.reset}`)
    console.log(`   Total de usuários: ${totalUsuarios}`)
    console.log(`   Usuários em rodadas: ${usuariosEmRodadas}`)
    console.log(`   Usuários na fila: ${usuariosAguardando}`)
    console.log(`   Total de rodadas: ${totalRodadas}`)
    console.log(`   Rodadas concluídas: ${rodadasConcluidas}`)
    console.log(`   Pagamentos processados agora: ${totalPagos}`)
    console.log(`   Erros: ${totalErros}`)

    if (totalErros === 0 && totalPagos > 0) {
      logSuccess(
        `\n🎉 PROCESSO CONCLUÍDO! ${totalPagos} pagamentos confirmados com sucesso.`
      )
    } else if (totalPagos === 0 && totalErros === 0) {
      logInfo(`\nℹ️ Nenhum pagamento pendente encontrado.`)
    } else {
      logWarning(
        `\n⚠️ Processo finalizado com ${totalPagos} sucessos e ${totalErros} erros.`
      )
    }
  } catch (error) {
    console.error(`${colors.red}❌ ERRO CRÍTICO:${colors.reset}`, error)
  } finally {
    await mongoose.disconnect()
    logInfo('Desconectado do MongoDB')
  }
}

main()
