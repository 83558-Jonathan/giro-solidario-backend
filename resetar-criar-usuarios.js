const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  bright: '\x1b[1m'
};

async function resetarECriarUsuarios() {
  let verdeId = null;
  let verdeNome = 'N/A';

  try {
    console.log(`${colors.cyan}🗑️ Conectando ao MongoDB...${colors.reset}`);
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/giro-solidario');
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

    // 4. CRIAR USUÁRIOS (TOTAL: 15 - 1 admin + 14 comuns)
    console.log(`\n${colors.cyan}👥 Criando 15 usuários...${colors.reset}`);

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash('123456', salt);

    // Lista de usuários comuns (14 usuários)
    const usuariosComuns = [
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
      { nome: 'Igor Rodrigues', email: 'igor@email.com', cpf: '14141414141' }
    ];

    // Criar admin (1)
    const admin = {
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
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await db.collection('users').insertOne(admin);
    console.log(`   ✅ 1. Administrador (admin@girosolidario.com)`);

    // Criar usuários comuns (14)
    for (let i = 0; i < usuariosComuns.length; i++) {
      const u = usuariosComuns[i];
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
        createdAt: new Date(),
        updatedAt: new Date()
      });
      console.log(`   ✅ ${i + 2}. ${u.nome} - ${u.email}`);
    }

    // 5. VERIFICAR TOTAL
    const total = await db.collection('users').countDocuments();
    console.log(`\n${colors.green}✅ TOTAL DE USUÁRIOS: ${total}/15${colors.reset}`);
    console.log(`   Admin: 1, Comuns: ${total - 1}`);

    // 6. CRIAR CONFIGURAÇÕES INICIAIS
    console.log(`\n${colors.cyan}⚙️ Criando configurações...${colors.reset}`);

    const configuracoes = [
      {
        chave: 'sistema',
        valor: {
          nome: 'Giro Premiado',
          versao: '1.0.0',
          valorDeposito: 125,
          valorRecebimento: 1000,
          totalParticipantes: 15,
          taxa: 0.10
        }
      },
      {
        chave: 'pix',
        valor: {
          tiposChave: ['cpf', 'email', 'telefone', 'aleatoria'],
          taxa: 0.10
        }
      },
      {
        chave: 'notificacoes',
        valor: {
          email: true,
          whatsapp: false,
          push: true
        }
      }
    ];

    for (const config of configuracoes) {
      await db.collection('configuracoes').insertOne({
        ...config,
        createdAt: new Date(),
        updatedAt: new Date()
      });
    }
    console.log(`   ✅ 3 configurações criadas`);

    // 7. CRIAR RODADA #1 COM 15 PARTICIPANTES
    console.log(`\n${colors.cyan}🎯 Criando Rodada #1 com 15 participantes...${colors.reset}`);

    // Buscar todos os usuários
    const todosUsuarios = await db.collection('users').find({}).toArray();

    if (todosUsuarios.length === 15) {
      // Criar rodada #1
      const rodada1 = {
        numero: 1,
        nome: "Rodada #1",
        status: "aguardando",
        participantes: [],
        pretos: [],
        azuis: [],
        vermelhos: [],
        totalDepositosConfirmados: 0,
        todosDepositaram: false,
        historicoMovimentacoes: [],
        rodadasGeradas: [],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Adicionar todos como amarelos
      todosUsuarios.forEach((user, index) => {
        rodada1.participantes.push({
          usuario: user._id,
          cor: "amarelo",
          posicao: index + 1,
          dataEntrada: new Date(),
          depositoConfirmado: false
        });
      });

      // Inserir rodada
      const result = await db.collection('rodadas').insertOne(rodada1);
      console.log(`   ✅ Rodada #1 criada com ID: ${result.insertedId}`);

      // Embaralhar participantes
      let shuffled = [...rodada1.participantes];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }

      // Distribuir cores: 1 verde, 2 pretos, 4 azuis, 8 vermelhos
      shuffled[0].cor = "verde";
      shuffled[1].cor = "preto";
      shuffled[2].cor = "preto";
      for (let i = 3; i < 7; i++) shuffled[i].cor = "azul";
      for (let i = 7; i < 15; i++) shuffled[i].cor = "vermelho";

      // Coletar IDs
      verdeId = shuffled[0].usuario;
      const pretosIds = [shuffled[1].usuario, shuffled[2].usuario];
      const azuisIds = [];
      const vermelhosIds = [];

      for (let i = 3; i < 7; i++) azuisIds.push(shuffled[i].usuario);
      for (let i = 7; i < 15; i++) vermelhosIds.push(shuffled[i].usuario);

      // Buscar nome do verde
      const verdeUser = await db.collection('users').findOne({ _id: verdeId });
      verdeNome = verdeUser?.nome || 'N/A';

      // Atualizar rodada
      await db.collection('rodadas').updateOne(
        { _id: result.insertedId },
        {
          $set: {
            status: "em_andamento",
            dataInicio: new Date(),
            participantes: shuffled,
            verde: verdeId,
            pretos: pretosIds,
            azuis: azuisIds,
            vermelhos: vermelhosIds
          }
        }
      );

      console.log(`\n   🟢 Verde: ${verdeNome}`);
      console.log(`   ⚫ Pretos: 2`);
      console.log(`   🔵 Azuis: 4`);
      console.log(`   🔴 Vermelhos: 8`);
      console.log(`\n   ✅ Rodada #1 iniciada com sucesso!`);

    } else {
      console.log(`   ❌ Erro: Esperado 15 usuários, mas encontrado ${todosUsuarios.length}`);
    }

    // 8. RESUMO FINAL
    console.log(`\n${colors.green}${colors.bright}✅ RESET COMPLETO!${colors.reset}`);
    console.log(`\n${colors.yellow}📋 CREDENCIAIS DE ACESSO:${colors.reset}`);
    console.log(`   👑 Admin: admin@girosolidario.com / 123456`);
    console.log(`   👤 Usuários: joao@email.com, maria@email.com, etc. / 123456`);
    console.log(`\n${colors.cyan}📊 ESTATÍSTICAS:${colors.reset}`);
    console.log(`   👥 Usuários: 15`);
    console.log(`   🎯 Rodadas: 1 (em andamento)`);
    console.log(`   🟢 Verde sorteado: ${verdeNome}`);

  } catch (error) {
    console.error(`${colors.red}❌ ERRO:${colors.reset}`, error.message);
    console.error(error.stack);
  } finally {
    await mongoose.connection.close();
    console.log(`\n${colors.yellow}📡 Conexão com MongoDB fechada${colors.reset}`);
  }
}

// Executar
resetarECriarUsuarios();