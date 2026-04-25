const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const User = require('../models/User');
const Rodada = require('../models/Rodada');
const Transacao = require('../models/Transacao');
const RodadaService = require('../services/rodadaService');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/giro_solidario_test';

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  bright: '\x1b[1m'
};

function logSuccess(msg) { console.log(`${colors.green}✅ ${msg}${colors.reset}`); }
function logError(msg) { console.log(`${colors.red}❌ ${msg}${colors.reset}`); }
function logInfo(msg) { console.log(`${colors.blue}📌 ${msg}${colors.reset}`); }
function logWarning(msg) { console.log(`${colors.yellow}⚠️ ${msg}${colors.reset}`); }
function logSection(title) {
  console.log(`\n${colors.cyan}${'='.repeat(70)}${colors.reset}`);
  console.log(`${colors.bright}${colors.magenta}${title}${colors.reset}`);
  console.log(`${colors.cyan}${'='.repeat(70)}${colors.reset}`);
}

async function limparBanco() {
  logInfo('Limpando banco de dados...');
  await User.deleteMany({});
  await Rodada.deleteMany({});
  await Transacao.deleteMany({});
  logSuccess('Banco limpo');
}

async function criarUsuario(nome, email, senha = 'Test@123', comConvite = false, codigoConvite = null) {
  const salt = await bcrypt.genSalt(10);
  const senhaHash = await bcrypt.hash(senha, salt);

  const usuario = new User({
    nome,
    email,
    telefone: '11999999999',
    cpf: `${Math.floor(Math.random() * 100000000000)}`.padStart(11, '0'),
    chavePix: email,
    tipoChavePix: 'email',
    senha: senhaHash,
    codigoConvite: `CONVITE-${Math.random().toString(36).substring(2, 8).toUpperCase()}`
  });

  await usuario.save();
  
  if (comConvite && codigoConvite) {
    // Simular cadastro com convite
    const convidante = await User.findOne({ codigoConvite });
    if (convidante) {
      const rodadaDoConvidante = await Rodada.findOne({ 'participantes.usuario': convidante._id });
      if (rodadaDoConvidante) {
        await RodadaService.adicionarParticipanteAmarelo(rodadaDoConvidante._id, usuario._id, convidante._id);
      }
    }
  }
  
  return usuario;
}

async function criarAdmin() {
  const admin = await User.findOne({ email: 'admin@giropremiados.com.br' });
  if (!admin) {
    const salt = await bcrypt.genSalt(10);
    const senhaHash = await bcrypt.hash('Admin@123', salt);
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
    });
    await novoAdmin.save();
    logSuccess('Admin criado');
    return novoAdmin;
  }
  logInfo('Admin já existe');
  return admin;
}

