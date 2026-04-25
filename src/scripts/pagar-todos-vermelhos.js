// pagar-todos-vermelhos.js
// Execute: node src/scripts/pagar-todos-vermelhos.js

const mongoose = require('mongoose');
require('dotenv').config();

const Rodada = require('../models/Rodada');
const Transacao = require('../models/Transacao');
const User = require('../models/User');
const RodadaService = require('../services/rodadaService');

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

async function main() {
  console.log(`\n${colors.bright}${colors.magenta}${'💰'.repeat(35)}${colors.reset}`);
  console.log(`${colors.bright}${colors.magenta}    PAGAMENTO AUTOMÁTICO DE TODOS OS VERMELHOS    ${colors.reset}`);
  console.log(`${colors.bright}${colors.magenta}${'💰'.repeat(35)}${colors.reset}\n`);

  try {
    // Conectar ao MongoDB
    const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/giro-solidario';
    logInfo(`Conectando ao MongoDB: ${MONGODB_URI}`);
    await mongoose.connect(MONGODB_URI);
    logSuccess('Conectado ao MongoDB');

    // Buscar admin
    const admin = await User.findOne({ email: 'admin@giropremiados.com.br' });
    if (!admin) {
      logError('Admin não encontrado!');
      return;
    }
    logInfo(`Admin: ${admin.nome} (${admin.email})`);

    // Buscar rodadas em andamento
    const rodadas = await Rodada.find({ 
      status: 'em_andamento'
    }).sort({ numero: 1 });

    logSection(`ENCONTRADAS ${rodadas.length} RODADA(S) EM ANDAMENTO`);

    let totalPagos = 0;

    for (const rodada of rodadas) {
      console.log(`\n${colors.cyan}📋 Processando ${rodada.nome}${colors.reset}`);
      console.log(`   Status: ${rodada.status}`);
      console.log(`   Participantes: ${rodada.participantes.length}/15`);
      
      // Buscar vermelhos da rodada
      const vermelhos = rodada.participantes.filter(p => p.cor === 'vermelho');
      const vermelhosPagos = vermelhos.filter(v => v.depositoConfirmado === true);
      
      console.log(`   Vermelhos: ${vermelhosPagos.length}/${vermelhos.length} pagos`);
      
      if (vermelhosPagos.length === vermelhos.length) {
        logWarning(`   Todos os vermelhos já pagaram!`);
        continue;
      }
      
      // Buscar transações pendentes
      const transacoesPendentes = await Transacao.find({
        rodada: rodada._id,
        status: 'pendente'
      });
      
      console.log(`   Transações pendentes: ${transacoesPendentes.length}`);
      
      for (const transacao of transacoesPendentes) {
        const pagador = await User.findById(transacao.pagador);
        console.log(`\n   💰 Pagando ${pagador?.nome || transacao.pagador}...`);
        
        try {
          await RodadaService.confirmarDeposito(
            transacao._id.toString(),
            `pagamento_auto_${Date.now()}.png`,
            admin._id.toString()
          );
          console.log(`      ✅ Pagamento confirmado!`);
          totalPagos++;
        } catch (error) {
          console.error(`      ❌ Erro: ${error.message}`);
        }
        
        // Pequeno delay para evitar sobrecarga
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    // Verificar resultado final
    logSection('RESULTADO FINAL');

    const rodadasAtualizadas = await Rodada.find({ 
      status: 'em_andamento'
    }).sort({ numero: 1 });

    console.log(`\n📊 STATUS DAS RODADAS APÓS PAGAMENTOS:\n`);
    
    for (const rodada of rodadasAtualizadas) {
      const vermelhos = rodada.participantes.filter(p => p.cor === 'vermelho');
      const vermelhosPagos = vermelhos.filter(v => v.depositoConfirmado === true);
      
      let icon = '🔄';
      if (rodada.status === 'concluida') icon = '✅';
      else if (rodada.status === 'aguardando') icon = '⏳';
      
      console.log(`   ${icon} ${rodada.nome}: ${vermelhosPagos.length}/${vermelhos.length} vermelhos pagos (${rodada.status})`);
      
      // Verificar se a rodada foi concluída
      if (rodada.status === 'concluida') {
        const rodadasGeradas = rodada.rodadasGeradas || [];
        if (rodadasGeradas.length > 0) {
          console.log(`      → Gerou: ${rodadasGeradas.length} nova(s) rodada(s)`);
          for (const id of rodadasGeradas) {
            const novaRodada = await Rodada.findById(id);
            if (novaRodada) {
              console.log(`         📌 ${novaRodada.nome} (${novaRodada.participantes.length}/15 participantes)`);
            }
          }
        }
      }
    }

    // Verificar fila restante
    const filaRestante = await User.find({ aguardandoVermelho: true }).sort({ posicaoFila: 1 });
    
    console.log(`\n⏳ FILA DE ESPERA:`);
    if (filaRestante.length === 0) {
      logSuccess(`   ✅ Fila vazia! Todos os usuários foram alocados.`);
    } else {
      console.log(`   ${filaRestante.length} usuário(s) na fila:`);
      for (const user of filaRestante) {
        console.log(`      Pos ${user.posicaoFila}: ${user.nome} (${user.email})`);
      }
    }

    // Estatísticas finais
    const totalUsuarios = await User.countDocuments();
    const usuariosEmRodadas = await User.countDocuments({ aguardandoVermelho: false });
    const usuariosAguardando = await User.countDocuments({ aguardandoVermelho: true });
    const totalRodadas = await Rodada.countDocuments();
    const rodadasConcluidas = await Rodada.countDocuments({ status: 'concluida' });

    console.log(`\n${colors.cyan}📊 ESTATÍSTICAS FINAIS:${colors.reset}`);
    console.log(`   Total de usuários: ${totalUsuarios}`);
    console.log(`   Usuários em rodadas: ${usuariosEmRodadas}`);
    console.log(`   Usuários na fila: ${usuariosAguardando}`);
    console.log(`   Total de rodadas: ${totalRodadas}`);
    console.log(`   Rodadas concluídas: ${rodadasConcluidas}`);
    console.log(`   Pagamentos processados agora: ${totalPagos}`);

    logSuccess(`\n🎉 PROCESSO CONCLUÍDO! ${totalPagos} pagamentos confirmados.`);

  } catch (error) {
    console.error(`${colors.red}❌ ERRO:${colors.reset}`, error);
  } finally {
    await mongoose.disconnect();
    logInfo('Desconectado do MongoDB');
  }
}

main();