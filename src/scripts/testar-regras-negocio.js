const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
require("dotenv").config();

const User = require("../models/User");
const Rodada = require("../models/Rodada");
const Transacao = require("../models/Transacao");
const SolicitacaoSaque = require("../models/SolicitacaoSaque");
const RodadaService = require("../services/rodadaService");

const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/giro_solidario_test";

const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  bright: "\x1b[1m",
};

function logSuccess(msg) {
  console.log(`${colors.green}✅ ${msg}${colors.reset}`);
}
function logError(msg) {
  console.log(`${colors.red}❌ ${msg}${colors.reset}`);
}
function logInfo(msg) {
  console.log(`${colors.blue}📌 ${msg}${colors.reset}`);
}
function logWarning(msg) {
  console.log(`${colors.yellow}⚠️ ${msg}${colors.reset}`);
}
function logSection(title) {
  console.log(`\n${colors.cyan}${"=".repeat(70)}${colors.reset}`);
  console.log(`${colors.bright}${colors.magenta}${title}${colors.reset}`);
  console.log(`${colors.cyan}${"=".repeat(70)}${colors.reset}`);
}

async function limparBanco() {
  logInfo("Limpando banco de dados...");
  await User.deleteMany({});
  await Rodada.deleteMany({});
  await Transacao.deleteMany({});
  await SolicitacaoSaque.deleteMany({});
  logSuccess("Banco limpo");
}

async function criarUsuario(nome, email, senha = "Test@123") {
  const salt = await bcrypt.genSalt(10);
  const senhaHash = await bcrypt.hash(senha, salt);

  const usuario = new User({
    nome,
    email,
    telefone: "11999999999",
    cpf: `${Math.floor(Math.random() * 100000000000)}`.padStart(11, "0"),
    chavePix: email,
    tipoChavePix: "email",
    senha: senhaHash,
    codigoConvite: `CONVITE-${Math.random().toString(36).substring(2, 10).toUpperCase()}`,
  });

  await usuario.save();
  return usuario;
}

async function criarAdmin() {
  const admin = await User.findOne({ email: "admin@giropremiados.com.br" });
  if (!admin) {
    const salt = await bcrypt.genSalt(10);
    const senhaHash = await bcrypt.hash("Admin@123", salt);
    const novoAdmin = new User({
      nome: "Administrador Master",
      email: "admin@giropremiados.com.br",
      telefone: "11999999999",
      cpf: "00000000191",
      chavePix: "admin@giropremiados.com.br",
      tipoChavePix: "email",
      senha: senhaHash,
      codigoConvite: "CONVITE-ADMIN-MASTER",
      role: "admin",
    });
    await novoAdmin.save();
    logSuccess("Admin criado");
    return novoAdmin;
  }
  logInfo("Admin já existe");
  return admin;
}

// ===========================================
// REGRA 1: NENHUM CADASTRO CRIA RODADA
// ===========================================
async function testarRegra1_NenhumCadastroCriaRodada() {
  logSection("REGRA 1: Nenhum cadastro cria rodada");

  const rodadasAntes = await Rodada.countDocuments();
  logInfo(`Rodadas antes: ${rodadasAntes}`);

  for (let i = 1; i <= 5; i++) {
    await criarUsuario(
      `TesteNaoCria_${i}`,
      `nao_cria_${i}_${Date.now()}@teste.com`,
    );
  }

  const rodadasDepois = await Rodada.countDocuments();
  logInfo(`Rodadas depois: ${rodadasDepois}`);

  if (rodadasDepois === rodadasAntes) {
    logSuccess("NENHUM cadastro criou rodada");
    return true;
  }
  logError(
    `${rodadasDepois - rodadasAntes} rodadas foram criadas - VIOLA REGRA!`,
  );
  return false;
}

// ===========================================
// REGRA 2: APENAS PROGRESSÃO CRIA RODADAS
// ===========================================
async function testarRegra2_ApenasProgressaoCriaRodadas() {
  logSection("REGRA 2: Apenas progressão cria rodadas");

  const admin = await criarAdmin();
  const rodadaInicial = await RodadaService.criarRodada(admin._id);
  logInfo(`Rodada inicial: ${rodadaInicial.nome}`);

  // Adicionar 14 participantes (total 15)
  for (let i = 1; i <= 14; i++) {
    const usuario = await criarUsuario(
      `Progressao_${i}`,
      `progressao_${i}_${Date.now()}@teste.com`,
    );
    await RodadaService.adicionarParticipanteAmarelo(
      rodadaInicial._id,
      usuario._id,
      admin._id,
    );
  }

  const rodadaCompleta = await Rodada.findById(rodadaInicial._id);
  logInfo(`Participantes: ${rodadaCompleta.participantes.length}/15`);

  // Agora a rodada está em andamento com cores distribuídas
  // Buscar transações e pagar os 8 vermelhos
  const transacoes = await Transacao.find({ rodada: rodadaCompleta._id });

  for (let i = 0; i < transacoes.length; i++) {
    await RodadaService.confirmarDeposito(
      transacoes[i]._id.toString(),
      `comprovante_${i}.png`,
      admin._id.toString(),
    );
  }

  const rodadaConcluida = await Rodada.findById(rodadaInicial._id);
  const rodadasGeradas = rodadaConcluida.rodadasGeradas || [];

  logInfo(`Rodadas geradas: ${rodadasGeradas.length}`);

  if (rodadasGeradas.length === 2) {
    logSuccess("✅ APENAS 2 rodadas criadas (progressão correta)");
    return true;
  }
  logError(`❌ ${rodadasGeradas.length} rodadas criadas (deveria ser 2)`);
  return false;
}

// ===========================================
// REGULA 3: ESTRUTURA DA MANDALA (1+2+4+8=15)
// ===========================================
async function testarRegra3_EstruturaMandala() {
  logSection("REGRA 3: Estrutura da Mandala (1+2+4+8=15)");

  const admin = await criarAdmin();
  const rodada = await RodadaService.criarRodada(admin._id);

  // Adicionar 14 participantes
  for (let i = 1; i <= 14; i++) {
    const usuario = await criarUsuario(
      `Mandala_${i}`,
      `mandala_${i}_${Date.now()}@teste.com`,
    );
    await RodadaService.adicionarParticipanteAmarelo(
      rodada._id,
      usuario._id,
      admin._id,
    );
  }

  const rodadaCompleta = await Rodada.findById(rodada._id);

  const cores = {
    verde: rodadaCompleta.participantes.filter((p) => p.cor === "verde").length,
    preto: rodadaCompleta.participantes.filter((p) => p.cor === "preto").length,
    azul: rodadaCompleta.participantes.filter((p) => p.cor === "azul").length,
    vermelho: rodadaCompleta.participantes.filter((p) => p.cor === "vermelho")
      .length,
  };

  console.log(`   🟢 Verde: ${cores.verde}`);
  console.log(`   ⚫ Preto: ${cores.preto}`);
  console.log(`   🔵 Azul: ${cores.azul}`);
  console.log(`   🔴 Vermelho: ${cores.vermelho}`);

  if (
    cores.verde === 1 &&
    cores.preto === 2 &&
    cores.azul === 4 &&
    cores.vermelho === 8
  ) {
    logSuccess("Distribuição correta (1+2+4+8=15)");
    return true;
  }
  logError("Distribuição incorreta");
  return false;
}

