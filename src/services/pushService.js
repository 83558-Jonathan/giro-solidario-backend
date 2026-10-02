const webpush = require('web-push')
const Subscription = require('../models/Subscription')
const User = require('../models/User')

// ===========================================
// INICIALIZAÇÃO (chamada pelo server.js no boot)
// ===========================================
let inicializado = false

function inicializar () {
  if (inicializado) return true
  const pub = process.env.VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT || 'mailto:contato@giropremiados.com.br'

  if (!pub || !priv) {
    console.warn(
      '⚠️ [pushService] VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY não configurados — push desabilitado'
    )
    return false
  }

  webpush.setVapidDetails(subject, pub, priv)
  inicializado = true
  console.log('[pushService] VAPID configurado')
  return true
}

// ===========================================
// ENVIAR PUSH PARA 1 USUÁRIO
// ===========================================
async function enviarParaUsuario (usuarioId, payload) {
  if (!inicializado && !inicializar()) return { enviados: 0, falhas: 0 }

  const subs = await Subscription.find({ usuario: usuarioId })
  if (!subs.length) return { enviados: 0, falhas: 0 }

  let enviados = 0
  let falhas = 0

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }
        },
        JSON.stringify(payload)
      )
      sub.lastUsedAt = new Date()
      await sub.save()
      enviados++
    } catch (err) {
      falhas++
      // 410 Gone = subscription morta, remove
      if (err.statusCode === 410 || err.statusCode === 404) {
        await Subscription.deleteOne({ _id: sub._id })
        console.log(`🧹 [pushService] Subscription expirada removida`)
      } else {
        console.error(
          `❌ [pushService] Falha ao enviar: ${err.statusCode || ''} ${err.message}`
        )
      }
    }
  }

  return { enviados, falhas }
}

// ===========================================
// ENVIAR PUSH PARA VÁRIOS USUÁRIOS
// ===========================================
async function enviarParaUsuarios (usuarioIds, payload) {
  const results = await Promise.all(
    usuarioIds.map(id => enviarParaUsuario(id, payload))
  )
  const enviados = results.reduce((acc, r) => acc + r.enviados, 0)
  const falhas = results.reduce((acc, r) => acc + r.falhas, 0)
  return { enviados, falhas, total: usuarioIds.length }
}

// ===========================================
// ATALHOS — payloads prontos
// ===========================================
const templates = {
  pagamentoConfirmado: (nome, faltam, total) => ({
    title: '💰 Pagamento confirmado!',
    body: `${nome} pagou. Faltam ${faltam} de ${total} para a rodada girar.`,
    icon: '/icon-192.png',
    badge: '/icon-72.png',
    url: '/dashboard'
  }),

  rodadaVaiAvancar: () => ({
    title: '🎉 Todos pagaram!',
    body: 'A rodada vai girar e as posições serão atualizadas.',
    icon: '/icon-192.png',
    url: '/dashboard'
  }),

  voceEVerde: (premio) => ({
    title: '🏆 Você é o VERDE!',
    body: `Aguarde os 8 vermelhos pagarem e receba R$ ${premio} automaticamente.`,
    icon: '/icon-192.png',
    url: '/dashboard'
  }),

  premioLiberado: (valor) => ({
    title: '🎊 Prêmio liberado!',
    body: `R$ ${valor} estão disponíveis para saque. Parabéns!`,
    icon: '/icon-192.png',
    url: '/dashboard'
  }),

  filaSubiu: (posicao) => ({
    title: '📈 Você subiu na fila!',
    body: `Agora você é o ${posicao}º da fila. Fique de olho!`,
    icon: '/icon-192.png',
    url: '/dashboard'
  }),

  filaAlocado: (rodada) => ({
    title: '⚡ Sua vaga abriu!',
    body: `Você entrou na ${rodada}. Pague agora para garantir.`,
    icon: '/icon-192.png',
    url: '/dashboard'
  }),

  novoIndicado: (nome) => ({
    title: '🎁 Novo indicado!',
    body: `${nome} se cadastrou com seu link. Continue convidando!`,
    icon: '/icon-192.png',
    url: '/dashboard'
  }),

  rodadaQuaseCompleta: (rodada, pagos, total) => ({
    title: '⚡ Rodada quase completa!',
    body: `${rodada} está em ${pagos}/${total}. Última chance de entrar!`,
    icon: '/icon-192.png',
    url: '/dashboard'
  }),

  reEngajamento: (nome) => ({
    title: `👋 Sentimos sua falta, ${nome}!`,
    body: 'Tem rodada girando. Volte e veja as novidades.',
    icon: '/icon-192.png',
    url: '/dashboard'
  })
}

module.exports = {
  inicializar,
  enviarParaUsuario,
  enviarParaUsuarios,
  templates
}