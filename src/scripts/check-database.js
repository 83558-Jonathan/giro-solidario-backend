const mongoose = require('mongoose');
require('dotenv').config();

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m'
};

async function checkDatabase() {
  console.log(`${colors.cyan}${colors.bright}🔍 VERIFICANDO BANCO DE DADOS${colors.reset}\n`);

  try {
    // Versão atualizada - sem opções obsoletas
    await mongoose.connect(process.env.MONGODB_URI);
    const db = mongoose.connection.db;
    
    // Listar todas as collections
    const collections = await db.listCollections().toArray();
    
    console.log(`${colors.blue}📁 Collections (${collections.length}):${colors.reset}`);
    
    for (const col of collections) {
      const count = await db.collection(col.name).countDocuments();
      console.log(`   ${col.name}: ${colors.bright}${count}${colors.reset} documentos`);
    }
    
    console.log('');
    
    // Estatísticas
    const stats = await db.stats();
    console.log(`${colors.green}📊 Estatísticas gerais:${colors.reset}`);
    console.log(`   Tamanho: ${(stats.dataSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Collections: ${stats.collections}`);
    
  } catch (error) {
    console.error(`${colors.red}❌ Erro: ${error.message}${colors.reset}`);
    console.log(`${colors.yellow}💡 Dica: Verifique se o MongoDB está rodando:${colors.reset}`);
    console.log(`   brew services start mongodb-community@5.0`);
  } finally {
    await mongoose.connection.close();
  }
}

checkDatabase();
