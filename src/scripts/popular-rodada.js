const mongoose = require('mongoose');
require('dotenv').config();

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m'
};

async function popularRodada(rodadaNumero = 1) {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    
    const db = mongoose.connection.db;
    const rodadas = db.collection('rodadas');
    const users = db.collection('users');
    
    // Buscar rodada
    const rodada = await rodadas.findOne({ numero: rodadaNumero });
    if (!rodada) {
      console.log(`${colors.red}❌ Rodada não encontrada${colors.reset}`);
      return;
    }
    
    // Buscar usuários disponíveis
    const usuarios = await users.find({ role: 'user' }).limit(15).toArray();
    
    if (usuarios.length < 15) {
      console.log(`${colors.yellow}⚠️  Poucos usuários. Execute o seed primeiro.${colors.reset}`);
      console.log(`   Usuários encontrados: ${usuarios.length}`);
      return;
    }
    
    console.log(`${colors.cyan}🎲 Populando rodada ${rodada.nome}...${colors.reset}`);
    
    // Limpar participantes existentes
    await rodadas.updateOne(
      { _id: rodada._id },
      { 
        $set: { 
          participantes: [],
          verde: null,
          pretos: [],
          azuis: [],
          vermelhos: []
        } 
      }
    );
    
    // Adicionar participantes
    const participantes = usuarios.slice(0, 15).map((user, index) => ({
      usuario: user._id,
      cor: 'amarelo',
      posicao: index + 1,
      dataEntrada: new Date(),
      depositoConfirmado: false
    }));
    
    await rodadas.updateOne(
      { _id: rodada._id },
      { $set: { participantes: participantes } }
    );
    
    console.log(`${colors.green}✅ Rodada populada com 15 participantes!${colors.reset}`);
    
    // Perguntar se quer iniciar a rodada
    console.log(`\n${colors.yellow}Para iniciar a rodada, execute:${colors.reset}`);
    console.log(`   npm run rodada:iniciar ${rodadaNumero}`);
    
  } catch (error) {
    console.error(`${colors.red}❌ Erro: ${error.message}${colors.reset}`);
  } finally {
    await mongoose.connection.close();
  }
}

// Pegar número da rodada dos argumentos
const rodadaNumero = process.argv[2] ? parseInt(process.argv[2]) : 1;
popularRodada(rodadaNumero);