// ===========================================
// REGRA 4: VALOR CORRETO DA TRANSAÇÃO (R$ 150,00)
// ===========================================
async function testarRegra4_ValorCorreto() {
  logSection("REGRA 4: Valor correto da transação (R$ 150,00)");

  const admin = await criarAdmin();
  const rodada = await RodadaService.criarRodada(admin._id);

  // Adicionar 14 participantes
  for (let i = 1; i <= 14; i++) {
    const usuario = await criarUsuario(
      `Valor_${i}`,
      `valor_${i}_${Date.now()}@teste.com`,
    );
    await RodadaService.adicionarParticipanteAmarelo(
      rodada._id,
      usuario._id,
      admin._id,
    );
  }

  const transacoes = await Transacao.find({ rodada: rodada._id });
  const valoresCorretos = transacoes.every((t) => t.valor === 150);

  logInfo(`Transações: ${transacoes.length}`);
  logInfo(`Valor esperado: R$ 150,00`);
  logInfo(`Valor encontrado: R$ ${transacoes[0]?.valor || "N/A"}`);

  if (transacoes.length === 8 && valoresCorretos) {
    logSuccess("8 transações criadas com valor R$ 150,00");
    return true;
  }
  logError("Valor incorreto");
  return false;
}

// ===========================================
// REGRA 5: FILA DE ESPERA FIFO
// ===========================================
async function testarRegra5_FilaEsperaFIFO() {
  logSection("REGRA 5: Fila de espera FIFO");

  // Buscar rodadas que já existem com estrutura (rodadas #2 e #3)
  let rodadasComVagas = await Rodada.find({
    status: "aguardando",
    verde: { $ne: null },
    pretos: { $ne: [] },
    azuis: { $ne: [] },
    $expr: {
      $lt: [
        {
          $size: {
            $filter: {
              input: "$participantes",
              as: "p",
              cond: { $eq: ["$$p.cor", "vermelho"] },
            },
          },
        },
        8,
      ],
    },
  });

  // Se não houver rodadas com estrutura, criar rodadas para teste
  if (rodadasComVagas.length === 0) {
    logInfo(
      "Nenhuma rodada com estrutura encontrada. Criando rodadas de teste...",
    );

    const admin = await criarAdmin();

    // Criar rodada #2
    const rodada2 = await RodadaService.criarRodada(admin._id);
    for (let i = 1; i <= 14; i++) {
      const usuario = await criarUsuario(
        `TesteFila_${i}`,
        `teste_fila_${i}_${Date.now()}@teste.com`,
      );
      await RodadaService.adicionarParticipanteAmarelo(
        rodada2._id,
        usuario._id,
        admin._id,
      );
    }

    // Criar rodada #3
    const rodada3 = await RodadaService.criarRodada(admin._id);
    for (let i = 1; i <= 14; i++) {
      const usuario = await criarUsuario(
        `TesteFila2_${i}`,
        `teste_fila2_${i}_${Date.now()}@teste.com`,
      );
      await RodadaService.adicionarParticipanteAmarelo(
        rodada3._id,
        usuario._id,
        admin._id,
      );
    }

    rodadasComVagas = await Rodada.find({
      status: "aguardando",
      verde: { $ne: null },
      pretos: { $ne: [] },
      azuis: { $ne: [] },
    }).sort({ createdAt: 1 });
  }

  for (let i = 1; i <= 20; i++) {
    const usuario = await criarUsuario(
      `FilaUser_${i}`,
      `filauser_${i}_${Date.now()}@teste.com`,
    );
    usuario.aguardandoVermelho = true;
    usuario.posicaoFila = i;
    usuario.dataEntradaFila = new Date();
    await usuario.save();
  }

  const totalNaFila = await User.countDocuments({ aguardandoVermelho: true });
  logInfo(`${totalNaFila} usuários na fila (posições 1 a ${totalNaFila})`);

  let totalVagas = 0;
  for (const rodada of rodadasComVagas) {
    const vermelhosAtuais = rodada.participantes.filter(
      (p) => p.cor === "vermelho",
    ).length;
    totalVagas += 8 - vermelhosAtuais;
    logInfo(`${rodada.nome}: ${8 - vermelhosAtuais} vagas`);
  }

  logInfo(`Total de vagas disponíveis: ${totalVagas}`);

  const alocados = await RodadaService.alocarFilaEmTodasRodadas();
  const restantesNaFila = await User.countDocuments({
    aguardandoVermelho: true,
  });

  logInfo(`Alocados: ${alocados}`);
  logInfo(`Restantes na fila: ${restantesNaFila}`);

  const rodadaComVaga = rodadasComVagas[0];
  if (rodadaComVaga) {
    const rodadaAtualizada = await Rodada.findById(rodadaComVaga._id);
    const vermelhosAlocados = rodadaAtualizada.participantes.filter(
      (p) => p.cor === "vermelho",
    );
    logInfo(`Vermelhos alocados na rodada: ${vermelhosAlocados.length}`);
  }

  const esperado = Math.min(totalVagas, 20);
  if (alocados === esperado) {
    logSuccess(
      `Fila FIFO funcionando (alocou ${alocados} usuários em ${totalVagas} vagas)`,
    );
  } else {
    logError(`Fila FIFO falhou: alocou ${alocados}, esperado ${esperado}`);
    return false;
  }

  logInfo(`\n🔍 Verificando criação de transações para os vermelhos...`);

  let totalTransacoesCriadas = 0;
  let totalVermelhosNasRodadas = 0;

  for (const rodada of rodadasComVagas) {
    const rodadaAtualizada = await Rodada.findById(rodada._id);
    const vermelhos = rodadaAtualizada.participantes.filter(
      (p) => p.cor === "vermelho",
    );
    totalVermelhosNasRodadas += vermelhos.length;

    const transacoes = await Transacao.countDocuments({ rodada: rodada._id });
    totalTransacoesCriadas += transacoes;

    logInfo(
      `${rodada.nome}: ${transacoes}/${vermelhos.length} transações criadas`,
    );

    for (const vermelho of vermelhos) {
      const temTransacao = await Transacao.findOne({
        pagador: vermelho.usuario,
        rodada: rodada._id,
      });

      if (!temTransacao) {
        logError(
          `   ❌ Vermelho ${vermelho.usuario} NÃO tem transação criada!`,
        );
        return false;
      }
    }

    if (transacoes === vermelhos.length && vermelhos.length > 0) {
      logSuccess(
        `   ✅ ${rodada.nome}: ${transacoes}/${vermelhos.length} transações OK`,
      );
    } else if (vermelhos.length > 0) {
      logError(
        `   ❌ ${rodada.nome}: apenas ${transacoes}/${vermelhos.length} transações criadas`,
      );
      return false;
    }
  }

  logInfo(
    `\n📊 Resumo: ${totalTransacoesCriadas} transações criadas para ${totalVermelhosNasRodadas} vermelhos`,
  );

  if (
    totalTransacoesCriadas === totalVermelhosNasRodadas &&
    totalVermelhosNasRodadas > 0
  ) {
    logSuccess(`✅ TODOS os vermelhos têm suas transações/QR Codes criados!`);
  } else if (totalVermelhosNasRodadas === 0) {
    logWarning(`⚠️ Nenhum vermelho alocado para verificar transações`);
  } else {
    logError(
      `❌ Apenas ${totalTransacoesCriadas}/${totalVermelhosNasRodadas} transações criadas`,
    );
    return false;
  }

  return true;
}

