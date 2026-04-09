const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m'
};

async function resetarECriarUsuarios() {
  try {
    console.log(`${colors.cyan}🗑️ Conectando ao MongoDB...${colors.reset}`);
    await mongoose.connect(process.env.MONGODB_URI);
    const db = mongoose.connection.db;
    
    // 1. DELETAR TODAS AS COLLECTIONS
    console.log(`${colors.yellow}🗑️ Deletando todas as collections...${colors.reset}`);
    
    const collections = await db.listCollections().toArray();
    for (const col of collections) {
      await db.collection(col.name).drop();
      console.log(`   ✅ Deletada: ${col.name}`);
    }
    
    // 2. RECRIAR COLLECTIONS
    console.log(`\n${colors.cyan}📁 Criando collections...${colors.reset}`);
    
    await db.createCollection('users');
    await db.createCollection('rodadas');
    await db.createCollection('transacoes');
    await db.createCollection('notificacoes');
    await db.createCollection('logs');
    await db.createCollection('configuracoes');
    
    console.log(`   ✅ 6 collections criadas`);
    
    // 3. CRIAR ÍNDICES
    console.log(`\n${colors.cyan}🔍 Criando índices...${colors.reset}`);
    
    await db.collection('users').createIndex({ email: 1 }, { unique: true });
    await db.collection('users').createIndex({ cpf: 1 }, { unique: true });
    await db.collection('rodadas').createIndex({ numero: 1 }, { unique: true });
    await db.collection('transacoes').createIndex({ createdAt: -1 });
    
    console.log(`   ✅ Índices criados`);
    
    // 4. CRIAR USUÁRIOS
    console.log(`\n${colors.cyan}👥 Criando 16 usuários...${colors.reset}`);
    
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash('123456', salt);
    
    const usuarios = [
      // Admin
      {
        nome: 'Administrador',
        email: 'admin@girosolidario.com',
        telefone: '11999999999',
        cpf: '00000000000',
        chavePix: 'admin@girosolidario.com',
        tipoChavePix: 'email',
        senha: hash,
        role: 'admin',
        status: 'ativo',
        codigoConvite: 'CONVITE-ADMIN',
        createdAt: new Date()
      },
      // Usuários comuns
      { nome: 'João Silva', email: 'joao@email.com', cpf: '11111111111' },
      { nome: 'Maria Santos', email: 'maria@email.com', cpf: '22222222222' },
      { nome: 'Carlos Oliveira', email: 'carlos@email.com', cpf: '33333333333' },
      { nome: 'Ana Pereira', email: 'ana@email.com', cpf: '44444444444' },
      { nome: 'Pedro Souza', email: 'pedro@email.com', cpf: '55555555555' },
      { nome: 'Lucas Ferreira', email: 'lucas@email.com', cpf: '66666666666' },
      { nome: 'Beatriz Lima', email: 'beatriz@email.com', cpf: '77777777777' },
      { nome: 'Rafael Costa', email: 'rafael@email.com', cpf: '88888888888' },
      { nome: 'Camila Rocha', email: 'camila@email.com', cpf: '99999999999' },
      { nome: 'Diego Santos', email: 'diego@email.com', cpf: '10101010101' },
      { nome: 'Fernanda Oliveira', email: 'fernanda@email.com', cpf: '11111111112' },
      { nome: 'Gabriel Souza', email: 'gabriel@email.com', cpf: '12121212121' },
      { nome: 'Helena Martins', email: 'helena@email.com', cpf: '13131313131' },
      { nome: 'Igor Rodrigues', email: 'igor@email.com', cpf: '14141414141' },
      { nome: 'Juliana Alves', email: 'juliana@email.com', cpf: '15151515151' }
    ];
    
    // Criar admin
    await db.collection('users').insertOne(usuarios[0]);
    console.log(`   ✅ Admin criado: admin@girosolidario.com`);
    
    // Criar usuários comuns
    for (let i = 1; i < usuarios.length; i++) {
      const u = usuarios[i];
      await db.collection('users').insertOne({
        nome: u.nome,
        email: u.email,
        telefone: '119' + Math.floor(10000000 + Math.random() * 90000000),
        cpf: u.cpf,
        chavePix: u.email,
        tipoChavePix: 'email',
        senha: hash,
        role: 'user',
        status: 'ativo',
        codigoConvite: 'CONVITE-' + u.nome.split(' ')[0].toUpperCase(),
        createdAt: new Date()
      });
      console.log(`   ✅ ${i}. ${u.nome} - ${u.email}`);
    }
    
    // 5. VERIFICAR
    const total = await db.collection('users').countDocuments();
    console.log(`\n${colors.green}✅ TOTAL DE USUÁRIOS: ${total}${colors.reset}`);
    console.log(`   Admin: 1, Comuns: ${total - 1}`);
    
    // 6. CRIAR CONFIGURAÇÕES INICIAIS
    console.log(`\n${colors.cyan}⚙️ Criando configurações...${colors.reset}`);
    
    const configuracoes = [
      { chave: 'sistema', valor: { nome: 'Giro Premiado', versao: '1.0.0', valorDeposito: 125, valorRecebimento: 1000, totalParticipantes: 15 } },
      { chave: 'pix', valor: { tiposChave: ['cpf', 'email', 'telefone', 'aleatoria'], taxa: 0.10 } },
      { chave: 'notificacoes', valor: { email: true, whatsapp: false, push: true } }
    ];
    
    for (const config of configuracoes) {
      await db.collection('configuracoes').insertOne({
        ...config,
        createdAt: new Date(),
        updatedAt: new Date()
      });
    }
    console.log(`   ✅ 3 configurações criadas`);
    
    console.log(`\n${colors.green}${colors.bright}✅ RESET COMPLETO!${colors.reset}`);
    console.log(`\n${colors.yellow}📋 Credenciais:${colors.reset}`);
    console.log(`   Admin: admin@girosolidario.com / 123456`);
    console.log(`   Usuários: joao@email.com / 123456 (e mais 14)`);
    
  } catch (error) {
    console.error(`${colors.red}❌ Erro:${colors.reset}`, error);
  } finally {
    await mongoose.connection.close();
    console.log(`\n${colors.yellow}📡 Conexão fechada${colors.reset}`);
  }
}

resetarECriarUsuarios();
