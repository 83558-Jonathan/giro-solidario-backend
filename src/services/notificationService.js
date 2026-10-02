const Notificacao = require('../models/Notificacao')

let ioInstance = null

function setIo (io) {
  ioInstance = io
}

async function criar ({
  usuario,
  tipo,
  titulo,
  mensagem,
  icone = null,
  link = '/dashboard',
  metadata = {}
}) {
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
    return null
  }
}

const atalhos = {
  pagamentoConfirmado: (usuario, nome) =>
    criar({
      usuario,
      tipo: 'pagamento_confirmado',
      titulo: 'Pagamento confirmado',
      mensagem: `${nome} pagou. Fique de olho na rodada.`,
      icone: 'money'
    }),

  voceEVerde: (usuario, premio) =>
    criar({
      usuario,
      tipo: 'voce_e_verde',
      titulo: 'Voce e o VERDE!',
      mensagem: `Aguarde os pagamentos para receber R$ ${premio}`,
      icone: 'trophy'
    }),

  premioLiberado: (usuario, valor) =>
    criar({
      usuario,
      tipo: 'premio_liberado',
      titulo: 'Premio liberado!',
      mensagem: `R$ ${valor} disponiveis para saque`,
      icone: 'gift'
    }),

  novoIndicado: (usuario, nome) =>
    criar({
      usuario,
      tipo: 'novo_indicado',
      titulo: 'Novo indicado!',
      mensagem: `${nome} se cadastrou com seu link`,
      icone: 'user-plus'
    }),

  filaSubiu: (usuario, posicao) =>
    criar({
      usuario,
      tipo: 'fila_subiu',
      titulo: 'Voce subiu na fila!',
      mensagem: `Agora voce e o ${posicao} da fila`,
      icone: 'arrow-up'
    }),

  filaAlocado: (usuario, rodada) =>
    criar({
      usuario,
      tipo: 'fila_alocado',
      titulo: 'Sua vaga abriu!',
      mensagem: `Voce entrou na ${rodada}. Pague agora!`,
      icone: 'bolt'
    }),

  saqueAprovado: (usuario, valor) =>
    criar({
      usuario,
      tipo: 'saque_aprovado',
      titulo: 'Saque aprovado',
      mensagem: `R$ ${valor} enviados para sua chave PIX`,
      icone: 'check'
    }),

  saqueRecusado: (usuario, valor, motivo) =>
    criar({
      usuario,
      tipo: 'saque_recusado',
      titulo: 'Saque recusado',
      mensagem: motivo || `R$ ${valor} voltaram para seu saldo`,
      icone: 'x'
    }),

  badgeConquistado: (usuario, badgeNome, emoji) =>
    criar({
      usuario,
      tipo: 'badge_conquistado',
      titulo: `Nova conquista!`,
      mensagem: `Voce ganhou: ${badgeNome}`,
      icone: emoji
    }),

  comissaoRecebida: (usuario, indicadoNome, valor) =>
    criar({
      usuario,
      tipo: 'comissao_recebida',
      titulo: 'Comissao recebida',
      mensagem: `Voce ganhou R$ ${valor} pela indicacao de ${indicadoNome}`,
      icone: 'money'
    })
}

module.exports = { setIo, criar, ...atalhos }
