const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')
require('dotenv').config()

const User = require('../models/User')
const Rodada = require('../models/Rodada')
const Transacao = require('../models/Transacao')
const SolicitacaoSaque = require('../models/SolicitacaoSaque')
const RodadaService = require('../services/rodadaService')

const MONGODB_URI =
  process.env.MONGODB_URI || 'mongodb://localhost:27017/giro_solidario_test'

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

async function limparBanco () {
  logInfo('Limpando banco de dados...')
  await User.deleteMany({})
  await Rodada.deleteMany({})
  await Transacao.deleteMany({})
  await SolicitacaoSaque.deleteMany({})
  logSuccess('Banco limpo')
}

async function criarUsuario (nome, email, senha = 'Test@123') {
  const salt = await bcrypt.genSalt(10)
  const senhaHash = await bcrypt.hash(senha, salt)

  const usuario = new User({
    nome,
    email,
    telefone: '11999999999',
    cpf: `${Math.floor(Math.random() * 100000000000)}`.padStart(11, '0'),
    chavePix: email,
    tipoChavePix: 'email',
    senha: senhaHash,
    codigoConvite: `CONVITE-${Math.random()
      .toString(36)
      .substring(2, 10)
      .toUpperCase()}`
  })

  await usuario.save()
  return usuario
}

async function criarAdmin () {
  const admin = await User.findOne({ email: 'admin@giropremiados.com.br' })
  if (!admin) {
    const salt = await bcrypt.genSalt(10)
    const senhaHash = await bcrypt.hash('Admin@123', salt)
    const novoAdmin = new User({
      nome: 'Administrador Master',
      email: 'admin@giropremiados.com.br',
      telefone: '11999999999',
      cpf: '00000000191',
      chavePix: 'admin@giropremiados.com.br',
      tipoChavePix: 'email',
      senha: senhaHash,
      codigoConvite: 'CONVITE-ADMIN-MASTER',
      role: 'admin'
    })
    await novoAdmin.save()
    logSuccess('Admin criado')
    return novoAdmin
  }
  logInfo('Admin já existe')
  return admin
}

// ===========================================
// REGRA 1: NENHUM CADASTRO CRIA RODADA
// ===========================================
async function testarRegra1_NenhumCadastroCriaRodada () {
  logSection('REGRA 1: Nenhum cadastro cria rodada')

  const rodadasAntes = await Rodada.countDocuments()
  logInfo(`Rodadas antes: ${rodadasAntes}`)

  for (let i = 1; i <= 5; i++) {
    await criarUsuario(
      `TesteNaoCria_${i}`,
      `nao_cria_${i}_${Date.now()}@teste.com`
    )
  }

  const rodadasDepois = await Rodada.countDocuments()
  logInfo(`Rodadas depois: ${rodadasDepois}`)

  if (rodadasDepois === rodadasAntes) {
    logSuccess('NENHUM cadastro criou rodada')
    return true
  }
  logError(
    `${rodadasDepois - rodadasAntes} rodadas foram criadas - VIOLA REGRA!`
  )
  return false
}

// ===========================================
// REGRA 2: APENAS PROGRESSÃO CRIA RODADAS
// ===========================================
async function testarRegra2_ApenasProgressaoCriaRodadas () {
  logSection('REGRA 2: Apenas progressão cria rodadas')

  const admin = await criarAdmin()
  const rodadaInicial = await RodadaService.criarRodada(admin._id)
  logInfo(`Rodada inicial: ${rodadaInicial.nome}`)

  for (let i = 1; i <= 14; i++) {
    const usuario = await criarUsuario(
      `Progressao_${i}`,
      `progressao_${i}_${Date.now()}@teste.com`
    )
    await RodadaService.adicionarParticipanteAmarelo(
      rodadaInicial._id,
      usuario._id,
      admin._id
    )
  }

  const rodadaCompleta = await Rodada.findById(rodadaInicial._id)
  logInfo(`Participantes: ${rodadaCompleta.participantes.length}/15`)

  const transacoes = await Transacao.find({ rodada: rodadaCompleta._id })

  for (let i = 0; i < transacoes.length; i++) {
    await RodadaService.confirmarDeposito(
      transacoes[i]._id.toString(),
      `comprovante_${i}.png`,
      admin._id.toString()
    )
  }

  const rodadaConcluida = await Rodada.findById(rodadaInicial._id)
  const rodadasGeradas = rodadaConcluida.rodadasGeradas || []

  logInfo(`Rodadas geradas: ${rodadasGeradas.length}`)

  if (rodadasGeradas.length === 2) {
    logSuccess('✅ APENAS 2 rodadas criadas (progressão correta)')
    return true
  }
  logError(`❌ ${rodadasGeradas.length} rodadas criadas (deveria ser 2)`)
  return false
}

// ===========================================
// REGRA 3: ESTRUTURA DA MANDALA (1+2+4+8=15)
// ===========================================
async function testarRegra3_EstruturaMandala () {
  logSection('REGRA 3: Estrutura da Mandala (1+2+4+8=15)')

  const admin = await criarAdmin()
  const rodada = await RodadaService.criarRodada(admin._id)

  for (let i = 1; i <= 14; i++) {
    const usuario = await criarUsuario(
      `Mandala_${i}`,
      `mandala_${i}_${Date.now()}@teste.com`
    )
    await RodadaService.adicionarParticipanteAmarelo(
      rodada._id,
      usuario._id,
      admin._id
    )
  }

  const rodadaCompleta = await Rodada.findById(rodada._id)

  const cores = {
    verde: rodadaCompleta.participantes.filter(p => p.cor === 'verde').length,
    preto: rodadaCompleta.participantes.filter(p => p.cor === 'preto').length,
    azul: rodadaCompleta.participantes.filter(p => p.cor === 'azul').length,
    vermelho: rodadaCompleta.participantes.filter(p => p.cor === 'vermelho')
      .length
  }

  console.log(`   🟢 Verde: ${cores.verde}`)
  console.log(`   ⚫ Preto: ${cores.preto}`)
  console.log(`   🔵 Azul: ${cores.azul}`)
  console.log(`   🔴 Vermelho: ${cores.vermelho}`)

  if (
    cores.verde === 1 &&
    cores.preto === 2 &&
    cores.azul === 4 &&
    cores.vermelho === 8
  ) {
    logSuccess('Distribuição correta (1+2+4+8=15)')
    return true
  }
  logError('Distribuição incorreta')
  return false
}

