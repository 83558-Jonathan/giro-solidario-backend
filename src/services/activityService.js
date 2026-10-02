const ActivityLog = require('../models/ActivityLog')

let ioInstance = null

function setIo (io) {
  ioInstance = io
}

function mascararNome (nomeCompleto) {
  if (!nomeCompleto) return 'Alguem'
  const partes = nomeCompleto.trim().split(/\s+/)
  if (partes.length === 1) return partes[0]
  return `${partes[0]} ${partes[1].charAt(0).toUpperCase()}.`
}

async function registrar ({
  tipo,
  usuario,
  nome,
  rodada = null,
  mensagem,
  metadata = {}
}) {
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
    return null
  }
}

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
      mensagem: `${mascararNome(nome)} ganhou R$ ${valor}!`,
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
      mensagem: `${mascararNome(nome)} fez uma indicacao`
    }),

  novoIndicado: (usuario, nome, indicadoNome) =>
    registrar({
      tipo: 'novo_indicado',
      usuario,
      nome,
      mensagem: `${mascararNome(nome)} trouxe ${mascararNome(indicadoNome)}`,
      metadata: { indicadoNome }
    }),

  rodadaAvancou: (usuario, nome, rodada, rodadaNome) =>
    registrar({
      tipo: 'rodada_avancou',
      usuario,
      nome,
      rodada,
      mensagem: `${rodadaNome || 'Rodada'} avancou! Novas posicoes atribuidas`
    }),

  filaAlocado: (usuario, nome, rodada) =>
    registrar({
      tipo: 'fila_alocado',
      usuario,
      nome,
      rodada,
      mensagem: `${mascararNome(nome)} entrou da fila para a rodada`
    }),

  comissaoRecebida: (usuario, nome, indicadoNome, valor) =>
    registrar({
      tipo: 'comissao',
      usuario,
      nome,
      mensagem: `${mascararNome(
        nome
      )} ganhou R$ ${valor} pela indicacao de ${mascararNome(indicadoNome)}`,
      metadata: { valor, indicadoNome }
    })
}

module.exports = { setIo, registrar, ...atalhos, mascararNome }
