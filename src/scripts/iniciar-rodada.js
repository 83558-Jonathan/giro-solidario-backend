const mongoose = require('mongoose');
require('dotenv').config();
const RodadaService = require('../services/rodadaService');

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  cyan: '\x1b[36m'
};

async function iniciarRodada(rodadaNumero = 1) {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    
    console.log(`${colors.cyan}🚀 Iniciando rodada #${rodadaNumero}...${colors.reset}`);
    
    // Buscar rodada pelo número
    const db = mongoose.connection.db;
    const rodadas = db.collection('rodadas');
    
    const rodada = await rodadas.findOne({ numero: rodadaNumero });
    
    if (!rodada) {
      console.log(`${colors.red}❌ Rodada não encontrada${colors.reset}`);
      return;
    }
    
    // Iniciar rodada
    const rodadaIniciada = await RodadaService.iniciarRodada(rodada._id.toString());
    
    console.log(`${colors.green}✅ Rodada iniciada com sucesso!${colors.reset}`);
    console.log(`\n📊 Distribuição:`);
    console.log(`   🟢 Verde: 1`);
    console.log(`   ⚫ Pretos: 2`);
    console.log(`   🔵 Azuis: 4`);
    console.log(`   🔴 Vermelhos: 8`);
    
  } catch (error) {
    console.error(`${colors.red}❌ Erro: ${error.message}${colors.reset}`);
  } finally {
    await mongoose.connection.close();
  }
}

const rodadaNumero = process.argv[2] ? parseInt(process.argv[2]) : 1;
iniciarRodada(rodadaNumero);