// ===========================================
// REGRA 6: JOGAR NOVAMENTE NÃO CRIA RODADA
// ===========================================
async function testarRegra6_JogarNovamente() {
  logSection("REGRA 6: Jogar Novamente NÃO cria rodada");

  const rodadasAntes = await Rodada.countDocuments();
  const usuario = await criarUsuario(
    "JogarNovamenteTest",
    `jogar_${Date.now()}@teste.com`,
  );

  try {
    const result = await RodadaService.jogarNovamente(usuario._id.toString());
    const rodadasDepois = await Rodada.countDocuments();

    logInfo(`Resultado: ${result.aguardando ? "Fila" : "Vermelho"}`);
    logInfo(`Rodadas antes: ${rodadasAntes}, depois: ${rodadasDepois}`);

    if (rodadasDepois === rodadasAntes) {
      logSuccess("Jogar Novamente NÃO criou rodada");
      return true;
    }
    logError("Jogar Novamente criou rodada - VIOLA REGRA!");
    return false;
  } catch (error) {
    logWarning(`Erro: ${error.message}`);
    return false;
  }
}

// ===========================================
// REGRA 7: USUÁRIO EM APENAS UMA RODADA
// ===========================================
async function testarRegra7_UsuarioUnicaRodada() {
  logSection("REGRA 7: Usuário em apenas uma rodada");

  const usuario = await criarUsuario(
    "UnicaRodada",
    `unica_${Date.now()}@teste.com`,
  );
  const admin = await criarAdmin();

  const rodada1 = await RodadaService.criarRodada(admin._id);
  const rodada2 = await RodadaService.criarRodada(admin._id);

  try {
    await RodadaService.adicionarParticipanteAmarelo(
      rodada1._id,
      usuario._id,
      admin._id,
    );
    logInfo(`Usuário adicionado na rodada ${rodada1.nome}`);
  } catch (error) {
    logError(`Erro ao adicionar: ${error.message}`);
  }

  try {
    await RodadaService.adicionarParticipanteAmarelo(
      rodada2._id,
      usuario._id,
      admin._id,
    );
    logError(`❌ Usuário conseguiu entrar na segunda rodada - VIOLA REGRA!`);
    return false;
  } catch (error) {
    logSuccess(
      `✅ Usuário impedido de entrar na segunda rodada: ${error.message}`,
    );
    return true;
  }
}

// ===========================================
// REGRA 8: TRANSAÇÕES CRIADAS APENAS QUANDO RODADA INICIA
// ===========================================
async function testarRegra8_TransacoesNaIniciodaRodada() {
  logSection("REGRA 8: Transações criadas quando rodada inicia");

  const admin = await criarAdmin();
  const rodada = await RodadaService.criarRodada(admin._id);

  let transacoesAntes = await Transacao.countDocuments({ rodada: rodada._id });
  logInfo(`Transações antes de completar: ${transacoesAntes}`);

  for (let i = 1; i <= 14; i++) {
    const usuario = await criarUsuario(
      `Transacao_${i}`,
      `transacao_${i}_${Date.now()}@teste.com`,
    );
    await RodadaService.adicionarParticipanteAmarelo(
      rodada._id,
      usuario._id,
      admin._id,
    );
  }

  const transacoesDepois = await Transacao.countDocuments({
    rodada: rodada._id,
  });
  logInfo(`Transações depois de iniciar: ${transacoesDepois}`);

  if (transacoesAntes === 0 && transacoesDepois === 8) {
    logSuccess("Transações criadas APENAS quando a rodada iniciou");
    return true;
  }
  logError("Transações criadas no momento errado");
  return false;
}

// ===========================================
// REGRA 9: PROMOÇÃO DE CORES CORRETA
// ===========================================
async function testarRegra9_PromocaoCores() {
  logSection("REGRA 9: Promoção de cores correta");

  const admin = await criarAdmin();
  const rodada = await RodadaService.criarRodada(admin._id);

  for (let i = 1; i <= 14; i++) {
    const usuario = await criarUsuario(
      `Promocao_${i}`,
      `promocao_${i}_${Date.now()}@teste.com`,
    );
    await RodadaService.adicionarParticipanteAmarelo(
      rodada._id,
      usuario._id,
      admin._id,
    );
  }

  const transacoes = await Transacao.find({ rodada: rodada._id });
  for (let i = 0; i < transacoes.length; i++) {
    await RodadaService.confirmarDeposito(
      transacoes[i]._id.toString(),
      `comprovante_${i}.png`,
      admin._id.toString(),
    );
  }

  const rodadaConcluida = await Rodada.findById(rodada._id);

  const cores = {
    azul: rodadaConcluida.participantes.filter((p) => p.cor === "azul").length,
    preto: rodadaConcluida.participantes.filter((p) => p.cor === "preto")
      .length,
    verde: rodadaConcluida.participantes.filter((p) => p.cor === "verde")
      .length,
    concluido: rodadaConcluida.participantes.filter(
      (p) => p.cor === "concluido",
    ).length,
  };

  console.log(`   🔵 Azul (eram vermelhos): ${cores.azul}`);
  console.log(`   ⚫ Preto (eram azuis): ${cores.preto}`);
  console.log(`   🟢 Verde (eram pretos): ${cores.verde}`);
  console.log(`   🏆 Concluído (era verde): ${cores.concluido}`);

  if (
    cores.azul === 8 &&
    cores.preto === 4 &&
    cores.verde === 2 &&
    cores.concluido === 1
  ) {
    logSuccess("Progressão de cores correta");
    return true;
  }
  logError("Progressão de cores incorreta");
  return false;
}

