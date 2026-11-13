// src/jobs/filaJob.js
const User = require('../models/User')
const RodadaService = require('../services/rodadaService')

let timer = null
let emExecucao = false

async function tick () {
  if (emExecucao) return
  emExecucao = true
  try {
    const naFila = await User.countDocuments({ aguardandoVermelho: true })
    if (naFila === 0) return

    const alocados = await RodadaService.alocarFilaEmTodasRodadas()
    if (alocados > 0) {
      console.log(
        `[filaJob] ✅ ${alocados} usuário(s) alocado(s) automaticamente`
      )
    } else {
      console.log(`[filaJob] ⚠️ ${naFila} na fila, mas nenhuma vaga disponível`)
    }
  } catch (err) {
    console.error('[filaJob] ❌ Erro:', err.message)
  } finally {
    emExecucao = false
  }
}

function iniciar (intervaloMs = 2 * 60 * 1000) {
  if (timer) return
  console.log(
    `[filaJob] 🕐 Iniciado — rodando a cada ${intervaloMs / 60000} minuto(s)`
  )
  // primeira execução em 30s (para dar tempo do server subir)
  setTimeout(() => {
    tick()
    timer = setInterval(tick, intervaloMs)
  }, 30000)
}

function parar () {
  if (timer) {
    clearInterval(timer)
    timer = null
    console.log('[filaJob] ⏹️ Parado')
  }
}

module.exports = { iniciar, parar, tick }