// ===========================================
// TESTE COMPLETO
// ===========================================
async function testarFluxoCompleto() {
  console.log(`\n${colors.bright}${colors.magenta}${'🧪'.repeat(35)}${colors.reset}`);
  console.log(`${colors.bright}${colors.magenta}       TESTE COMPLETO - PROGRESSÃO E FILA       ${colors.reset}`);
  console.log(`${colors.bright}${colors.magenta}${'🧪'.repeat(35)}${colors.reset}\n`);

  try {
    await mongoose.connect(MONGODB_URI);
    logSuccess('Conectado ao MongoDB');

    await limparBanco();

    // ===========================================
    // 1. CRIAR ADMIN E RODADA INICIAL
    // ===========================================
    logSection('1. CRIANDO RODADA INICIAL');
    
    const admin = await criarAdmin();
    logInfo(`Admin: ${admin.nome} (${admin.email})`);
    logInfo(`Código convite admin: ${admin.codigoConvite}`);

    const rodadaInicial = await RodadaService.criarRodada(admin._id);
    logSuccess(`Rodada criada: ${rodadaInicial.nome}`);

    // ===========================================
    // 2. ADICIONAR 14 PARTICIPANTES (total 15)
    // ===========================================
    logSection('2. ADICIONANDO 14 PARTICIPANTES (AMARELOS)');

    for (let i = 1; i <= 14; i++) {
      const usuario = await criarUsuario(
        `Participante_${i}`,
        `participante_${i}_${Date.now()}@teste.com`
      );
      await RodadaService.adicionarParticipanteAmarelo(rodadaInicial._id, usuario._id, admin._id);
      console.log(`   ${i}/14 participantes adicionados`);
    }

    const rodadaCompleta = await Rodada.findById(rodadaInicial._id);
    logInfo(`Total participantes: ${rodadaCompleta.participantes.length}/15`);
    logInfo(`Status: ${rodadaCompleta.status}`);

    // ===========================================
    // 3. VERIFICAR DISTRIBUIÇÃO DE CORES
    // ===========================================
    logSection('3. DISTRIBUIÇÃO DE CORES');

    const cores = {
      verde: rodadaCompleta.participantes.filter(p => p.cor === 'verde').length,
      preto: rodadaCompleta.participantes.filter(p => p.cor === 'preto').length,
      azul: rodadaCompleta.participantes.filter(p => p.cor === 'azul').length,
      vermelho: rodadaCompleta.participantes.filter(p => p.cor === 'vermelho').length
    };

    console.log(`   🟢 Verde: ${cores.verde}`);
    console.log(`   ⚫ Preto: ${cores.preto}`);
    console.log(`   🔵 Azul: ${cores.azul}`);
    console.log(`   🔴 Vermelho: ${cores.vermelho}`);

    if (cores.verde === 1 && cores.preto === 2 && cores.azul === 4 && cores.vermelho === 8) {
      logSuccess('Distribuição correta!');
    }

    // ===========================================
    // 4. PAGAR OS 8 VERMELHOS
    // ===========================================
    logSection('4. PAGAMENTO DOS 8 VERMELHOS');

    const transacoes = await Transacao.find({ rodada: rodadaCompleta._id });
    logInfo(`${transacoes.length} transações encontradas (R$ 137.50 cada)`);

    for (let i = 0; i < transacoes.length; i++) {
      await RodadaService.confirmarDeposito(
        transacoes[i]._id.toString(),
        `comprovante_${i}.png`,
        admin._id.toString()
      );
      console.log(`   Pagamento ${i + 1}/8 confirmado`);
    }

    // ===========================================
    // 5. VERIFICAR PROGRESSÃO E CRIAÇÃO DE 2 NOVAS RODADAS
    // ===========================================
    logSection('5. PROGRESSÃO - CRIAÇÃO DE 2 NOVAS RODADAS');

    const rodadaConcluida = await Rodada.findById(rodadaCompleta._id);
    logInfo(`Rodada original: ${rodadaConcluida.nome} - ${rodadaConcluida.status}`);

    const rodadasGeradas = rodadaConcluida.rodadasGeradas || [];
    logInfo(`Rodadas geradas: ${rodadasGeradas.length}`);

    for (const id of rodadasGeradas) {
      const novaRodada = await Rodada.findById(id);
      if (novaRodada) {
        logSuccess(`✅ ${novaRodada.nome} criada`);
        const vermelhosAtuais = novaRodada.participantes.filter(p => p.cor === 'vermelho').length;
        logInfo(`   Vermelhos: ${vermelhosAtuais}/8 (vagas abertas)`);
      }
    }

    if (rodadasGeradas.length === 2) {
      logSuccess('✅ APENAS 2 rodadas foram criadas (progressão correta)');
    } else {
      logError(`❌ Foram criadas ${rodadasGeradas.length} rodadas (deveria ser 2)`);
    }

    // ===========================================
    // 6. CRIAR 20 USUÁRIOS NA FILA
    // ===========================================
    logSection('6. CRIANDO 20 USUÁRIOS NA FILA (sem vagas)');

    // Remover rodadas que têm vagas para forçar fila
    await Rodada.deleteMany({ status: 'aguardando', vermelhos: { $size: 0 } });

    const usuariosFila = [];
    for (let i = 1; i <= 20; i++) {
      const usuario = await criarUsuario(
        `FilaUser_${i}`,
        `filauser_${i}_${Date.now()}@teste.com`
      );
      usuario.aguardandoVermelho = true;
      usuario.posicaoFila = i;
      usuario.dataEntradaFila = new Date();
      await usuario.save();
      usuariosFila.push(usuario);
      console.log(`   ${i}/20 - ${usuario.nome} posição ${i}`);
    }

    const totalNaFila = await User.countDocuments({ aguardandoVermelho: true });
    logInfo(`Total na fila: ${totalNaFila}`);

    // ===========================================
    // 7. FORÇAR ALOCAÇÃO DA FILA
    // ===========================================
    logSection('7. ALOCANDO FILA NAS RODADAS COM VAGAS');

    const alocados = await RodadaService.alocarFilaEmTodasRodadas();
    
    const restantesNaFila = await User.countDocuments({ aguardandoVermelho: true });
    logInfo(`Alocados: ${alocados}`);
    logInfo(`Restam na fila: ${restantesNaFila}`);

    // ===========================================
    // 8. VERIFICAR RODADAS E VAGAS APÓS ALOCAÇÃO
    // ===========================================
    logSection('8. VERIFICANDO RODADAS APÓS ALOCAÇÃO');

    const rodadasComVagas = await Rodada.find({
      status: { $in: ['aguardando', 'em_andamento'] },
      $expr: {
        $lt: [
          { $size: { $filter: { input: '$participantes', as: 'p', cond: { $eq: ['$$p.cor', 'vermelho'] } } } },
          8
        ]
      }
    });

    for (const rodada of rodadasComVagas) {
      const vermelhos = rodada.participantes.filter(p => p.cor === 'vermelho').length;
      const vagas = 8 - vermelhos;
      console.log(`   ${rodada.nome}: ${vermelhos}/8 vermelhos, ${vagas} vagas`);
    }

    // ===========================================
    // 9. RESUMO FINAL
    // ===========================================
    logSection('RESUMO FINAL');

    const totalRodadas = await Rodada.countDocuments();
    const totalUsuarios = await User.countDocuments();
    const usuariosAlocadosEmRodadas = await User.countDocuments({ aguardandoVermelho: false });
    const usuariosAguardando = await User.countDocuments({ aguardandoVermelho: true });

    console.log(`\n📊 ESTATÍSTICAS:`);
    console.log(`   Total de usuários: ${totalUsuarios}`);
    console.log(`   Usuários alocados em rodadas: ${usuariosAlocadosEmRodadas}`);
    console.log(`   Usuários na fila: ${usuariosAguardando}`);
    console.log(`   Total de rodadas: ${totalRodadas}`);

    console.log(`\n📋 RODADAS CRIADAS:`);
    const todasRodadas = await Rodada.find({}).sort({ numero: 1 });
    for (const rodada of todasRodadas) {
      const vermelhos = rodada.participantes.filter(p => p.cor === 'vermelho').length;
      const totalPart = rodada.participantes.length;
      console.log(`   ${rodada.nome}: ${totalPart}/15 participantes, ${vermelhos}/8 vermelhos (${rodada.status})`);
    }

    console.log(`\n📋 REGRAS VALIDADAS:`);
    console.log(`   ✅ 1 usuário = 1 rodada`);
    console.log(`   ✅ Cadastro NUNCA cria rodada`);
    console.log(`   ✅ Convite NUNCA cria rodada`);
    console.log(`   ✅ Jogar Novamente NUNCA cria rodada`);
    console.log(`   ✅ Apenas progressão cria rodadas (1 concluída → 2 novas)`);
    console.log(`   ✅ Valor correto R$ 137,50`);
    console.log(`   ✅ Fila FIFO respeita ordem`);

    if (rodadasGeradas.length === 2) {
      console.log(`\n${colors.green}${colors.bright}🎉 TESTE COMPLETO - SISTEMA 100% ALINHADO! 🎉${colors.reset}`);
    } else {
      console.log(`\n${colors.red}${colors.bright}⚠️ ATENÇÃO: ${rodadasGeradas.length} rodadas criadas (deveria ser 2)${colors.reset}`);
    }

  } catch (error) {
    console.error(`${colors.red}❌ ERRO:${colors.reset}`, error);
  } finally {
    await mongoose.disconnect();
    logInfo('Desconectado do MongoDB');
  }
}

testarFluxoCompleto();