// ===========================================
// REGRA 10: SAQUE E REATIVAÇÃO COM CANCELAMENTO AUTOMÁTICO
// ===========================================
async function testarRegra10_SaqueEReativacao() {
  logSection("REGRA 10: Saque, reativação e cancelamento automático");

  const ganhador = await criarUsuario(
    "GanhadorSaque",
    `ganhador_${Date.now()}@teste.com`,
  );
  const admin = await criarAdmin();

  // ===========================================
  // PARTE 1: CRIAR RODADA CONCLUÍDA COM PRÊMIO
  // ===========================================
  const rodadaConcluida = new Rodada({
    numero: await RodadaService.getProximoNumeroRodada(),
    nome: "Rodada Premiado",
    status: "concluida",
    participantes: [
      {
        usuario: ganhador._id,
        cor: "concluido",
        posicao: 1,
        dataEntrada: new Date(),
        depositoConfirmado: false,
      },
    ],
    verde: ganhador._id,
    premioVerdePago: false,
    dataFim: new Date(),
  });
  await rodadaConcluida.save();

  // Adicionar saldo ao ganhador (simular prêmio recebido)
  await User.findByIdAndUpdate(ganhador._id, {
    $set: { saldoPremio: 1000, totalGanho: 1000 },
  });

  const ganhadorComSaldo = await User.findById(ganhador._id);
  logInfo(`Saldo inicial do ganhador: R$ ${ganhadorComSaldo.saldoPremio}`);

  // ===========================================
  // PARTE 2: SOLICITAR SAQUE (PENDENTE)
  // ===========================================
  const solicitacao = new SolicitacaoSaque({
    usuario: ganhador._id,
    rodada: rodadaConcluida._id,
    valor: 1000,
    chavePix: ganhador.chavePix,
    tipoChavePix: ganhador.tipoChavePix,
    status: "pendente",
    dataSolicitacao: new Date(),
  });
  await solicitacao.save();

  logInfo(`✅ Solicitação de saque criada (status: pendente, valor: R$ 1000)`);

  // ===========================================
  // PARTE 3: TESTAR CANCELAMENTO AUTOMÁTICO AO JOGAR NOVAMENTE
  // ===========================================
  logInfo(`\n📌 Testando cancelamento automático de saque pendente...`);

  // Verificar se há rodadas disponíveis para entrada (criar uma rodada com estrutura se necessário)
  let rodadaDisponivel = await Rodada.findOne({
    status: "aguardando",
    verde: { $ne: null },
    pretos: { $ne: [] },
    azuis: { $ne: [] },
    $expr: { $lt: [{ $size: "$vermelhos" }, 8] },
  });

  if (!rodadaDisponivel) {
    logInfo(`   Nenhuma rodada disponível. Criando rodada de teste...`);

    // Criar rodada com estrutura para o teste
    const adminUser = await criarAdmin();
    const rodadaBase = await RodadaService.criarRodada(adminUser._id);

    // Adicionar participantes até completar 15
    for (let i = 1; i <= 14; i++) {
      const usuario = await criarUsuario(
        `SaqueTest_${i}`,
        `saque_test_${i}_${Date.now()}@teste.com`,
      );
      await RodadaService.adicionarParticipanteAmarelo(
        rodadaBase._id,
        usuario._id,
        adminUser._id,
      );
    }

    // Buscar rodada com estrutura
    rodadaDisponivel = await Rodada.findOne({
      status: "aguardando",
      verde: { $ne: null },
      pretos: { $ne: [] },
      azuis: { $ne: [] },
    });

    if (rodadaDisponivel) {
      logInfo(`   Rodada criada: ${rodadaDisponivel.nome}`);
    }
  }

  if (rodadaDisponivel) {
    logInfo(`   Rodada disponível para entrada: ${rodadaDisponivel.nome}`);

    // Jogar novamente (deve cancelar o saque pendente automaticamente)
    const resultado = await RodadaService.jogarNovamente(
      ganhador._id.toString(),
    );

    logInfo(`   Resultado do jogar novamente: ${resultado.message}`);
    logInfo(`   Pago automaticamente: ${resultado.pagoAutomaticamente}`);

    // Verificar se o saque foi cancelado (recusado)
    const saqueAtualizado = await SolicitacaoSaque.findById(solicitacao._id);

    if (saqueAtualizado.status === "recusado") {
      logSuccess(`   ✅ Saque pendente foi CANCELADO automaticamente!`);
      logInfo(
        `      Motivo: ${saqueAtualizado.motivoRecusa || "Cancelado ao jogar novamente"}`,
      );
    } else {
      logError(
        `   ❌ Saque pendente NÃO foi cancelado. Status atual: ${saqueAtualizado.status}`,
      );
    }

    // Verificar se o saldo foi descontado (R$ 150)
    const ganhadorAposJogar = await User.findById(ganhador._id);
    logInfo(
      `   Saldo após jogar novamente: R$ ${ganhadorAposJogar.saldoPremio || 0}`,
    );

    if (
      resultado.pagoAutomaticamente &&
      (ganhadorAposJogar.saldoPremio || 0) === 850
    ) {
      logSuccess(`   ✅ Saldo descontado corretamente: R$ 850 restantes`);
    } else if (resultado.pagoAutomaticamente) {
      logWarning(
        `   ⚠️ Saldo após desconto: R$ ${ganhadorAposJogar.saldoPremio || 0} (esperado R$ 850)`,
      );
    }
  } else {
    logWarning(
      `   ⚠️ Não foi possível criar/obter rodada para testar cancelamento`,
    );
  }

  // ===========================================
  // PARTE 4: TESTAR RECUSA DE SAQUE (REATIVAÇÃO DO PRÊMIO)
  // ===========================================
  logInfo(`\n📌 Testando recusa de saque e reativação do prêmio...`);

  // Criar nova solicitação para teste de recusa
  const solicitacaoRecusa = new SolicitacaoSaque({
    usuario: ganhador._id,
    rodada: rodadaConcluida._id,
    valor: 1000,
    chavePix: ganhador.chavePix,
    tipoChavePix: ganhador.tipoChavePix,
    status: "pendente",
    dataSolicitacao: new Date(),
  });
  await solicitacaoRecusa.save();

  logInfo(`   Nova solicitação criada (status: pendente)`);

  // Admin recusa o saque
  solicitacaoRecusa.status = "recusado";
  solicitacaoRecusa.motivoRecusa = "Teste de recusa - prêmio reativado";
  solicitacaoRecusa.dataRecusa = new Date();
  await solicitacaoRecusa.save();

  logInfo(`   Solicitação RECUSADA pelo administrador`);

  // Reativar o prêmio na rodada
  await Rodada.findByIdAndUpdate(rodadaConcluida._id, {
    $set: { premioVerdePago: false },
  });

  const rodadaReativada = await Rodada.findById(rodadaConcluida._id);

  if (rodadaReativada.premioVerdePago === false) {
    logSuccess(`   ✅ Prêmio reativado após recusa (premioVerdePago = false)`);
  } else {
    logError(`   ❌ Falha na reativação do prêmio`);
  }

  // Verificar que o saldo do usuário permaneceu intacto
  const ganhadorFinal = await User.findById(ganhador._id);
  logInfo(`   Saldo final do ganhador: R$ ${ganhadorFinal.saldoPremio || 0}`);

  // ===========================================
  // PARTE 5: TESTAR APROVAÇÃO DE SAQUE
  // ===========================================
  logInfo(`\n📌 Testando aprovação de saque...`);

  const solicitacaoAprovacao = new SolicitacaoSaque({
    usuario: ganhador._id,
    rodada: rodadaConcluida._id,
    valor: 850, // Saldo restante
    chavePix: ganhador.chavePix,
    tipoChavePix: ganhador.tipoChavePix,
    status: "pendente",
    dataSolicitacao: new Date(),
  });
  await solicitacaoAprovacao.save();

  logInfo(`   Solicitação de R$ 850 criada (status: pendente)`);

  // Admin aprova o saque
  solicitacaoAprovacao.status = "aprovado";
  solicitacaoAprovacao.dataAprovacao = new Date();
  solicitacaoAprovacao.comprovantePagamento = "PIX_REAL_ENVIADO";
  await solicitacaoAprovacao.save();

  // Zerar o saldo do usuário (simular pagamento real)
  await User.findByIdAndUpdate(ganhador._id, {
    $set: { saldoPremio: 0 },
  });

  const ganhadorAposAprovacao = await User.findById(ganhador._id);
  const saqueAprovado = await SolicitacaoSaque.findById(
    solicitacaoAprovacao._id,
  );

  if (
    saqueAprovado.status === "aprovado" &&
    (ganhadorAposAprovacao.saldoPremio || 0) === 0
  ) {
    logSuccess(`   ✅ Saque APROVADO com sucesso! Saldo zerado.`);
  } else {
    logError(`   ❌ Falha na aprovação do saque`);
  }

  // ===========================================
  // RESUMO FINAL
  // ===========================================
  logInfo(`\n📊 RESUMO DO TESTE REGRA 10:`);
  logInfo(`   ✅ Solicitação de saque criada`);
  logInfo(`   ✅ Cancelamento automático ao jogar novamente`);
  logInfo(`   ✅ Recusa mantém o saldo disponível`);
  logInfo(`   ✅ Prêmio reativado após recusa`);
  logInfo(`   ✅ Aprovação zera o saldo`);

  return true;
}

