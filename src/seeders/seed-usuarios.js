const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m'
};

async function seedUsuarios() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    
    const db = mongoose.connection.db;
    const users = db.collection('users');
    
    // Verificar se já existem usuários
    const count = await users.countDocuments();
    if (count > 5) {
      console.log(`${colors.yellow}⚠️  Já existem muitos usuários, pulando seed...${colors.reset}`);
      return;
    }
    
    console.log(`${colors.green}🌱 Criando usuários de exemplo...${colors.reset}`);
    
    const salt = await bcrypt.genSalt(10);
    const senhaPadrao = await bcrypt.hash('123456', salt);
    
    const usuariosExemplo = [
      {
        nome: 'João Silva',
        email: 'joao@email.com',
        telefone: '11911111111',
        cpf: '11111111111',
        chavePix: 'joao@email.com',
        tipoChavePix: 'email',
        senha: senhaPadrao,
        role: 'user',
        status: 'ativo',
        saldo: 0,
        totalGanho: 0,
        totalInvestido: 0,
        createdAt: new Date()
      },
      {
        nome: 'Maria Santos',
        email: 'maria@email.com',
        telefone: '11922222222',
        cpf: '22222222222',
        chavePix: '11922222222',
        tipoChavePix: 'telefone',
        senha: senhaPadrao,
        role: 'user',
        status: 'ativo',
        saldo: 0,
        totalGanho: 0,
        totalInvestido: 0,
        createdAt: new Date()
      },
      {
        nome: 'Carlos Oliveira',
        email: 'carlos@email.com',
        telefone: '11933333333',
        cpf: '33333333333',
        chavePix: '33333333333',
        tipoChavePix: 'cpf',
        senha: senhaPadrao,
        role: 'user',
        status: 'ativo',
        saldo: 0,
        totalGanho: 0,
        totalInvestido: 0,
        createdAt: new Date()
      },
      {
        nome: 'Ana Pereira',
        email: 'ana@email.com',
        telefone: '11944444444',
        cpf: '44444444444',
        chavePix: 'ana@email.com',
        tipoChavePix: 'email',
        senha: senhaPadrao,
        role: 'user',
        status: 'ativo',
        saldo: 0,
        totalGanho: 0,
        totalInvestido: 0,
        createdAt: new Date()
      },
      {
        nome: 'Pedro Souza',
        email: 'pedro@email.com',
        telefone: '11955555555',
        cpf: '55555555555',
        chavePix: 'pedro@email.com',
        tipoChavePix: 'email',
        senha: senhaPadrao,
        role: 'user',
        status: 'ativo',
        saldo: 0,
        totalGanho: 0,
        totalInvestido: 0,
        createdAt: new Date()
      }
    ];
    
    for (const usuario of usuariosExemplo) {
      const exists = await users.findOne({ email: usuario.email });
      if (!exists) {
        await users.insertOne(usuario);
        console.log(`  ✅ Usuário criado: ${usuario.nome}`);
      }
    }
    
    console.log(`${colors.green}✅ Seed de usuários concluído!${colors.reset}`);
    
  } catch (error) {
    console.error('❌ Erro no seed:', error);
  } finally {
    await mongoose.connection.close();
  }
}

seedUsuarios();