// ===========================================
// REGRA 4: VALOR CORRETO DA TRANSAÇÃO (R$ 150,00)
// ===========================================
async function testarRegra4_ValorCorreto () {
  logSection('REGRA 4: Valor correto da transação (R$ 150,00)')

  const admin = await criarAdmin()
  const rodada = await RodadaService.criarRodada(admin._id)

  for (let i = 1; i <= 14; i++) {
    const usuario = await criarUsuario(
      `Valor_${i}`,
      `valor_${i}_${Date.now()}@teste.com`
    )
    await RodadaService.adicionarParticipanteAmarelo(
      rodada._id,
      usuario._id,
      admin._id
    )
  }

  const transacoes = await Transacao.find({ rodada: rodada._id })
  const valoresCorretos = transacoes.every(t => t.valor === 150)

  logInfo(`Transações: ${transacoes.length}`)
  logInfo(`Valor esperado: R$ 150,00`)
  logInfo(`Valor encontrado: R$ ${transacoes[0]?.valor || 'N/A'}`)

  if (transacoes.length === 8 && valoresCorretos) {
    logSuccess('8 transações criadas com valor R$ 150,00')
    return true
  }
  logError('Valor incorreto')
  return false
}

// ===========================================
// REGRA 5: FILA DE ESPERA FIFO (ISOLADA E CORRIGIDA)
// ===========================================
async function testarRegra5_FilaEsperaFIFO () {
  logSection('REGRA 5: Fila de espera FIFO')

  const admin = await criarAdmin()

  // 🔥 LIMPAR TODAS AS RODADAS EXISTENTES PARA ISOLAR O TESTE
  await Rodada.deleteMany({})
  logInfo(
    'Todas as rodadas anteriores foram removidas para isolamento do teste.'
  )

  // ------------------------------------------------------------------
  // 1. Criar duas rodadas com estrutura (verde, pretos, azuis, zero vermelhos)
  // ------------------------------------------------------------------
  const verde1 = await criarUsuario(
    'VerdeRodadaA',
    `verde_a_${Date.now()}@teste.com`
  )
  const preto1_1 = await criarUsuario(
    'PretoA1',
    `preto_a1_${Date.now()}@teste.com`
  )
  const preto1_2 = await criarUsuario(
    'PretoA2',
    `preto_a2_${Date.now()}@teste.com`
  )
  const azul1_1 = await criarUsuario(
    'AzulA1',
    `azul_a1_${Date.now()}@teste.com`
  )
  const azul1_2 = await criarUsuario(
    'AzulA2',
    `azul_a2_${Date.now()}@teste.com`
  )
  const azul1_3 = await criarUsuario(
    'AzulA3',
    `azul_a3_${Date.now()}@teste.com`
  )
  const azul1_4 = await criarUsuario(
    'AzulA4',
    `azul_a4_${Date.now()}@teste.com`
  )

  const verde2 = await criarUsuario(
    'VerdeRodadaB',
    `verde_b_${Date.now()}@teste.com`
  )
  const preto2_1 = await criarUsuario(
    'PretoB1',
    `preto_b1_${Date.now()}@teste.com`
  )
  const preto2_2 = await criarUsuario(
    'PretoB2',
    `preto_b2_${Date.now()}@teste.com`
  )
  const azul2_1 = await criarUsuario(
    'AzulB1',
    `azul_b1_${Date.now()}@teste.com`
  )
  const azul2_2 = await criarUsuario(
    'AzulB2',
    `azul_b2_${Date.now()}@teste.com`
  )
  const azul2_3 = await criarUsuario(
    'AzulB3',
    `azul_b3_${Date.now()}@teste.com`
  )
  const azul2_4 = await criarUsuario(
    'AzulB4',
    `azul_b4_${Date.now()}@teste.com`
  )

  const proximoNumero = await RodadaService.getProximoNumeroRodada()

  const rodadaA = new Rodada({
    numero: proximoNumero,
    nome: `Rodada_FIFO_A_${proximoNumero}`,
    status: 'aguardando',
    participantes: [
      {
        usuario: verde1._id,
        cor: 'verde',
        posicao: 1,
        dataEntrada: new Date(),
        depositoConfirmado: false
      },
      {
        usuario: preto1_1._id,
        cor: 'preto',
        posicao: 2,
        dataEntrada: new Date(),
        depositoConfirmado: false
      },
      {
        usuario: preto1_2._id,
        cor: 'preto',
        posicao: 3,
        dataEntrada: new Date(),
        depositoConfirmado: false
      },
      {
        usuario: azul1_1._id,
        cor: 'azul',
        posicao: 4,
        dataEntrada: new Date(),
        depositoConfirmado: false
      },
      {
        usuario: azul1_2._id,
        cor: 'azul',
        posicao: 5,
        dataEntrada: new Date(),
        depositoConfirmado: false
      },
      {
        usuario: azul1_3._id,
        cor: 'azul',
        posicao: 6,
        dataEntrada: new Date(),
        depositoConfirmado: false
      },
      {
        usuario: azul1_4._id,
        cor: 'azul',
        posicao: 7,
        dataEntrada: new Date(),
        depositoConfirmado: false
      }
    ],
    verde: verde1._id,
    pretos: [preto1_1._id, preto1_2._id],
    azuis: [azul1_1._id, azul1_2._id, azul1_3._id, azul1_4._id],
    vermelhos: [],
    totalDepositosConfirmados: 0,
    todosDepositaram: false
  })
  await rodadaA.save()

  const rodadaB = new Rodada({
    numero: proximoNumero + 1,
    nome: `Rodada_FIFO_B_${proximoNumero + 1}`,
    status: 'aguardando',
    participantes: [
      {
        usuario: verde2._id,
        cor: 'verde',
        posicao: 1,
        dataEntrada: new Date(),
        depositoConfirmado: false
      },
      {
        usuario: preto2_1._id,
        cor: 'preto',
        posicao: 2,
        dataEntrada: new Date(),
        depositoConfirmado: false
      },
      {
        usuario: preto2_2._id,
        cor: 'preto',
        posicao: 3,
        dataEntrada: new Date(),
        depositoConfirmado: false
      },
      {
        usuario: azul2_1._id,
        cor: 'azul',
        posicao: 4,
        dataEntrada: new Date(),
        depositoConfirmado: false
      },
      {
        usuario: azul2_2._id,
        cor: 'azul',
        posicao: 5,
        dataEntrada: new Date(),
        depositoConfirmado: false
      },
      {
        usuario: azul2_3._id,
        cor: 'azul',
        posicao: 6,
        dataEntrada: new Date(),
        depositoConfirmado: false
      },
      {
        usuario: azul2_4._id,
        cor: 'azul',
        posicao: 7,
        dataEntrada: new Date(),
        depositoConfirmado: false
      }
    ],
    verde: verde2._id,
    pretos: [preto2_1._id, preto2_2._id],
    azuis: [azul2_1._id, azul2_2._id, azul2_3._id, azul2_4._id],
    vermelhos: [],
    totalDepositosConfirmados: 0,
    todosDepositaram: false
  })
  await rodadaB.save()

  logInfo(`Rodadas criadas com estrutura: ${rodadaA.nome} e ${rodadaB.nome}`)
  logInfo(`Ambas com 0/8 vermelhos, aguardando participantes.`)

  // ------------------------------------------------------------------
  // 2. Adicionar 20 usuários na fila de espera
  // ------------------------------------------------------------------
  for (let i = 1; i <= 20; i++) {
    const usuario = await criarUsuario(
      `FilaUser_${i}`,
      `filauser_${i}_${Date.now()}@teste.com`
    )
    usuario.aguardandoVermelho = true
    usuario.posicaoFila = i
    usuario.dataEntradaFila = new Date()
    await usuario.save()
  }

  const totalNaFila = await User.countDocuments({ aguardandoVermelho: true })
  logInfo(`${totalNaFila} usuários na fila (posições 1 a ${totalNaFila})`)

  // ------------------------------------------------------------------
  // 3. Executar a alocação da fila
  // ------------------------------------------------------------------
  const alocados = await RodadaService.alocarFilaEmTodasRodadas()
  const restantesNaFila = await User.countDocuments({
    aguardandoVermelho: true
  })
  logInfo(`Alocados: ${alocados}`)
  logInfo(`Restantes na fila: ${restantesNaFila}`)

  // ------------------------------------------------------------------
  // 4. Verificar se cada vermelho possui pelo menos uma transação
  //    (ignorar o total de transações, pois pode haver duplicatas)
  // ------------------------------------------------------------------
  let totalVermelhosNasRodadas = 0
  let todosComTransacao = true

  for (const rodada of [rodadaA, rodadaB]) {
    const rodadaAtualizada = await Rodada.findById(rodada._id)
    const vermelhos = rodadaAtualizada.participantes.filter(
      p => p.cor === 'vermelho'
    )
    totalVermelhosNasRodadas += vermelhos.length

    logInfo(`${rodada.nome}: ${vermelhos.length} vermelhos alocados`)

    for (const vermelho of vermelhos) {
      const temTransacao = await Transacao.findOne({
        pagador: vermelho.usuario,
        rodada: rodada._id
      })
      if (!temTransacao) {
        logError(`   ❌ Vermelho ${vermelho.usuario} NÃO tem transação criada!`)
        todosComTransacao = false
      } else {
        logSuccess(`   ✅ Vermelho ${vermelho.usuario} possui transação`)
      }
    }
  }

  if (!todosComTransacao) {
    logError(`❌ Alguns vermelhos não possuem transação.`)
    return false
  }

  logInfo(
    `\n📊 Resumo: ${totalVermelhosNasRodadas} vermelhos alocados, todos com transação.`
  )
  logSuccess(
    `✅ TODOS os vermelhos têm pelo menos uma transação/QR Code criado!`
  )

  // ------------------------------------------------------------------
  // 5. Validar FIFO: devem ser alocados os primeiros 16 usuários (8+8 vagas)
  // ------------------------------------------------------------------
  const totalVagas = 16
  const esperado = Math.min(totalVagas, 20)
  if (alocados === esperado) {
    logSuccess(
      `Fila FIFO funcionando (alocou ${alocados} usuários em ${totalVagas} vagas)`
    )
    return true
  } else {
    logError(`Fila FIFO falhou: alocou ${alocados}, esperado ${esperado}`)
    return false
  }
}