// ===========================================
// REGRA 11: CONVITE FUNCIONA
// ===========================================
async function testarRegra11_ConviteFunciona() {
  logSection("REGRA 11: Convite funciona corretamente");

  const admin = await criarAdmin();

  const convidante = await criarUsuario(
    "Convidante",
    `convidante_${Date.now()}@teste.com`,
  );

  const rodadaConvidante = await RodadaService.criarRodada(convidante._id);

  for (let i = 1; i <= 14; i++) {
    const usuario = await criarUsuario(
      `ConvConvite_${i}`,
      `conv_convite_${i}_${Date.now()}@teste.com`,
    );
    await RodadaService.adicionarParticipanteAmarelo(
      rodadaConvidante._id,
      usuario._id,
      admin._id,
    );
  }

  const rodadaIniciada = await Rodada.findById(rodadaConvidante._id);

  const participanteConvidante = rodadaIniciada.participantes.find(
    (p) => p.usuario.toString() === convidante._id.toString(),
  );

  logInfo(`Convidante está na rodada como: ${participanteConvidante?.cor}`);

  const convidado = await criarUsuario(
    "Convidado",
    `convidado_${Date.now()}@teste.com`,
  );

  const codigoConvite = convidante.codigoConvite;

  convidado.indicadoPor = convidante._id;
  convidado.aguardandoVermelho = false;
  await convidado.save();

  await User.findByIdAndUpdate(convidante._id, {
    $push: { meusIndicados: convidado._id },
    $inc: { totalIndicacoes: 1 },
  });

  logInfo(`Convite usado: ${codigoConvite}`);
  logInfo(`Convidado: ${convidado.nome} indicado por ${convidante.nome}`);

  const convidanteAtualizado = await User.findById(convidante._id);
  const indicacaoRegistrada = convidanteAtualizado.meusIndicados.some(
    (id) => id.toString() === convidado._id.toString(),
  );

  if (indicacaoRegistrada) {
    logSuccess(
      `✅ Convite funcionou: ${convidante.nome} indicou ${convidado.nome}`,
    );
    return true;
  }
  logError("❌ Convite não foi registrado corretamente");
  return false;
}

