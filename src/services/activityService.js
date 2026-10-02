const ActivityLog = require('../models/ActivityLog')

let ioInstance = null

function setIo (io) {
  ioInstance = io
  console.log('[activityService] io injetado')
}

// Mascara o nome: "João Silva" → "João S."
function mascararNome (nomeCompleto) {
  if (!nomeCompleto) return 'Alguém'
  const partes = nomeCompleto.trim().split(/\s+/)
  if (partes.length === 1) return partes[0]
  return `${partes[0]} ${partes[1].charAt(0).toUpperCase()}.`
}

// Registra uma atividade e emite via socket (se io disponível)
async function registrar ({ tipo, usuario, nome, rodada = null, mensagem, metadata = {} }) {
  try {
    const log = await ActivityLog.create({
      tipo,
      usuario,
      nomeExibicao: mascararNome(nome),
      rodada,
      mensagem,
      metadata
    })

    if (ioInstance) {
      ioInstance.emit('activity', {
        _id: log._id,
        tipo: log.tipo,
        nomeExibicao: log.nomeExibicao,
        mensagem: log.mensagem,
        createdAt: log.createdAt
      })
    }

    return log
  } catch (err) {
    console.error('❌ [activityService] Erro ao registrar:', err.message)
    return null
  }
}

// Atalhos semânticos
const atalhos = {
  pagamento: (usuario, nome, rodada, valor) =>
    registrar({
      tipo: 'pagamento',
      usuario,
      nome,
      rodada,
      mensagem: `${mascararNome(nome)} confirmou o pagamento de R$ ${valor}`,
      metadata: { valor }
    }),

  premio: (usuario, nome, rodada, valor) =>
    registrar({
      tipo: 'premio',
      usuario,
      nome,
      rodada,
      mensagem: `🏆 ${mascararNome(nome)} ganhou R$ ${valor}!`,
      metadata: { valor }
    }),

  entrada: (usuario, nome, rodada) =>
    registrar({
      tipo: 'entrada',
      usuario,
      nome,
      rodada,
      mensagem: `${mascararNome(nome)} entrou na rodada`
    }),

  convite: (usuario, nome) =>
    registrar({
      tipo: 'convite',
      usuario,
      nome,
      mensagem: `🚀 ${mascararNome(nome)} fez uma indicação`,
    }),

  novoIndicado: (usuario, nome, indicadoNome) =>
    registrar({
      tipo: 'novo_indicado',
      usuario,
      nome,
      mensagem: `🎁 ${mascararNome(nome)} trouxe ${mascararNome(indicadoNome)}`,
      metadata: { indicadoNome }
    }),

  rodadaAvancou: (usuario, nome, rodada) =>
    registrar({
      tipo: 'rodada_avancou',
      usuario,
      nome,
      rodada,
      mensagem: `🔄 ${rodada} avançou! Novas posições atribuídas`
    }),

  filaAlocado: (usuario, nome, rodada) =>
    registrar({
      tipo: 'fila_alocado',
      usuario,
      nome,
      rodada,
      mensagem: `⚡ ${mascararNome(nome)} entrou da fila para a ${rodada}`
    })
}

module.exports = { setIo, registrar, ...atalhos, mascararNome }