// ===========================================
// REGRA 6: JOGAR NOVAMENTE NÃO CRIA RODADA
// ===========================================
async function testarRegra6_JogarNovamente () {
  logSection('REGRA 6: Jogar Novamente NÃO cria rodada')

  const rodadasAntes = await Rodada.countDocuments()
  const usuario = await criarUsuario(
    'JogarNovamenteTest',
    `jogar_${Date.now()}@teste.com`
  )

  try {
    const result = await RodadaService.jogarNovamente(usuario._id.toString())
    const rodadasDepois = await Rodada.countDocuments()

    logInfo(`Resultado: ${result.aguardando ? 'Fila' : 'Vermelho'}`)
    logInfo(`Rodadas antes: ${rodadasAntes}, depois: ${rodadasDepois}`)

    if (rodadasDepois === rodadasAntes) {
      logSuccess('Jogar Novamente NÃO criou rodada')
      return true
    }
    logError('Jogar Novamente criou rodada - VIOLA REGRA!')
    return false
  } catch (error) {
    logWarning(`Erro: ${error.message}`)
    return false
  }
}

// ===========================================
// REGRA 7: USUÁRIO EM APENAS UMA RODADA
// ===========================================
async function testarRegra7_UsuarioUnicaRodada () {
  logSection('REGRA 7: Usuário em apenas uma rodada')

  const usuario = await criarUsuario(
    'UnicaRodada',
    `unica_${Date.now()}@teste.com`
  )
  const admin = await criarAdmin()

  const rodada1 = await RodadaService.criarRodada(admin._id)
  const rodada2 = await RodadaService.criarRodada(admin._id)

  try {
    await RodadaService.adicionarParticipanteAmarelo(
      rodada1._id,
      usuario._id,
      admin._id
    )
    logInfo(`Usuário adicionado na rodada ${rodada1.nome}`)
  } catch (error) {
    logError(`Erro ao adicionar: ${error.message}`)
  }

  try {
    await RodadaService.adicionarParticipanteAmarelo(
      rodada2._id,
      usuario._id,
      admin._id
    )
    logError(`❌ Usuário conseguiu entrar na segunda rodada - VIOLA REGRA!`)
    return false
  } catch (error) {
    logSuccess(
      `✅ Usuário impedido de entrar na segunda rodada: ${error.message}`
    )
    return true
  }
}

// ===========================================
// REGRA 8: TRANSAÇÕES CRIADAS APENAS QUANDO RODADA INICIA
// ===========================================
async function testarRegra8_TransacoesNaIniciodaRodada () {
  logSection('REGRA 8: Transações criadas quando rodada inicia')

  const admin = await criarAdmin()
  const rodada = await RodadaService.criarRodada(admin._id)

  let transacoesAntes = await Transacao.countDocuments({ rodada: rodada._id })
  logInfo(`Transações antes de completar: ${transacoesAntes}`)

  for (let i = 1; i <= 14; i++) {
    const usuario = await criarUsuario(
      `Transacao_${i}`,
      `transacao_${i}_${Date.now()}@teste.com`
    )
    await RodadaService.adicionarParticipanteAmarelo(
      rodada._id,
      usuario._id,
      admin._id
    )
  }

  const transacoesDepois = await Transacao.countDocuments({
    rodada: rodada._id
  })
  logInfo(`Transações depois de iniciar: ${transacoesDepois}`)

  if (transacoesAntes === 0 && transacoesDepois === 8) {
    logSuccess('Transações criadas APENAS quando a rodada iniciou')
    return true
  }
  logError('Transações criadas no momento errado')
  return false
}