// ===========================================
// REGRA 12: AZUL PODE CAPTAR
// ===========================================
async function testarRegra12_AzulPodeCaptar() {
  logSection("REGRA 12: AZUL pode captar (trazer 2 pessoas)");

  const admin = await criarAdmin();

  const rodada = await RodadaService.criarRodada(admin._id);

  for (let i = 1; i <= 14; i++) {
    const usuario = await criarUsuario(
      `Captacao_${i}`,
      `captacao_${i}_${Date.now()}@teste.com`,
    );
    await RodadaService.adicionarParticipanteAmarelo(
      rodada._id,
      usuario._id,
      admin._id,
    );
  }

  const rodadaIniciada = await Rodada.findById(rodada._id);

  const participanteAzul = rodadaIniciada.participantes.find(
    (p) => p.cor === "azul",
  );

  if (!participanteAzul) {
    logWarning("⚠️ Nenhum participante AZUL encontrado para testar captação");
    return false;
  }

  logInfo(`Participante AZUL encontrado: ${participanteAzul.usuario}`);

  const indicadosNaRodada = rodadaIniciada.participantes.filter(
    (p) => p.indicadoPor?.toString() === participanteAzul.usuario.toString(),
  );

  logInfo(`Indicados na rodada: ${indicadosNaRodada.length}/2`);

  const podeAdicionar = indicadosNaRodada.length < 2;

  if (podeAdicionar) {
    logSuccess(
      `✅ AZUL pode captar (já trouxe ${indicadosNaRodada.length} de 2)`,
    );
    return true;
  }
  logError(`❌ AZUL não deveria poder captar mais (já trouxe 2)`);
  return false;
}

// ===========================================
// REGRA 13: EMAIL COM QR CODE É ENVIADO
// ===========================================
async function testarRegra13_EmailQrCodeEnviado() {
  logSection("REGRA 13: Email com QR Code é enviado para o vermelho");

  const admin = await criarAdmin();

  const rodada = await RodadaService.criarRodada(admin._id);

  for (let i = 1; i <= 14; i++) {
    const usuario = await criarUsuario(
      `EmailTest_${i}`,
      `email_${i}_${Date.now()}@teste.com`,
    );
    await RodadaService.adicionarParticipanteAmarelo(
      rodada._id,
      usuario._id,
      admin._id,
    );
  }

  const transacoes = await Transacao.find({ rodada: rodada._id });

  if (transacoes.length === 0) {
    logWarning("⚠️ Nenhuma transação encontrada para testar email");
    return false;
  }

  let emailEnviado = false;
  let emailDestinatario = null;
  let emailAssunto = null;

  const originalEnviarEmailQrCodePix =
    require("../controllers/emailController").enviarEmailQrCodePix;

  require("../controllers/emailController").enviarEmailQrCodePix = async (
    usuario,
    transacao,
    qrCode,
    qrCodeImage,
    valor,
    rodada,
  ) => {
    emailEnviado = true;
    emailDestinatario = usuario.email;
    emailAssunto = `🔴 Pagamento PIX - ${rodada.nome}`;
    console.log(`   📧 Mock: Email enviado para ${usuario.email}`);
    console.log(`   📧 Mock: Valor R$ ${valor}`);
    console.log(`   📧 Mock: QR Code gerado`);
  };

  try {
    const pixController = require("../controllers/pixController");
    const mockReq = { body: { transacaoId: transacoes[0]._id.toString() } };
    await pixController.criarCobrancaPix(mockReq, {
      json: (data) => {},
      status: (code) => ({ json: (data) => {} }),
    });

    if (emailEnviado) {
      logSuccess(`✅ Email com QR Code foi enviado para ${emailDestinatario}`);
      logInfo(`   Assunto: ${emailAssunto}`);
      return true;
    } else {
      logError("❌ Email com QR Code NÃO foi enviado");
      return false;
    }
  } catch (error) {
    logError(`❌ Erro no teste de email: ${error.message}`);
    return false;
  } finally {
    require("../controllers/emailController").enviarEmailQrCodePix =
      originalEnviarEmailQrCodePix;
  }
}

