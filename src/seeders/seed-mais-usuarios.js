const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m'
};

async function seedMaisUsuarios() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    
    const db = mongoose.connection.db;
    const users = db.collection('users');
    
    console.log(`${colors.green}🌱 Criando mais usuários de exemplo...${colors.reset}`);
    
    const salt = await bcrypt.genSalt(10);
    const senhaPadrao = await bcrypt.hash('123456', salt);
    
    const novosUsuarios = [
      {
        nome: 'Lucas Ferreira',
        email: 'lucas@email.com',
        telefone: '11966666666',
        cpf: '66666666666',
        chavePix: 'lucas@email.com',
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
        nome: 'Beatriz Lima',
        email: 'beatriz@email.com',
        telefone: '11977777777',
        cpf: '77777777777',
        chavePix: '11977777777',
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
        nome: 'Rafael Costa',
        email: 'rafael@email.com',
        telefone: '11988888888',
        cpf: '88888888888',
        chavePix: 'rafael@email.com',
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
        nome: 'Camila Rocha',
        email: 'camila@email.com',
        telefone: '11999999999',
        cpf: '99999999999',
        chavePix: 'camila@email.com',
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
        nome: 'Diego Santos',
        email: 'diego@email.com',
        telefone: '11910101010',
        cpf: '10101010101',
        chavePix: 'diego@email.com',
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
        nome: 'Fernanda Oliveira',
        email: 'fernanda@email.com',
        telefone: '11911111112',
        cpf: '11111111112',
        chavePix: 'fernanda@email.com',
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
        nome: 'Gabriel Souza',
        email: 'gabriel@email.com',
        telefone: '11912121212',
        cpf: '12121212121',
        chavePix: 'gabriel@email.com',
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
        nome: 'Helena Martins',
        email: 'helena@email.com',
        telefone: '11913131313',
        cpf: '13131313131',
        chavePix: 'helena@email.com',
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
        nome: 'Igor Rodrigues',
        email: 'igor@email.com',
        telefone: '11914141414',
        cpf: '14141414141',
        chavePix: 'igor@email.com',
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
        nome: 'Juliana Alves',
        email: 'juliana@email.com',
        telefone: '11915151515',
        cpf: '15151515151',
        chavePix: 'juliana@email.com',
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
    
    for (const usuario of novosUsuarios) {
      const exists = await users.findOne({ email: usuario.email });
      if (!exists) {
        await users.insertOne(usuario);
        console.log(`  ✅ Usuário criado: ${usuario.nome}`);
      }
    }
    
    // Verificar total
    const total = await users.countDocuments();
    console.log(`${colors.green}✅ Total de usuários agora: ${total}${colors.reset}`);
    
  } catch (error) {
    console.error('❌ Erro no seed:', error);
  } finally {
    await mongoose.connection.close();
  }
}

seedMaisUsuarios();