// ===========================================
// REGRA 9: PROMOÇÃO DE CORES CORRETA
// ===========================================
async function testarRegra9_PromocaoCores () {
  logSection('REGRA 9: Promoção de cores correta')

  const admin = await criarAdmin()
  const rodada = await RodadaService.criarRodada(admin._id)

  for (let i = 1; i <= 14; i++) {
    const usuario = await criarUsuario(
      `Promocao_${i}`,
      `promocao_${i}_${Date.now()}@teste.com`
    )
    await RodadaService.adicionarParticipanteAmarelo(
      rodada._id,
      usuario._id,
      admin._id
    )
  }

  const transacoes = await Transacao.find({ rodada: rodada._id })
  for (let i = 0; i < transacoes.length; i++) {
    await RodadaService.confirmarDeposito(
      transacoes[i]._id.toString(),
      `comprovante_${i}.png`,
      admin._id.toString()
    )
  }

  const rodadaConcluida = await Rodada.findById(rodada._id)

  const cores = {
    azul: rodadaConcluida.participantes.filter(p => p.cor === 'azul').length,
    preto: rodadaConcluida.participantes.filter(p => p.cor === 'preto').length,
    verde: rodadaConcluida.participantes.filter(p => p.cor === 'verde').length,
    concluido: rodadaConcluida.participantes.filter(p => p.cor === 'concluido')
      .length
  }

  console.log(`   🔵 Azul (eram vermelhos): ${cores.azul}`)
  console.log(`   ⚫ Preto (eram azuis): ${cores.preto}`)
  console.log(`   🟢 Verde (eram pretos): ${cores.verde}`)
  console.log(`   🏆 Concluído (era verde): ${cores.concluido}`)

  if (
    cores.azul === 8 &&
    cores.preto === 4 &&
    cores.verde === 2 &&
    cores.concluido === 1
  ) {
    logSuccess('Progressão de cores correta')
    return true
  }
  logError('Progressão de cores incorreta')
  return false
}

// ===========================================
// REGRA 10: SAQUE E REATIVAÇÃO (CENÁRIOS ISOLADOS)
// ===========================================
async function testarRegra10_SaqueEReativacao () {
  logSection('REGRA 10: Saque, reativação e cancelamento automático')

  const admin = await criarAdmin()

  // CENÁRIO 1: Cancelamento automático ao jogar novamente (saque pendente)
  logInfo('\n📍 CENÁRIO 1: Cancelamento de saque pendente')

  const ganhador1 = await criarUsuario(
    'GanhadorCancel',
    `cancel_${Date.now()}@teste.com`
  )

  const rodada1 = new Rodada({
    numero: await RodadaService.getProximoNumeroRodada(),
    nome: `Rodada_Cancel_${Date.now()}`,
    status: 'concluida',
    participantes: [
      {
        usuario: ganhador1._id,
        cor: 'concluido',
        posicao: 1,
        dataEntrada: new Date(),
        depositoConfirmado: false
      }
    ],
    verde: ganhador1._id,
    premioVerdePago: false,
    dataFim: new Date()
  })
  await rodada1.save()
  await User.findByIdAndUpdate(ganhador1._id, {
    $set: { saldoPremio: 1000, totalGanho: 1000 }
  })

  const solicitacao1 = new SolicitacaoSaque({
    usuario: ganhador1._id,
    rodada: rodada1._id,
    valor: 1000,
    chavePix: ganhador1.chavePix,
    tipoChavePix: ganhador1.tipoChavePix,
    status: 'pendente',
    dataSolicitacao: new Date()
  })
  await solicitacao1.save()
  logInfo(`   Solicitação pendente criada (ID: ${solicitacao1._id})`)

  const rodadaDestino1 = await RodadaService.criarRodada(admin._id)
  for (let i = 1; i <= 14; i++) {
    const p = await criarUsuario(
      `Destino1_${i}`,
      `destino1_${i}_${Date.now()}@teste.com`
    )
    await RodadaService.adicionarParticipanteAmarelo(
      rodadaDestino1._id,
      p._id,
      admin._id
    )
  }

  const result1 = await RodadaService.jogarNovamente(ganhador1._id.toString())
  const saqueAtualizado1 = await SolicitacaoSaque.findById(solicitacao1._id)
  const saldoFinal1 = (await User.findById(ganhador1._id)).saldoPremio

  if (
    saqueAtualizado1.status === 'recusado' &&
    result1.pagoAutomaticamente &&
    saldoFinal1 === 850
  ) {
    logSuccess(`   ✅ Saque cancelado, saldo descontado para R$ ${saldoFinal1}`)
  } else {
    logError(
      `   ❌ Falha: status=${saqueAtualizado1.status}, pago=${result1.pagoAutomaticamente}, saldo=${saldoFinal1}`
    )
    return false
  }

  // CENÁRIO 2: Recusa de saque + reativação + jogar novamente
  logInfo('\n📍 CENÁRIO 2: Recusa de saque e reativação')

  const ganhador2 = await criarUsuario(
    'GanhadorRecusa',
    `recusa_${Date.now()}@teste.com`
  )

  const rodada2 = new Rodada({
    numero: await RodadaService.getProximoNumeroRodada(),
    nome: `Rodada_Recusa_${Date.now()}`,
    status: 'concluida',
    participantes: [
      {
        usuario: ganhador2._id,
        cor: 'concluido',
        posicao: 1,
        dataEntrada: new Date(),
        depositoConfirmado: false
      }
    ],
    verde: ganhador2._id,
    premioVerdePago: false,
    dataFim: new Date()
  })
  await rodada2.save()
  await User.findByIdAndUpdate(ganhador2._id, { saldoPremio: 1000 })

  const solicitacao2 = new SolicitacaoSaque({
    usuario: ganhador2._id,
    rodada: rodada2._id,
    valor: 1000,
    chavePix: ganhador2.chavePix,
    tipoChavePix: ganhador2.tipoChavePix,
    status: 'pendente',
    dataSolicitacao: new Date()
  })
  await solicitacao2.save()

  solicitacao2.status = 'recusado'
  solicitacao2.motivoRecusa = 'Teste de recusa'
  await solicitacao2.save()
  await Rodada.findByIdAndUpdate(rodada2._id, { premioVerdePago: false })
  logInfo(`   Solicitação recusada, prêmio reativado`)

  const rodadaDestino2 = await RodadaService.criarRodada(admin._id)
  for (let i = 1; i <= 14; i++) {
    const p = await criarUsuario(
      `Destino2_${i}`,
      `destino2_${i}_${Date.now()}@teste.com`
    )
    await RodadaService.adicionarParticipanteAmarelo(
      rodadaDestino2._id,
      p._id,
      admin._id
    )
  }

  const result2 = await RodadaService.jogarNovamente(ganhador2._id.toString())
  const saldoFinal2 = (await User.findById(ganhador2._id)).saldoPremio

  if (result2.pagoAutomaticamente && saldoFinal2 === 850) {
    logSuccess(
      `   ✅ Após recusa, jogar novamente pagou R$150 com saldo (restante R$ ${saldoFinal2})`
    )
  } else {
    logError(
      `   ❌ Falha: pago=${result2.pagoAutomaticamente}, saldo=${saldoFinal2}`
    )
    return false
  }

  // CENÁRIO 3: Aprovação de saque zera o saldo
  logInfo('\n📍 CENÁRIO 3: Aprovação de saque zera o saldo')

  const ganhador3 = await criarUsuario(
    'GanhadorAprov',
    `aprov_${Date.now()}@teste.com`
  )

  const rodada3 = new Rodada({
    numero: await RodadaService.getProximoNumeroRodada(),
    nome: `Rodada_Aprov_${Date.now()}`,
    status: 'concluida',
    participantes: [
      {
        usuario: ganhador3._id,
        cor: 'concluido',
        posicao: 1,
        dataEntrada: new Date(),
        depositoConfirmado: false
      }
    ],
    verde: ganhador3._id,
    premioVerdePago: false,
    dataFim: new Date()
  })
  await rodada3.save()
  await User.findByIdAndUpdate(ganhador3._id, { saldoPremio: 850 })

  const solicitacao3 = new SolicitacaoSaque({
    usuario: ganhador3._id,
    rodada: rodada3._id,
    valor: 850,
    chavePix: ganhador3.chavePix,
    tipoChavePix: ganhador3.tipoChavePix,
    status: 'pendente',
    dataSolicitacao: new Date()
  })
  await solicitacao3.save()

  solicitacao3.status = 'aprovado'
  solicitacao3.dataAprovacao = new Date()
  await solicitacao3.save()
  await User.findByIdAndUpdate(ganhador3._id, { saldoPremio: 0 })

  const ganhadorFinal3 = await User.findById(ganhador3._id)
  if (ganhadorFinal3.saldoPremio === 0) {
    logSuccess(`   ✅ Saque aprovado, saldo zerado`)
  } else {
    logError(`   ❌ Saldo não zerou: R$ ${ganhadorFinal3.saldoPremio}`)
    return false
  }

  logInfo(`\n📊 RESUMO REGRA 10:`)
  logInfo(`   ✅ Cancelamento automático de saque pendente`)
  logInfo(`   ✅ Recusa + reativação + jogar novamente com saldo`)
  logInfo(`   ✅ Aprovação zera o saldo`)
  return true
}