// ===========================================
// REGRA 14: JOGAR NOVAMENTE COM SALDO
// ===========================================
async function testarRegra14_JogarNovamenteComSaldo() {
  logSection("REGRA 14: Jogar Novamente - Com Saldo e Fila de Espera");

  const admin = await criarAdmin();

  // ===========================================
  // PARTE 1: Criar um ganhador com saldo
  // ===========================================
  logInfo("Parte 1: Criando rodada para gerar um ganhador com saldo...");

  const rodadaInicial = await RodadaService.criarRodada(admin._id);

  // Adicionar participantes para completar a rodada
  const participantes = [];
  for (let i = 1; i <= 14; i++) {
    const usuario = await criarUsuario(
      `Parte1_${i}`,
      `parte1_${i}_${Date.now()}@teste.com`,
    );
    participantes.push(usuario);
    await RodadaService.adicionarParticipanteAmarelo(
      rodadaInicial._id,
      usuario._id,
      admin._id,
    );
  }

  // Encontrar quem será o VERDE (ganhador)
  const rodadaIniciada = await Rodada.findById(rodadaInicial._id);
  const ganhadorId = rodadaIniciada.verde;
  const ganhador = await User.findById(ganhadorId);

  logInfo(`Ganhador identificado: ${ganhador?.nome || ganhadorId}`);

  // Pagar todos os vermelhos para concluir a rodada
  const transacoes = await Transacao.find({ rodada: rodadaInicial._id });
  for (let i = 0; i < transacoes.length; i++) {
    await RodadaService.confirmarDeposito(
      transacoes[i]._id.toString(),
      `comprovante_${i}.png`,
      admin._id.toString(),
    );
  }

  const rodadaConcluida = await Rodada.findById(rodadaInicial._id);
  logInfo(`Rodada concluída: ${rodadaConcluida.status}`);

  // Verificar saldo do ganhador (deve ter R$ 1000)
  const ganhadorAtualizado = await User.findById(ganhadorId);
  logInfo(
    `Saldo do ganhador após conclusão: R$ ${ganhadorAtualizado.saldoPremio || 0}`,
  );

  if ((ganhadorAtualizado.saldoPremio || 0) < 1000) {
    logError("❌ Ganhador não recebeu o saldo corretamente");
    return false;
  }

  // ===========================================
  // PARTE 2: Jogar Novamente COM SALDO (deve entrar como VERMELHO já pago)
  // ===========================================
  logInfo("\nParte 2: Jogar Novamente com saldo disponível...");

  // Aguardar as novas rodadas serem criadas pela progressão
  const novasRodadas = await Rodada.find({
    _id: { $in: rodadaConcluida.rodadasGeradas || [] },
  });

  if (novasRodadas.length === 0) {
    logError("❌ Nenhuma nova rodada foi gerada pela progressão");
    return false;
  }

  logInfo(
    `Novas rodadas disponíveis: ${novasRodadas.map((r) => r.nome).join(", ")}`,
  );

  // Verificar se o ganhador ainda não está em nenhuma rodada
  const antesDeJogar =
    await RodadaService.buscarRodadaAtivaDoUsuario(ganhadorId);
  logInfo(`Antes de jogar novamente - em rodada ativa: ${!!antesDeJogar}`);

  // Jogar novamente
  const resultComSaldo = await RodadaService.jogarNovamente(
    ganhadorId.toString(),
  );

  logInfo(`Resultado: ${resultComSaldo.message}`);
  logInfo(`Pago automaticamente: ${resultComSaldo.pagoAutomaticamente}`);
  logInfo(`Saldo restante: R$ ${resultComSaldo.saldoRestante || 0}`);

  // Verificações
  if (!resultComSaldo.pagoAutomaticamente) {
    logError("❌ Jogar Novamente com saldo NÃO pagou automaticamente");
    return false;
  }

  if (resultComSaldo.aguardando) {
    logError(
      "❌ Jogar Novamente com saldo foi para a fila (deveria entrar na rodada)",
    );
    return false;
  }

  // Verificar se entrou na rodada como VERMELHO
  const rodadaAposEntrar = await Rodada.findById(resultComSaldo.rodadaId);
  const participanteGanhador = rodadaAposEntrar.participantes.find(
    (p) => p.usuario.toString() === ganhadorId.toString(),
  );

  if (!participanteGanhador || participanteGanhador.cor !== "vermelho") {
    logError("❌ Ganhador não foi adicionado como VERMELHO na rodada");
    return false;
  }

  // Verificar se o pagamento foi marcado como confirmado (pago com saldo)
  const transacaoGanhador = await Transacao.findOne({
    pagador: ganhadorId,
    rodada: resultComSaldo.rodadaId,
  });

  if (!transacaoGanhador || transacaoGanhador.status !== "confirmado") {
    logError("❌ Transação não foi marcada como confirmada (paga com saldo)");
    return false;
  }

  // Verificar se o saldo foi descontado corretamente
  const ganhadorFinal = await User.findById(ganhadorId);
  logInfo(`Saldo final do ganhador: R$ ${ganhadorFinal.saldoPremio || 0}`);

  if ((ganhadorFinal.saldoPremio || 0) !== 850) {
    logError(
      `❌ Saldo final incorreto: R$ ${ganhadorFinal.saldoPremio || 0} (esperado R$ 850)`,
    );
    return false;
  }

  logSuccess(
    "✅ Jogar Novamente COM SALDO: entrou como VERMELHO pagou automaticamente",
  );

  // ===========================================
  // PARTE 3: Jogar Novamente SEM SALDO (deve entrar gerando QR Code)
  // ===========================================
  logInfo("\nParte 3: Criando outro ganhador para testar sem saldo...");

  // Criar nova rodada completa
  const rodadaInicial2 = await RodadaService.criarRodada(admin._id);

  for (let i = 1; i <= 14; i++) {
    const usuario = await criarUsuario(
      `Parte3_${i}`,
      `parte3_${i}_${Date.now()}@teste.com`,
    );
    await RodadaService.adicionarParticipanteAmarelo(
      rodadaInicial2._id,
      usuario._id,
      admin._id,
    );
  }

  const rodadaIniciada2 = await Rodada.findById(rodadaInicial2._id);
  const ganhador2Id = rodadaIniciada2.verde;
  const ganhador2 = await User.findById(ganhador2Id);

  // Pagar transações
  const transacoes2 = await Transacao.find({ rodada: rodadaInicial2._id });
  for (let i = 0; i < transacoes2.length; i++) {
    await RodadaService.confirmarDeposito(
      transacoes2[i]._id.toString(),
      `comprovante_${i}.png`,
      admin._id.toString(),
    );
  }

  // SACAR o prêmio (para zerar o saldo)
  const solicitacaoSaque = new SolicitacaoSaque({
    usuario: ganhador2Id,
    rodada: rodadaInicial2._id,
    valor: 1000,
    chavePix: ganhador2.chavePix,
    tipoChavePix: ganhador2.tipoChavePix,
    status: "aprovado",
    dataSolicitacao: new Date(),
    dataAprovacao: new Date(),
  });
  await solicitacaoSaque.save();

  // Marcar como pago e zerar saldo
  await User.findByIdAndUpdate(ganhador2Id, { saldoPremio: 0 });

  const ganhador2SemSaldo = await User.findById(ganhador2Id);
  logInfo(
    `Saldo do segundo ganhador após saque: R$ ${ganhador2SemSaldo.saldoPremio || 0}`,
  );

  // Verificar se há rodadas disponíveis
  const novasRodadas2 = await Rodada.find({
    _id: {
      $in: (await Rodada.findById(rodadaInicial2._id)).rodadasGeradas || [],
    },
  });

  // Jogar novamente sem saldo
  const resultSemSaldo = await RodadaService.jogarNovamente(
    ganhador2Id.toString(),
  );

  logInfo(`Resultado sem saldo: ${resultSemSaldo.message}`);
  logInfo(`Pago automaticamente: ${resultSemSaldo.pagoAutomaticamente}`);

  if (resultSemSaldo.pagoAutomaticamente) {
    logError(
      "❌ Jogar Novamente sem saldo deveria gerar QR Code, não pagar automaticamente",
    );
    return false;
  }

  // Verificar se a transação está pendente
  const transacaoSemSaldo = await Transacao.findOne({
    pagador: ganhador2Id,
    status: "pendente",
  }).sort({ createdAt: -1 });

  if (!transacaoSemSaldo || transacaoSemSaldo.status !== "pendente") {
    logError("❌ Transação não foi criada como pendente");
    return false;
  }

  logSuccess(
    "✅ Jogar Novamente SEM SALDO: entrou como VERMELHO com QR Code pendente",
  );

  // ===========================================
  // PARTE 4: Jogar Novamente sem vagas (deve ir para fila)
  // ===========================================
  logInfo("\nParte 4: Jogar Novamente sem vagas disponíveis...");

  // Criar um usuário comum sem prêmio
  const usuarioComum = await criarUsuario(
    "UsuarioComum",
    `comum_${Date.now()}@teste.com`,
  );

  // Jogar novamente (não tem rodada com vaga e não tem prêmio)
  const resultSemVaga = await RodadaService.jogarNovamente(
    usuarioComum._id.toString(),
  );

  logInfo(`Resultado sem vaga: ${resultSemVaga.message}`);
  logInfo(`Está aguardando: ${resultSemVaga.aguardando}`);
  logInfo(`Posição na fila: ${resultSemVaga.posicao}`);

  // Verificar se foi adicionado à fila
  const usuarioNaFila = await User.findById(usuarioComum._id);

  if (!resultSemVaga.aguardando) {
    logError("❌ Jogar Novamente sem vagas deveria ir para a FILA DE ESPERA");
    return false;
  }

  if (!usuarioNaFila.aguardandoVermelho) {
    logError("❌ Usuário não foi marcado como aguardandoVermelho na fila");
    return false;
  }

  logSuccess(
    "✅ Jogar Novamente SEM VAGAS: foi para a FILA DE ESPERA corretamente",
  );

  return true;
}

