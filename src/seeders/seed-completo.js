const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m'
};

async function seedCompleto() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    
    const db = mongoose.connection.db;
    const users = db.collection('users');
    
    // Limpar usuários existentes (opcional - comentar se não quiser apagar)
    // await users.deleteMany({});
    // console.log(`${colors.yellow}🗑️ Usuários antigos removidos${colors.reset}`);
    
    console.log(`${colors.green}🌱 Criando usuários de exemplo...${colors.reset}`);
    
    const salt = await bcrypt.genSalt(10);
    const senhaPadrao = await bcrypt.hash('123456', salt);
    
    const usuarios = [
      // Admin
      {
        nome: 'Administrador',
        email: 'admin@girosolidario.com',
        telefone: '11999999999',
        cpf: '00000000000',
        chavePix: 'admin@girosolidario.com',
        tipoChavePix: 'email',
        senha: senhaPadrao,
        role: 'admin',
        status: 'ativo',
        codigoConvite: 'CONVITE-ADMIN',
        createdAt: new Date()
      },
      // Usuários comuns
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
        codigoConvite: 'CONVITE-JOAO',
        createdAt: new Date()
      },
      {
        nome: 'Maria Santos',
        email: 'maria@email.com',
        telefone: '11922222222',
        cpf: '22222222222',
        chavePix: 'maria@email.com',
        tipoChavePix: 'email',
        senha: senhaPadrao,
        role: 'user',
        status: 'ativo',
        codigoConvite: 'CONVITE-MARIA',
        createdAt: new Date()
      },
      {
        nome: 'Carlos Oliveira',
        email: 'carlos@email.com',
        telefone: '11933333333',
        cpf: '33333333333',
        chavePix: 'carlos@email.com',
        tipoChavePix: 'email',
        senha: senhaPadrao,
        role: 'user',
        status: 'ativo',
        codigoConvite: 'CONVITE-CARLOS',
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
        codigoConvite: 'CONVITE-ANA',
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
        codigoConvite: 'CONVITE-PEDRO',
        createdAt: new Date()
      }
    ];
    
    for (const usuario of usuarios) {
      const exists = await users.findOne({ email: usuario.email });
      if (!exists) {
        await users.insertOne(usuario);
        console.log(`  ✅ Usuário criado: ${usuario.nome}`);
      }
    }
    
    const total = await users.countDocuments();
    console.log(`${colors.green}✅ Seed concluído! Total de usuários: ${total}${colors.reset}`);
    
  } catch (error) {
    console.error('❌ Erro no seed:', error);
  } finally {
    await mongoose.connection.close();
  }
}

seedCompleto();
