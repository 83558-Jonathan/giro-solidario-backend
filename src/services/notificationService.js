const Notificacao = require('../models/Notificacao')

let ioInstance = null

function setIo (io) {
  ioInstance = io
  console.log('[notificationService] io injetado')
}

async function criar ({ usuario, tipo, titulo, mensagem, icone = null, link = '/dashboard', metadata = {} }) {
  try {
    const notif = await Notificacao.create({
      usuario,
      tipo,
      titulo,
      mensagem,
      icone,
      link,
      metadata
    })

    if (ioInstance) {
      ioInstance.to(`user-${usuario}`).emit('notificacao', {
        _id: notif._id,
        tipo: notif.tipo,
        titulo: notif.titulo,
        mensagem: notif.mensagem,
        icone: notif.icone,
        link: notif.link,
        lida: false,
        createdAt: notif.createdAt
      })
    }

    return notif
  } catch (err) {
    console.error('❌ [notificationService] Erro:', err.message)
    return null
  }
}

// Atalhos
const atalhos = {
  pagamentoConfirmado: (usuario, nome) =>
    criar({
      usuario,
      tipo: 'pagamento_confirmado',
      titulo: '💰 Pagamento confirmado!',
      mensagem: `${nome} pagou. Fique de olho na rodada.`,
      icone: '💰'
    }),

  voceEVerde: (usuario, premio) =>
    criar({
      usuario,
      tipo: 'voce_e_verde',
      titulo: '🏆 Você é o VERDE!',
      mensagem: `Aguarde os pagamentos para receber R$ ${premio}`,
      icone: '🏆'
    }),

  premioLiberado: (usuario, valor) =>
    criar({
      usuario,
      tipo: 'premio_liberado',
      titulo: '🎊 Prêmio liberado!',
      mensagem: `R$ ${valor} disponíveis para saque`,
      icone: '🎊'
    }),

  novoIndicado: (usuario, nome) =>
    criar({
      usuario,
      tipo: 'novo_indicado',
      titulo: '🎁 Novo indicado!',
      mensagem: `${nome} se cadastrou com seu link`,
      icone: '🎁'
    }),

  filaSubiu: (usuario, posicao) =>
    criar({
      usuario,
      tipo: 'fila_subiu',
      titulo: '📈 Você subiu na fila!',
      mensagem: `Agora você é o ${posicao}º da fila`,
      icone: '📈'
    }),

  filaAlocado: (usuario, rodada) =>
    criar({
      usuario,
      tipo: 'fila_alocado',
      titulo: '⚡ Sua vaga abriu!',
      mensagem: `Você entrou na ${rodada}. Pague agora!`,
      icone: '⚡'
    }),

  saqueAprovado: (usuario, valor) =>
    criar({
      usuario,
      tipo: 'saque_aprovado',
      titulo: 'Saque aprovado!',
      mensagem: `R$ ${valor} enviados para sua chave PIX`,
      icone: ''
    }),

  saqueRecusado: (usuario, valor, motivo) =>
    criar({
      usuario,
      tipo: 'saque_recusado',
      titulo: '❌ Saque recusado',
      mensagem: motivo || `R$ ${valor} voltaram para seu saldo`,
      icone: '❌'
    }),

  badgeConquistado: (usuario, badgeNome, emoji) =>
    criar({
      usuario,
      tipo: 'badge_conquistado',
      titulo: `${emoji} Nova conquista!`,
      mensagem: `Você ganhou: ${badgeNome}`,
      icone: emoji
    })
}

module.exports = { setIo, criar, ...atalhos }