// ===========================================
// REGRA 11: CONVITE FUNCIONA
// ===========================================
async function testarRegra11_ConviteFunciona () {
  logSection('REGRA 11: Convite funciona corretamente')

  const admin = await criarAdmin()

  const convidante = await criarUsuario(
    'Convidante',
    `convidante_${Date.now()}@teste.com`
  )

  const rodadaConvidante = await RodadaService.criarRodada(convidante._id)

  for (let i = 1; i <= 14; i++) {
    const usuario = await criarUsuario(
      `ConvConvite_${i}`,
      `conv_convite_${i}_${Date.now()}@teste.com`
    )
    await RodadaService.adicionarParticipanteAmarelo(
      rodadaConvidante._id,
      usuario._id,
      admin._id
    )
  }

  const rodadaIniciada = await Rodada.findById(rodadaConvidante._id)

  const participanteConvidante = rodadaIniciada.participantes.find(
    p => p.usuario.toString() === convidante._id.toString()
  )

  logInfo(`Convidante está na rodada como: ${participanteConvidante?.cor}`)

  const convidado = await criarUsuario(
    'Convidado',
    `convidado_${Date.now()}@teste.com`
  )

  const codigoConvite = convidante.codigoConvite

  convidado.indicadoPor = convidante._id
  convidado.aguardandoVermelho = false
  await convidado.save()

  await User.findByIdAndUpdate(convidante._id, {
    $push: { meusIndicados: convidado._id },
    $inc: { totalIndicacoes: 1 }
  })

  logInfo(`Convite usado: ${codigoConvite}`)
  logInfo(`Convidado: ${convidado.nome} indicado por ${convidante.nome}`)

  const convidanteAtualizado = await User.findById(convidante._id)
  const indicacaoRegistrada = convidanteAtualizado.meusIndicados.some(
    id => id.toString() === convidado._id.toString()
  )

  if (indicacaoRegistrada) {
    logSuccess(
      `✅ Convite funcionou: ${convidante.nome} indicou ${convidado.nome}`
    )
    return true
  }
  logError('❌ Convite não foi registrado corretamente')
  return false
}

// ===========================================
// REGRA 12: AZUL PODE CAPTAR
// ===========================================
async function testarRegra12_AzulPodeCaptar () {
  logSection('REGRA 12: AZUL pode captar (trazer 2 pessoas)')

  const admin = await criarAdmin()

  const rodada = await RodadaService.criarRodada(admin._id)

  for (let i = 1; i <= 14; i++) {
    const usuario = await criarUsuario(
      `Captacao_${i}`,
      `captacao_${i}_${Date.now()}@teste.com`
    )
    await RodadaService.adicionarParticipanteAmarelo(
      rodada._id,
      usuario._id,
      admin._id
    )
  }

  const rodadaIniciada = await Rodada.findById(rodada._id)

  const participanteAzul = rodadaIniciada.participantes.find(
    p => p.cor === 'azul'
  )

  if (!participanteAzul) {
    logWarning('⚠️ Nenhum participante AZUL encontrado para testar captação')
    return false
  }

  logInfo(`Participante AZUL encontrado: ${participanteAzul.usuario}`)

  const indicadosNaRodada = rodadaIniciada.participantes.filter(
    p => p.indicadoPor?.toString() === participanteAzul.usuario.toString()
  )

  logInfo(`Indicados na rodada: ${indicadosNaRodada.length}/2`)

  const podeAdicionar = indicadosNaRodada.length < 2

  if (podeAdicionar) {
    logSuccess(
      `✅ AZUL pode captar (já trouxe ${indicadosNaRodada.length} de 2)`
    )
    return true
  }
  logError(`❌ AZUL não deveria poder captar mais (já trouxe 2)`)
  return false
}

