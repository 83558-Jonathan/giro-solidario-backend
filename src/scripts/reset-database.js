const mongoose = require('mongoose');
require('dotenv').config();

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m'
};

class DatabaseReset {
  async run() {
    console.log(`${colors.red}${colors.bright}⚠️  RESETANDO BANCO DE DADOS${colors.reset}\n`);

    try {
      // Conectar
      console.log(`${colors.cyan}📦 Conectando...${colors.reset}`);
      await mongoose.connect(process.env.MONGODB_URI);
      
      const db = mongoose.connection.db;
      
      // Listar collections
      const collections = await db.listCollections().toArray();
      
      if (collections.length === 0) {
        console.log(`${colors.yellow}ℹ️  Nenhuma collection encontrada${colors.reset}`);
      } else {
        console.log(`${colors.yellow}📁 Collections encontradas:${colors.reset}`);
        collections.forEach(c => console.log(`   - ${c.name}`));
        
        // Perguntar confirmação
        console.log(`\n${colors.red}⚠️  Isso vai APAGAR TODOS OS DADOS!${colors.reset}`);
        console.log(`Para confirmar, execute: npm run db:reset:force\n`);
        
        // Se tiver argumento --force, apaga
        if (process.argv.includes('--force')) {
          for (const col of collections) {
            await db.collection(col.name).drop();
            console.log(`${colors.green}  ✅ Collection removida: ${col.name}${colors.reset}`);
          }
          console.log(`\n${colors.green}✅ Banco de dados resetado com sucesso!${colors.reset}`);
        }
      }
      
    } catch (error) {
      console.error(`${colors.red}❌ Erro: ${error.message}${colors.reset}`);
    } finally {
      await mongoose.connection.close();
      console.log(`${colors.yellow}📡 Conexão fechada${colors.reset}`);
    }
  }
}

// Executar
const reset = new DatabaseReset();
reset.run();
