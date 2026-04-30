// criar-20-usuarios.js
// Execute: node src/scripts/criar-20-usuarios.js

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const User = require("../models/User");
const Rodada = require("../models/Rodada");
const Transacao = require("../models/Transacao");
const RodadaService = require("../services/rodadaService");

// 🔥 DEFINIÇÃO DO CAMINHO DOS ARQUIVOS (pasta src/scripts)
const SCRIPTS_DIR = __dirname; // Diretório atual onde o script está
const CREDENCIAIS_FILE = path.join(
  SCRIPTS_DIR,
  "credenciais-usuarios-local.json",
);
const RESUMO_RODADAS_FILE = path.join(SCRIPTS_DIR, "resumo-rodadas.json");

// Configuração do banco
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/giro-solidario";

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

async function criarUsuario(nome, email, senha = "Teste@123") {
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

async function criarAdminSeNecessario() {
  let admin = await User.findOne({ email: "admin@giropremiados.com.br" });
  if (!admin) {
    const salt = await bcrypt.genSalt(10);
    const senhaHash = await bcrypt.hash("Admin@123", salt);
    admin = new User({
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
    await admin.save();
    logSuccess("Admin criado");
  } else {
    logInfo("Admin já existe");
  }
  return admin;
}

async function criarRodadaInicial(admin) {
  const rodada = await RodadaService.criarRodada(admin._id);
  logSuccess(`Rodada criada: ${rodada.nome}`);
  return rodada;
}

async function adicionarParticipantes(rodada, admin, quantidade) {
  logInfo(`Adicionando ${quantidade} participantes à rodada ${rodada.nome}...`);

  for (let i = 1; i <= quantidade; i++) {
    const usuario = await criarUsuario(
      `Participante_${rodada.participantes.length + i}`,
      `part_${rodada.participantes.length + i}_${Date.now()}@teste.com`,
    );

    await RodadaService.adicionarParticipanteAmarelo(
      rodada._id.toString(),
      usuario._id.toString(),
      admin._id.toString(),
    );

    console.log(`   ${rodada.participantes.length + i}/15 participantes`);
  }
}

async function pagarVermelhos(rodada, admin) {
  logInfo(`Processando pagamentos dos vermelhos da ${rodada.nome}...`);

  const transacoes = await Transacao.find({ rodada: rodada._id });

  if (transacoes.length === 0) {
    logWarning(
      `Nenhuma transação encontrada. A rodada pode não ter sido iniciada.`,
    );
    return false;
  }

  for (let i = 0; i < transacoes.length; i++) {
    await RodadaService.confirmarDeposito(
      transacoes[i]._id.toString(),
      `comprovante_${i}.png`,
      admin._id.toString(),
    );
    console.log(`   Pagamento ${i + 1}/${transacoes.length} confirmado`);
  }

  return true;
}

async function criarUsuariosFila(quantidade) {
  logInfo(`Criando ${quantidade} usuários que irão para a FILA DE ESPERA...`);

  const usuariosFila = [];
  for (let i = 1; i <= quantidade; i++) {
    const usuario = await criarUsuario(
      `FilaUser_${i}`,
      `filauser_${i}_${Date.now()}@teste.com`,
    );

    usuario.aguardandoVermelho = true;
    usuario.posicaoFila = i;
    usuario.dataEntradaFila = new Date();
    await usuario.save();

    usuariosFila.push(usuario);
    console.log(`   ${i}/${quantidade} - ${usuario.nome} (posição ${i})`);
  }

  return usuariosFila;
}

async function buscarRodadaDoUsuario(usuarioId) {
  const rodada = await Rodada.findOne({
    "participantes.usuario": usuarioId,
    status: { $in: ["aguardando", "em_andamento", "concluida"] },
  });

  if (rodada) {
    const participante = rodada.participantes.find(
      (p) => p.usuario.toString() === usuarioId.toString(),
    );
    return {
      rodadaId: rodada._id,
      rodadaNome: rodada.nome,
      cor: participante?.cor || "desconhecido",
      status: rodada.status,
      depositoConfirmado: participante?.depositoConfirmado || false,
    };
  }
  return null;
}

// 🔥 FUNÇÃO ATUALIZADA: Salvar credenciais na pasta scripts
async function salvarCredenciaisComRodadas() {
  const usuarios = await User.find(
    {},
    {
      nome: 1,
      email: 1,
      codigoConvite: 1,
      aguardandoVermelho: 1,
      posicaoFila: 1,
      role: 1,
    },
  );

  const credenciais = [];

  for (const user of usuarios) {
    const rodadaInfo = await buscarRodadaDoUsuario(user._id);

    credenciais.push({
      nome: user.nome,
      email: user.email,
      senha: user.role === "admin" ? "Admin@123" : "Teste@123",
      tipo:
        user.role === "admin"
          ? "ADMIN"
          : user.aguardandoVermelho
            ? "FILA"
            : "PARTICIPANTE",
      codigoConvite: user.codigoConvite,
      naFila: user.aguardandoVermelho || false,
      posicaoFila: user.posicaoFila || null,
      rodada: rodadaInfo || null,
    });
  }

  fs.writeFileSync(CREDENCIAIS_FILE, JSON.stringify(credenciais, null, 2));
  logSuccess(`Credenciais salvas em: ${CREDENCIAIS_FILE}`);
}

// 🔥 FUNÇÃO ATUALIZADA: Salvar resumo das rodadas na pasta scripts
async function salvarResumoRodadas() {
  const rodadas = await Rodada.find({}).sort({ numero: 1 });

  const resumoRodadas = [];

  for (const rodada of rodadas) {
    const participantesComDetalhes = [];

    for (const p of rodada.participantes) {
      const user = await User.findById(p.usuario);
      participantesComDetalhes.push({
        nome: user?.nome || "Desconhecido",
        email: user?.email || "desconhecido",
        cor: p.cor,
        depositoConfirmado: p.depositoConfirmado,
        dataEntrada: p.dataEntrada,
      });
    }

    const vermelhosPagos = rodada.participantes.filter(
      (p) => p.cor === "vermelho" && p.depositoConfirmado === true,
    ).length;
    const totalVermelhos = rodada.participantes.filter(
      (p) => p.cor === "vermelho",
    ).length;

    resumoRodadas.push({
      rodadaId: rodada._id,
      nome: rodada.nome,
      numero: rodada.numero,
      status: rodada.status,
      totalParticipantes: rodada.participantes.length,
      cores: {
        verde: rodada.participantes.filter((p) => p.cor === "verde").length,
        preto: rodada.participantes.filter((p) => p.cor === "preto").length,
        azul: rodada.participantes.filter((p) => p.cor === "azul").length,
        vermelho: totalVermelhos,
        amarelo: rodada.participantes.filter((p) => p.cor === "amarelo").length,
        concluido: rodada.participantes.filter((p) => p.cor === "concluido")
          .length,
      },
      pagamentos: `${vermelhosPagos}/${totalVermelhos}`,
      premioVerdePago: rodada.premioVerdePago || false,
      verdeVencedor: rodada.verde
        ? (await User.findById(rodada.verde))?.nome
        : null,
      dataFim: rodada.dataFim,
      participantes: participantesComDetalhes,
    });
  }

  fs.writeFileSync(RESUMO_RODADAS_FILE, JSON.stringify(resumoRodadas, null, 2));
  logSuccess(`Resumo das rodadas salvo em: ${RESUMO_RODADAS_FILE}`);
}

async function mostrarStatus() {
  logSection("STATUS ATUAL DO SISTEMA");

  const totalUsuarios = await User.countDocuments();
  const usuariosFila = await User.countDocuments({ aguardandoVermelho: true });
  const usuariosRodadas = totalUsuarios - usuariosFila;

  const rodadas = await Rodada.find({}).sort({ numero: 1 });

  console.log(`\n📊 ESTATÍSTICAS:`);
  console.log(`   Total de usuários: ${totalUsuarios}`);
  console.log(`   Usuários em rodadas: ${usuariosRodadas}`);
  console.log(`   Usuários na fila: ${usuariosFila}`);
  console.log(`   Total de rodadas: ${rodadas.length}`);

  console.log(`\n📋 DETALHES DAS RODADAS:\n`);

  for (const rodada of rodadas) {
    const vermelhos = rodada.participantes.filter((p) => p.cor === "vermelho");
    const vermelhosPagos = vermelhos.filter(
      (v) => v.depositoConfirmado === true,
    );
    const totalPart = rodada.participantes.length;

    let statusIcon = "⏳";
    if (rodada.status === "concluida") statusIcon = "✅";
    else if (rodada.status === "em_andamento") statusIcon = "🔄";

    console.log(
      `   ${statusIcon} ${colors.bright}${rodada.nome}${colors.reset}`,
    );
    console.log(`      Status: ${rodada.status}`);
    console.log(`      Participantes: ${totalPart}/15`);
    console.log(
      `      Cores: 🟢${rodada.participantes.filter((p) => p.cor === "verde").length} | ⚫${rodada.participantes.filter((p) => p.cor === "preto").length} | 🔵${rodada.participantes.filter((p) => p.cor === "azul").length} | 🔴${vermelhos.length} | 🟡${rodada.participantes.filter((p) => p.cor === "amarelo").length}`,
    );
    console.log(
      `      Pagamentos: ${vermelhosPagos.length}/${vermelhos.length}`,
    );

    if (rodada.status === "concluida" && rodada.verde) {
      const verdeUser = await User.findById(rodada.verde);
      console.log(
        `      🏆 Verde vencedor: ${verdeUser?.nome || rodada.verde}`,
      );
    }

    // Listar participantes da rodada
    console.log(`      Participantes:`);
    for (const p of rodada.participantes) {
      const user = await User.findById(p.usuario);
      const corEmoji =
        {
          verde: "🟢",
          preto: "⚫",
          azul: "🔵",
          vermelho: "🔴",
          amarelo: "🟡",
          concluido: "🏆",
        }[p.cor] || "⚪";

      const pagoIcon = p.depositoConfirmado ? "✅" : "⏳";
      console.log(
        `         ${corEmoji} ${user?.nome || p.usuario} (${p.cor}) ${p.cor === "vermelho" ? pagoIcon : ""}`,
      );
    }
    console.log("");
  }

  if (usuariosFila > 0) {
    console.log(`\n⏳ USUÁRIOS NA FILA (${usuariosFila}):`);
    const fila = await User.find({ aguardandoVermelho: true }).sort({
      posicaoFila: 1,
    });
    fila.forEach((u) => {
      console.log(`   Pos ${u.posicaoFila}: ${u.nome} (${u.email})`);
    });
  }
}

async function main() {
  console.log(
    `\n${colors.bright}${colors.magenta}${"🧪".repeat(35)}${colors.reset}`,
  );
  console.log(
    `${colors.bright}${colors.magenta}    CRIAÇÃO DE 20 USUÁRIOS + TESTE COMPLETO    ${colors.reset}`,
  );
  console.log(
    `${colors.bright}${colors.magenta}${"🧪".repeat(35)}${colors.reset}\n`,
  );

  try {
    // Conectar ao MongoDB
    logInfo(`Conectando ao MongoDB: ${MONGODB_URI}`);
    await mongoose.connect(MONGODB_URI);
    logSuccess("Conectado ao MongoDB");

    // Limpar banco
    logInfo("Limpando banco de dados...");
    await User.deleteMany({});
    await Rodada.deleteMany({});
    await Transacao.deleteMany({});
    logSuccess("Banco limpo");

    // 1. Criar admin
    logSection("1. CRIANDO ADMIN");
    const admin = await criarAdminSeNecessario();

    // 2. Criar rodada inicial
    logSection("2. CRIANDO RODADA INICIAL");
    const rodadaInicial = await criarRodadaInicial(admin);

    // 3. Adicionar 14 participantes (total 15)
    logSection("3. ADICIONANDO 14 PARTICIPANTES");
    await adicionarParticipantes(rodadaInicial, admin, 14);

    // 4. Verificar distribuição de cores
    logSection("4. DISTRIBUIÇÃO DE CORES");
    const rodadaCompleta = await Rodada.findById(rodadaInicial._id);
    const cores = {
      verde: rodadaCompleta.participantes.filter((p) => p.cor === "verde")
        .length,
      preto: rodadaCompleta.participantes.filter((p) => p.cor === "preto")
        .length,
      azul: rodadaCompleta.participantes.filter((p) => p.cor === "azul").length,
      vermelho: rodadaCompleta.participantes.filter((p) => p.cor === "vermelho")
        .length,
    };
    console.log(`   🟢 Verde: ${cores.verde}`);
    console.log(`   ⚫ Preto: ${cores.preto}`);
    console.log(`   🔵 Azul: ${cores.azul}`);
    console.log(`   🔴 Vermelho: ${cores.vermelho}`);

    // 5. Pagar os vermelhos
    logSection("5. PAGANDO OS VERMELHOS");
    await pagarVermelhos(rodadaCompleta, admin);

    // 6. Verificar progressão
    logSection("6. VERIFICANDO PROGRESSÃO");
    const rodadaConcluida = await Rodada.findById(rodadaInicial._id);
    const rodadasGeradas = rodadaConcluida.rodadasGeradas || [];
    console.log(`   Rodadas geradas: ${rodadasGeradas.length}`);

    for (const id of rodadasGeradas) {
      const novaRodada = await Rodada.findById(id);
      if (novaRodada) {
        console.log(
          `   ✅ ${novaRodada.nome} criada (${novaRodada.participantes.length}/15 participantes)`,
        );
      }
    }

    // 7. Criar 20 usuários na fila
    logSection("7. CRIANDO 20 USUÁRIOS NA FILA");
    await criarUsuariosFila(20);

    // 8. Alocar fila automaticamente
    logSection("8. ALOCANDO FILA NAS RODADAS COM VAGAS");
    const alocados = await RodadaService.alocarFilaEmTodasRodadas();
    logInfo(`Alocados: ${alocados} usuários`);

    // 9. Mostrar status final
    await mostrarStatus();

    // 10. Salvar credenciais com rodadas
    await salvarCredenciaisComRodadas();

    // 11. Salvar resumo das rodadas
    await salvarResumoRodadas();

    // 12. Resumo final
    logSection("✅ TESTE CONCLUÍDO COM SUCESSO!");

    const totalUsuarios = await User.countDocuments();
    const usuariosEmRodadas = await User.countDocuments({
      aguardandoVermelho: false,
    });
    const usuariosAguardando = await User.countDocuments({
      aguardandoVermelho: true,
    });

    console.log(`\n📊 RESUMO FINAL:`);
    console.log(`   ✅ Total de usuários: ${totalUsuarios}`);
    console.log(`   ✅ Usuários em rodadas: ${usuariosEmRodadas}`);
    console.log(`   ⏳ Usuários na fila: ${usuariosAguardando}`);

    console.log(`\n🔑 CREDENCIAIS PARA LOGIN:`);
    console.log(`   Admin: admin@giropremiados.com.br / Admin@123`);
    console.log(
      `   Usuários na fila: filauser_1@teste.com a filauser_20@teste.com (senha: Teste@123)`,
    );

    console.log(`\n📁 ARQUIVOS GERADOS NA PASTA src/scripts/:`);
    console.log(
      `   📄 credenciais-usuarios-local.json - Lista completa de usuários com suas rodadas`,
    );
    console.log(
      `   📄 resumo-rodadas.json - Composição detalhada de cada rodada`,
    );
  } catch (error) {
    console.error(`${colors.red}❌ ERRO:${colors.reset}`, error);
  } finally {
    await mongoose.disconnect();
    logInfo("Desconectado do MongoDB");
  }
}

main();