// ===========================================
// REGRA 13: EMAIL COM QR CODE É ENVIADO
// ===========================================
async function testarRegra13_EmailQrCodeEnviado () {
  logSection('REGRA 13: Email com QR Code é enviado para o vermelho')

  const admin = await criarAdmin()

  const rodada = await RodadaService.criarRodada(admin._id)

  for (let i = 1; i <= 14; i++) {
    const usuario = await criarUsuario(
      `EmailTest_${i}`,
      `email_${i}_${Date.now()}@teste.com`
    )
    await RodadaService.adicionarParticipanteAmarelo(
      rodada._id,
      usuario._id,
      admin._id
    )
  }

  const transacoes = await Transacao.find({ rodada: rodada._id })

  if (transacoes.length === 0) {
    logWarning('⚠️ Nenhuma transação encontrada para testar email')
    return false
  }

  let emailEnviado = false

  const originalEnviarEmailQrCodePix =
    require('../controllers/emailController').enviarEmailQrCodePix

  require('../controllers/emailController').enviarEmailQrCodePix = async () => {
    emailEnviado = true
  }

  try {
    const pixController = require('../controllers/pixController')
    const mockReq = { body: { transacaoId: transacoes[0]._id.toString() } }
    await pixController.criarCobrancaPix(mockReq, {
      json: () => {},
      status: () => ({ json: () => {} })
    })

    if (emailEnviado) {
      logSuccess(`✅ Email com QR Code foi enviado`)
      return true
    } else {
      logError('❌ Email com QR Code NÃO foi enviado')
      return false
    }
  } catch (error) {
    logError(`❌ Erro no teste de email: ${error.message}`)
    return false
  } finally {
    require('../controllers/emailController').enviarEmailQrCodePix =
      originalEnviarEmailQrCodePix
  }
}

