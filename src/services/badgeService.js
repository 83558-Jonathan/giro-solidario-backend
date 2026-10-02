const User = require('../models/User')
const notificationService = require('./notificationService')

// Catálogo de badges
const BADGES = {
  PRIMEIRO_PAGAMENTO: {
    id: 'PRIMEIRO_PAGAMENTO',
    nome: 'Primeiro Pagamento',
    emoji: '🎯',
    descricao: 'Fez seu primeiro pagamento numa rodada'
  },
  PRIMEIRA_VITORIA: {
    id: 'PRIMEIRA_VITORIA',
    nome: 'Primeira Vitória',
    emoji: '🏆',
    descricao: 'Ganhou seu primeiro prêmio'
  },
  CONVIDADOR: {
    id: 'CONVIDADOR',
    nome: 'Convidando',
    emoji: '🚀',
    descricao: 'Convidou pelo menos 5 amigos'
  },
  SEQUENCIA_3: {
    id: 'SEQUENCIA_3',
    nome: 'Em Chamas',
    emoji: '🔥',
    descricao: 'Jogou 3 rodadas seguidas'
  },
  PAGOU_RAPIDO: {
    id: 'PAGOU_RAPIDO',
    nome: 'Relâmpago',
    emoji: '⚡',
    descricao: 'Pagou em menos de 5 minutos'
  },
  NUNCA_ATRASOU: {
    id: 'NUNCA_ATRASOU',
    nome: 'Pontual',
    emoji: '💎',
    descricao: '10 pagamentos sem atrasar'
  }
}

// ===========================================
// CONCEDER BADGE (evita duplicidade)
// ===========================================
async function conceder (usuarioId, badgeId) {
  const badge = BADGES[badgeId]
  if (!badge) return null

  const usuario = await User.findById(usuarioId).select('badges nome')
  if (!usuario) return null

  const jaTem = (usuario.badges || []).some(b => b.id === badgeId)
  if (jaTem) return null

  usuario.badges = [...(usuario.badges || []), { id: badgeId, em: new Date() }]
  await usuario.save()

  // Notifica o usuário
  await notificationService.badgeConquistado(usuarioId, badge.nome, badge.emoji)

  console.log(`🏅 [badgeService] ${usuario.nome} ganhou ${badge.nome}`)
  return badge
}

// ===========================================
// VERIFICAÇÕES AUTOMÁTICAS
// ===========================================
async function verificarAposPagamento (usuarioId, tempoDesdeEntradaMs) {
  // Primeiro pagamento
  await conceder(usuarioId, 'PRIMEIRO_PAGAMENTO')

  // Pagou rápido (< 5 min)
  if (tempoDesdeEntradaMs && tempoDesdeEntradaMs < 5 * 60 * 1000) {
    await conceder(usuarioId, 'PAGOU_RAPIDO')
  }
}

async function verificarAposVitoria (usuarioId) {
  await conceder(usuarioId, 'PRIMEIRA_VITORIA')
}

async function verificarAposConvite (usuarioId) {
  const usuario = await User.findById(usuarioId).select('totalIndicacoes')
  if (usuario?.totalIndicacoes >= 5) {
    await conceder(usuarioId, 'CONVIDADOR')
  }
}

async function verificarAposRodadaConcluida (usuarioId) {
  // Placeholder — pode contar rodadas jogadas depois
  // Ex: se jogou 3 seguidas, concede SEQUENCIA_3
}

module.exports = {
  BADGES,
  conceder,
  verificarAposPagamento,
  verificarAposVitoria,
  verificarAposConvite,
  verificarAposRodadaConcluida
}