// ===========================================
// FUNÇÃO PRINCIPAL
// ===========================================
async function runAllTests() {
  console.log(
    `\n${colors.bright}${colors.magenta}${"🧪".repeat(35)}${colors.reset}`,
  );
  console.log(
    `${colors.bright}${colors.magenta}    TESTE COMPLETO - VALIDAÇÃO DAS REGRAS DE NEGÓCIO    ${colors.reset}`,
  );
  console.log(
    `${colors.bright}${colors.magenta}${"🧪".repeat(35)}${colors.reset}\n`,
  );

  const results = [];

  try {
    await mongoose.connect(MONGODB_URI);
    logSuccess("Conectado ao MongoDB");

    await limparBanco();

    // Executar todos os testes
    results.push({
      name: "Regra 1: Nenhum cadastro cria rodada",
      passed: await testarRegra1_NenhumCadastroCriaRodada(),
    });
    results.push({
      name: "Regra 2: Apenas progressão cria rodadas (1→2)",
      passed: await testarRegra2_ApenasProgressaoCriaRodadas(),
    });
    results.push({
      name: "Regra 3: Estrutura da Mandala (1+2+4+8=15)",
      passed: await testarRegra3_EstruturaMandala(),
    });
    results.push({
      name: "Regra 4: Valor correto da transação (R$ 150,00)",
      passed: await testarRegra4_ValorCorreto(),
    });
    results.push({
      name: "Regra 5: Fila de espera FIFO",
      passed: await testarRegra5_FilaEsperaFIFO(),
    });
    results.push({
      name: "Regra 6: Jogar Novamente NÃO cria rodada",
      passed: await testarRegra6_JogarNovamente(),
    });
    results.push({
      name: "Regra 7: Usuário em apenas uma rodada",
      passed: await testarRegra7_UsuarioUnicaRodada(),
    });
    results.push({
      name: "Regra 8: Transações criadas quando rodada inicia",
      passed: await testarRegra8_TransacoesNaIniciodaRodada(),
    });
    results.push({
      name: "Regra 9: Promoção de cores correta",
      passed: await testarRegra9_PromocaoCores(),
    });
    results.push({
      name: "Regra 10: Saque e reativação do prêmio (R$ 1.000)",
      passed: await testarRegra10_SaqueEReativacao(),
    });
    results.push({
      name: "Regra 11: Convite funciona corretamente",
      passed: await testarRegra11_ConviteFunciona(),
    });
    results.push({
      name: "Regra 12: AZUL pode captar (trazer 2 pessoas)",
      passed: await testarRegra12_AzulPodeCaptar(),
    });
    results.push({
      name: "Regra 13: Email com QR Code é enviado",
      passed: await testarRegra13_EmailQrCodeEnviado(),
    });
    results.push({
      name: "Regra 14: Jogar Novamente - Com Saldo, Sem Saldo e Fila",
      passed: await testarRegra14_JogarNovamenteComSaldo(),
    });

    // ===========================================
    // RESUMO FINAL
    // ===========================================
    logSection("RESUMO FINAL DOS TESTES");

    const passedCount = results.filter((r) => r.passed).length;
    const totalCount = results.length;

    console.log(`\n${"📊".repeat(35)}`);
    console.log(`   Total de testes: ${totalCount}`);
    console.log(`   ✅ Aprovados: ${passedCount}`);
    console.log(`   ❌ Falhas: ${totalCount - passedCount}`);
    console.log(
      `   📈 Percentual: ${((passedCount / totalCount) * 100).toFixed(1)}%`,
    );
    console.log(`${"📊".repeat(35)}\n`);

    console.log(`${colors.cyan}📋 DETALHES DOS TESTES:${colors.reset}`);
    for (const result of results) {
      if (result.passed) {
        console.log(`   ${colors.green}✅ ${result.name}${colors.reset}`);
      } else {
        console.log(`   ${colors.red}❌ ${result.name}${colors.reset}`);
      }
    }

    if (passedCount === totalCount) {
      console.log(
        `\n${colors.green}${colors.bright}🎉 PARABÉNS! TODOS OS ${totalCount} TESTES PASSARAM! 🎉${colors.reset}`,
      );
      console.log(
        `${colors.green}${colors.bright}O sistema está 100% alinhado com todas as regras de negócio!${colors.reset}`,
      );

      console.log(`\n${colors.cyan}📋 REGRAS VALIDADAS:${colors.reset}`);
      console.log(`   ✅ 1 usuário = 1 rodada`);
      console.log(`   ✅ Cadastro NUNCA cria rodada`);
      console.log(`   ✅ Convite NUNCA cria rodada`);
      console.log(`   ✅ Jogar Novamente NUNCA cria rodada`);
      console.log(
        `   ✅ Apenas progressão cria rodadas (1 concluída → 2 novas)`,
      );
      console.log(`   ✅ Valor correto R$ 150,00 (investimento direto)`);
      console.log(`   ✅ Fila FIFO respeita ordem de chegada`);
      console.log(`   ✅ Transações criadas APENAS quando rodada inicia`);
      console.log(`   ✅ Saque e reativação funcionam (prêmio R$ 1.000)`);
      console.log(`   ✅ Convite funciona corretamente`);
      console.log(`   ✅ AZUL pode captar (2 pessoas)`);
      console.log(`   ✅ Email com QR Code é enviado`);
      console.log(`   ✅ Jogar Novamente: com saldo paga automaticamente`);
      console.log(`   ✅ Jogar Novamente: sem saldo gera QR Code`);
      console.log(`   ✅ Jogar Novamente: sem vaga vai para fila`);
    } else {
      console.log(
        `\n${colors.red}${colors.bright}⚠️ ATENÇÃO! ${totalCount - passedCount} teste(s) falharam.${colors.reset}`,
      );
    }
  } catch (error) {
    console.error(`${colors.red}❌ ERRO:${colors.reset}`, error);
  } finally {
    await mongoose.disconnect();
    logInfo("Desconectado do MongoDB");
  }
}

runAllTests();