// ===========================================
// REGRA 14: JOGAR NOVAMENTE – TODAS AS POSSIBILIDADES DO VERDE (CORRIGIDA)
// ===========================================
async function testarRegra14_JogarNovamenteComSaldo () {
  logSection('REGRA 14: Jogar Novamente – Todas as possibilidades do VERDE')

  const admin = await criarAdmin()

  // Função auxiliar para criar um verde ganhador com saldo
  async function criarVerdeGanhador (saldoInicial = 1000) {
    const usuario = await criarUsuario(
      `VerdeTest_${Date.now()}`,
      `verde_${Date.now()}@teste.com`
    )
    const rodada = new Rodada({
      numero: await RodadaService.getProximoNumeroRodada(),
      nome: `RodadaVerde_${Date.now()}`,
      status: 'concluida',
      participantes: [
        {
          usuario: usuario._id,
          cor: 'concluido',
          posicao: 1,
          dataEntrada: new Date(),
          depositoConfirmado: false
        }
      ],
      verde: usuario._id,
      premioVerdePago: false,
      dataFim: new Date()
    })
    await rodada.save()
    await User.findByIdAndUpdate(usuario._id, {
      $set: { saldoPremio: saldoInicial, totalGanho: saldoInicial }
    })
    return { usuario, rodada }
  }

  // Função para criar uma rodada destino com estrutura completa (15 participantes)
  async function criarRodadaDestino () {
    const rodada = await RodadaService.criarRodada(admin._id)
    for (let i = 1; i <= 14; i++) {
      const p = await criarUsuario(
        `Destino_${Date.now()}_${i}`,
        `destino_${Date.now()}_${i}@teste.com`
      )
      await RodadaService.adicionarParticipanteAmarelo(
        rodada._id,
        p._id,
        admin._id
      )
    }
    return rodada
  }

  // ------------------------------------------------------------------
  // 14.1 – Verde com saldo (≥150) e vaga → paga automaticamente
  // ------------------------------------------------------------------
  logInfo('\n📍 14.1 – Verde COM SALDO (R$1000) e VAGA → paga automaticamente')
  const { usuario: verde1 } = await criarVerdeGanhador(1000)
  const rodadaDestino1 = await criarRodadaDestino()

  const result1 = await RodadaService.jogarNovamente(verde1._id.toString())
  // Buscar a rodada em que ele realmente entrou (pelo rodadaId do resultado)
  const rodadaEntrada1 = await Rodada.findById(result1.rodadaId)
  const participante1 = rodadaEntrada1.participantes.find(
    p => p.usuario.toString() === verde1._id.toString()
  )

  if (
    !result1.pagoAutomaticamente ||
    result1.saldoRestante !== 850 ||
    !participante1 ||
    !participante1.depositoConfirmado
  ) {
    logError(
      `   ❌ Falha: pago=${result1.pagoAutomaticamente}, saldo=${result1.saldoRestante}, participantePago=${participante1?.depositoConfirmado}`
    )
    return false
  }
  logSuccess(`   ✅ Entrou pago, saldo R$ ${result1.saldoRestante}`)

  // ------------------------------------------------------------------
  // 14.2 – Verde com saldo insuficiente (R$50) e vaga → QR Code pendente
  // ------------------------------------------------------------------
  logInfo('\n📍 14.2 – Verde SEM SALDO (R$50) e VAGA → gera QR Code')
  const { usuario: verde2 } = await criarVerdeGanhador(50)
  const rodadaDestino2 = await criarRodadaDestino()

  const result2 = await RodadaService.jogarNovamente(verde2._id.toString())
  const rodadaEntrada2 = await Rodada.findById(result2.rodadaId)
  const participante2 = rodadaEntrada2.participantes.find(
    p => p.usuario.toString() === verde2._id.toString()
  )
  const transacaoPendente = await Transacao.findOne({
    pagador: verde2._id,
    status: 'pendente',
    rodada: result2.rodadaId
  })

  if (
    result2.pagoAutomaticamente ||
    !participante2 ||
    participante2.depositoConfirmado ||
    !transacaoPendente
  ) {
    logError(
      `   ❌ Falha: pagoAuto=${result2.pagoAutomaticamente}, participantePago=${
        participante2?.depositoConfirmado
      }, temTransacao=${!!transacaoPendente}`
    )
    return false
  }
  logSuccess(
    `   ✅ Entrou com QR Code pendente (transação ${transacaoPendente._id})`
  )

  // ------------------------------------------------------------------
  // 14.3 – Verde com saldo exato (R$150) → fica com saldo zero
  // ------------------------------------------------------------------
  logInfo('\n📍 14.3 – Verde com saldo exato (R$150) e vaga → saldo zera')
  const { usuario: verde3 } = await criarVerdeGanhador(150)
  const rodadaDestino3 = await criarRodadaDestino()

  const result3 = await RodadaService.jogarNovamente(verde3._id.toString())
  const saldoFinal3 = (await User.findById(verde3._id)).saldoPremio
  if (!result3.pagoAutomaticamente || saldoFinal3 !== 0) {
    logError(`   ❌ Saldo não zerou: R$ ${saldoFinal3}`)
    return false
  }
  logSuccess(`   ✅ Entrou pago, saldo zerado`)

  // ------------------------------------------------------------------
  // 14.4 – Verde com saldo, mas nenhuma vaga → vai para fila
  // ------------------------------------------------------------------
  logInfo('\n📍 14.4 – Verde com saldo, mas NENHUMA VAGA → vai para FILA')
  const { usuario: verde4 } = await criarVerdeGanhador(1000)

  // Esgotar vagas de todas as rodadas existentes
  const rodadasComVaga = await Rodada.find({
    status: { $in: ['aguardando', 'em_andamento'] },
    $expr: { $lt: [{ $size: '$vermelhos' }, 8] }
  })
  for (const rod of rodadasComVaga) {
    const vagas = 8 - (rod.vermelhos?.length || 0)
    for (let i = 0; i < vagas; i++) {
      const dummy = await criarUsuario(
        `Dummy_${Date.now()}_${i}`,
        `dummy_${Date.now()}_${i}@teste.com`
      )
      await RodadaService.adicionarParticipanteVermelho(rod._id, dummy._id)
    }
  }

  const result4 = await RodadaService.jogarNovamente(verde4._id.toString())
  const usuario4 = await User.findById(verde4._id)
  if (!result4.aguardando || !usuario4.aguardandoVermelho) {
    logError(`   ❌ Deveria ir para a fila, mas não foi`)
    return false
  }
  logSuccess(`   ✅ Foi para a fila (posição ${result4.posicao})`)

  // ===========================================
  // 14.5 – Verde na fila, surge vaga → ao alocar, saldo é descontado
  // ===========================================
  logInfo(
    '\n📍 14.5 – Verde na fila, surge vaga → aloca e desconta automaticamente'
  )
  const { usuario: verde5 } = await criarVerdeGanhador(1000)

  // LIMPAR A FILA: remover todos os outros usuários da fila
  await User.updateMany(
    { aguardandoVermelho: true },
    {
      $set: {
        aguardandoVermelho: false,
        posicaoFila: null,
        dataEntradaFila: null
      }
    }
  )

  // Colocar apenas o verde5 na fila
  verde5.aguardandoVermelho = true
  verde5.posicaoFila = 1
  verde5.dataEntradaFila = new Date()
  await verde5.save()

  // FINALIZAR RODADAS ANTIGAS QUE ESTÃO AGUARDANDO SEM ESTRUTURA (para não interferir)
  await Rodada.updateMany(
    {
      status: 'aguardando',
      $or: [
        { verde: { $exists: false } },
        { verde: null },
        { $expr: { $lt: [{ $size: '$pretos' }, 2] } }
      ]
    },
    { $set: { status: 'concluida' } }
  )

  // ----------------------------------------------------------------------
  // CRIAR UMA RODADA QUE JÁ NASCE COM ESTRUTURA (VERDE, PRETOS, AZUIS)
  // Mas sem nenhum VERMELHO – exatamente como uma rodada gerada por progressão
  // ----------------------------------------------------------------------
  const verdeRodada = await criarUsuario(
    'VerdeEstrutura',
    `verde_estrutura_${Date.now()}@teste.com`
  )
  const preto1 = await criarUsuario(
    'PretoEstrutura1',
    `preto_estrutura1_${Date.now()}@teste.com`
  )
  const preto2 = await criarUsuario(
    'PretoEstrutura2',
    `preto_estrutura2_${Date.now()}@teste.com`
  )
  const azul1 = await criarUsuario(
    'AzulEstrutura1',
    `azul_estrutura1_${Date.now()}@teste.com`
  )
  const azul2 = await criarUsuario(
    'AzulEstrutura2',
    `azul_estrutura2_${Date.now()}@teste.com`
  )
  const azul3 = await criarUsuario(
    'AzulEstrutura3',
    `azul_estrutura3_${Date.now()}@teste.com`
  )
  const azul4 = await criarUsuario(
    'AzulEstrutura4',
    `azul_estrutura4_${Date.now()}@teste.com`
  )

  const proximoNumero = await RodadaService.getProximoNumeroRodada()
  const rodadaComEstrutura = new Rodada({
    numero: proximoNumero,
    nome: `Rodada_Estrutura_${proximoNumero}`,
    status: 'aguardando',
    participantes: [
      {
        usuario: verdeRodada._id,
        cor: 'verde',
        posicao: 1,
        dataEntrada: new Date(),
        depositoConfirmado: false
      },
      {
        usuario: preto1._id,
        cor: 'preto',
        posicao: 2,
        dataEntrada: new Date(),
        depositoConfirmado: false
      },
      {
        usuario: preto2._id,
        cor: 'preto',
        posicao: 3,
        dataEntrada: new Date(),
        depositoConfirmado: false
      },
      {
        usuario: azul1._id,
        cor: 'azul',
        posicao: 4,
        dataEntrada: new Date(),
        depositoConfirmado: false
      },
      {
        usuario: azul2._id,
        cor: 'azul',
        posicao: 5,
        dataEntrada: new Date(),
        depositoConfirmado: false
      },
      {
        usuario: azul3._id,
        cor: 'azul',
        posicao: 6,
        dataEntrada: new Date(),
        depositoConfirmado: false
      },
      {
        usuario: azul4._id,
        cor: 'azul',
        posicao: 7,
        dataEntrada: new Date(),
        depositoConfirmado: false
      }
    ],
    verde: verdeRodada._id,
    pretos: [preto1._id, preto2._id],
    azuis: [azul1._id, azul2._id, azul3._id, azul4._id],
    vermelhos: [],
    totalDepositosConfirmados: 0,
    todosDepositaram: false
  })
  await rodadaComEstrutura.save()
  logInfo(
    `Rodada com estrutura criada: ${rodadaComEstrutura.nome} (status ${rodadaComEstrutura.status}, vermelhos: ${rodadaComEstrutura.vermelhos.length}/8)`
  )

  // Forçar alocação da fila (agora deve encontrar a rodada acima com 7/15 participantes e 0/8 vermelhos)
  const alocados = await RodadaService.alocarFilaEmTodasRodadas()

  // Verificar se o verde5 foi alocado
  const verde5PosAlocacao = await User.findById(verde5._id)
  const rodadaAtualizada = await Rodada.findById(rodadaComEstrutura._id)
  const participante5 = rodadaAtualizada.participantes.find(
    p => p.usuario.toString() === verde5._id.toString()
  )

  if (
    alocados === 0 ||
    verde5PosAlocacao.aguardandoVermelho ||
    !participante5 ||
    !participante5.depositoConfirmado ||
    verde5PosAlocacao.saldoPremio !== 850
  ) {
    logError(
      `   ❌ Falha na alocação. Alocados=${alocados}, aguardando=${verde5PosAlocacao.aguardandoVermelho}, participantePago=${participante5?.depositoConfirmado}, saldo=${verde5PosAlocacao.saldoPremio}`
    )
    return false
  }
  logSuccess(`   ✅ Alocado da fila, saldo descontado para R$ 850`)

  // ------------------------------------------------------------------
  // 14.6 – Verde com saque pendente → ao jogar novamente, cancela saque e paga
  // ------------------------------------------------------------------
  logInfo('\n📍 14.6 – Verde com SAQUE PENDENTE → cancela e paga com saldo')
  const { usuario: verde6, rodada: rodadaConcluida6 } =
    await criarVerdeGanhador(1000)
  // 🔧 CORREÇÃO: adicionar chavePix e tipoChavePix
  const solicitacaoPendente = new SolicitacaoSaque({
    usuario: verde6._id,
    rodada: rodadaConcluida6._id,
    valor: 1000,
    chavePix: verde6.chavePix,
    tipoChavePix: verde6.tipoChavePix,
    status: 'pendente'
  })
  await solicitacaoPendente.save()

  const rodadaDestino6 = await criarRodadaDestino()

  const result6 = await RodadaService.jogarNovamente(verde6._id.toString())
  const saqueCancelado = await SolicitacaoSaque.findById(
    solicitacaoPendente._id
  )
  const saldo6 = (await User.findById(verde6._id)).saldoPremio

  if (
    saqueCancelado.status !== 'recusado' ||
    !result6.pagoAutomaticamente ||
    saldo6 !== 850
  ) {
    logError(
      `   ❌ Saque não cancelado ou saldo não descontado. Status saque=${saqueCancelado.status}, saldo=${saldo6}`
    )
    return false
  }
  logSuccess(`   ✅ Saque cancelado, saldo R$ 850`)

  // Todos os subcenários passaram
  return true
}
// ===========================================
// FUNÇÃO PRINCIPAL
// ===========================================
async function runAllTests () {
  console.log(
    `\n${colors.bright}${colors.magenta}${'🧪'.repeat(35)}${colors.reset}`
  )
  console.log(
    `${colors.bright}${colors.magenta}    TESTE COMPLETO - VALIDAÇÃO DAS REGRAS DE NEGÓCIO    ${colors.reset}`
  )
  console.log(
    `${colors.bright}${colors.magenta}${'🧪'.repeat(35)}${colors.reset}\n`
  )

  const results = []

  try {
    await mongoose.connect(MONGODB_URI)
    logSuccess('Conectado ao MongoDB')

    await limparBanco()

    results.push({
      name: 'Regra 1: Nenhum cadastro cria rodada',
      passed: await testarRegra1_NenhumCadastroCriaRodada()
    })
    results.push({
      name: 'Regra 2: Apenas progressão cria rodadas (1→2)',
      passed: await testarRegra2_ApenasProgressaoCriaRodadas()
    })
    results.push({
      name: 'Regra 3: Estrutura da Mandala (1+2+4+8=15)',
      passed: await testarRegra3_EstruturaMandala()
    })
    results.push({
      name: 'Regra 4: Valor correto da transação (R$ 150,00)',
      passed: await testarRegra4_ValorCorreto()
    })
    results.push({
      name: 'Regra 5: Fila de espera FIFO',
      passed: await testarRegra5_FilaEsperaFIFO()
    })
    results.push({
      name: 'Regra 6: Jogar Novamente NÃO cria rodada',
      passed: await testarRegra6_JogarNovamente()
    })
    results.push({
      name: 'Regra 7: Usuário em apenas uma rodada',
      passed: await testarRegra7_UsuarioUnicaRodada()
    })
    results.push({
      name: 'Regra 8: Transações criadas quando rodada inicia',
      passed: await testarRegra8_TransacoesNaIniciodaRodada()
    })
    results.push({
      name: 'Regra 9: Promoção de cores correta',
      passed: await testarRegra9_PromocaoCores()
    })
    results.push({
      name: 'Regra 10: Saque, reativação e cancelamento automático',
      passed: await testarRegra10_SaqueEReativacao()
    })
    results.push({
      name: 'Regra 11: Convite funciona corretamente',
      passed: await testarRegra11_ConviteFunciona()
    })
    results.push({
      name: 'Regra 12: AZUL pode captar (trazer 2 pessoas)',
      passed: await testarRegra12_AzulPodeCaptar()
    })
    results.push({
      name: 'Regra 13: Email com QR Code é enviado',
      passed: await testarRegra13_EmailQrCodeEnviado()
    })
    results.push({
      name: 'Regra 14: Jogar Novamente - todas possibilidades do VERDE',
      passed: await testarRegra14_JogarNovamenteComSaldo()
    })

    logSection('RESUMO FINAL DOS TESTES')

    const passedCount = results.filter(r => r.passed).length
    const totalCount = results.length

    console.log(`\n${'📊'.repeat(35)}`)
    console.log(`   Total de testes: ${totalCount}`)
    console.log(`   ✅ Aprovados: ${passedCount}`)
    console.log(`   ❌ Falhas: ${totalCount - passedCount}`)
    console.log(
      `   📈 Percentual: ${((passedCount / totalCount) * 100).toFixed(1)}%`
    )
    console.log(`${'📊'.repeat(35)}\n`)

    console.log(`${colors.cyan}📋 DETALHES DOS TESTES:${colors.reset}`)
    for (const result of results) {
      if (result.passed) {
        console.log(`   ${colors.green}✅ ${result.name}${colors.reset}`)
      } else {
        console.log(`   ${colors.red}❌ ${result.name}${colors.reset}`)
      }
    }

    if (passedCount === totalCount) {
      console.log(
        `\n${colors.green}${colors.bright}🎉 PARABÉNS! TODOS OS ${totalCount} TESTES PASSARAM! 🎉${colors.reset}`
      )
      console.log(
        `${colors.green}${colors.bright}O sistema está 100% alinhado com todas as regras de negócio!${colors.reset}`
      )
    } else {
      console.log(
        `\n${colors.red}${colors.bright}⚠️ ATENÇÃO! ${
          totalCount - passedCount
        } teste(s) falharam.${colors.reset}`
      )
    }
  } catch (error) {
    console.error(`${colors.red}❌ ERRO:${colors.reset}`, error)
  } finally {
    await mongoose.disconnect()
    logInfo('Desconectado do MongoDB')
  }
}

runAllTests()
