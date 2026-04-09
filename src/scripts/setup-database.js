const mongoose = require('mongoose');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

// Cores para console
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m'
};

class DatabaseSetup {
  constructor() {
    this.conn = null;
    this.db = null;
  }

  async connect() {
    console.log(`${colors.cyan}📦 Conectando ao MongoDB...${colors.reset}`);
    
    try {
      // Versão atualizada - sem as opções obsoletas
      this.conn = await mongoose.connect(process.env.MONGODB_URI);
      
      this.db = this.conn.connection.db;
      
      console.log(`${colors.green}✅ Conectado ao MongoDB com sucesso!${colors.reset}`);
      console.log(`   Host: ${this.conn.connection.host}`);
      console.log(`   Database: ${this.conn.connection.name}\n`);
      
      return true;
    } catch (error) {
      console.log(`${colors.red}❌ Erro ao conectar: ${error.message}${colors.reset}`);
      console.log(`${colors.yellow}💡 Dica: Verifique se o MongoDB está rodando:${colors.reset}`);
      console.log(`   brew services start mongodb-community@5.0`);
      return false;
    }
  }

  async criarCollections() {
    console.log(`${colors.cyan}📁 Criando collections...${colors.reset}`);
    
    const collections = [
      {
        name: 'users',
        validator: {
          $jsonSchema: {
            bsonType: 'object',
            required: ['nome', 'email', 'cpf', 'senha'],
            properties: {
              nome: { bsonType: 'string' },
              email: { bsonType: 'string' },
              cpf: { bsonType: 'string' },
              status: { enum: ['ativo', 'inativo', 'bloqueado'] }
            }
          }
        }
      },
      {
        name: 'rodadas',
        validator: {
          $jsonSchema: {
            bsonType: 'object',
            required: ['numero', 'nome', 'status'],
            properties: {
              numero: { bsonType: 'int' },
              status: { enum: ['aguardando', 'em_andamento', 'concluida', 'cancelada'] }
            }
          }
        }
      },
      {
        name: 'transacoes',
        validator: {
          $jsonSchema: {
            bsonType: 'object',
            required: ['tipo', 'pagador', 'recebedor', 'valor', 'status'],
            properties: {
              tipo: { enum: ['deposito', 'recebimento', 'estorno'] },
              status: { enum: ['pendente', 'confirmado', 'cancelado'] }
            }
          }
        }
      },
      {
        name: 'notificacoes'
      },
      {
        name: 'logs'
      },
      {
        name: 'configuracoes'
      }
    ];

    const existingCollections = await this.db.listCollections().toArray();
    const existingNames = existingCollections.map(c => c.name);

    for (const col of collections) {
      if (!existingNames.includes(col.name)) {
        try {
          if (col.validator) {
            await this.db.createCollection(col.name, {
              validator: col.validator
            });
          } else {
            await this.db.createCollection(col.name);
          }
          console.log(`${colors.green}  ✅ Criada: ${col.name}${colors.reset}`);
        } catch (error) {
          console.log(`${colors.red}  ❌ Erro ao criar ${col.name}: ${error.message}${colors.reset}`);
        }
      } else {
        console.log(`${colors.yellow}  ⏭️  Já existe: ${col.name}${colors.reset}`);
      }
    }
    
    console.log('');
  }

  async criarIndices() {
    console.log(`${colors.cyan}🔍 Criando índices...${colors.reset}`);

    const indices = [
      // Users
      {
        collection: 'users',
        indices: [
          { spec: { email: 1 }, options: { unique: true } },
          { spec: { cpf: 1 }, options: { unique: true } },
          { spec: { status: 1 } },
          { spec: { createdAt: -1 } }
        ]
      },
      // Rodadas
      {
        collection: 'rodadas',
        indices: [
          { spec: { numero: 1 }, options: { unique: true } },
          { spec: { status: 1 } },
          { spec: { createdAt: -1 } },
          { spec: { 'participantes.usuario': 1 } }
        ]
      },
      // Transacoes
      {
        collection: 'transacoes',
        indices: [
          { spec: { pagador: 1, status: 1 } },
          { spec: { recebedor: 1, status: 1 } },
          { spec: { rodada: 1 } },
          { spec: { createdAt: -1 } },
          { spec: { status: 1, createdAt: -1 } }
        ]
      },
      // Notificacoes
      {
        collection: 'notificacoes',
        indices: [
          { spec: { usuario: 1 } },
          { spec: { lida: 1 } },
          { spec: { createdAt: -1 } }
        ]
      }
    ];

    for (const idx of indices) {
      const collection = this.db.collection(idx.collection);
      
      for (const index of idx.indices) {
        try {
          await collection.createIndex(index.spec, index.options || {});
          console.log(`${colors.green}  ✅ Índice criado em ${idx.collection}: ${JSON.stringify(index.spec)}${colors.reset}`);
        } catch (error) {
          console.log(`${colors.yellow}  ⏭️  Índice já existe em ${idx.collection}: ${JSON.stringify(index.spec)}${colors.reset}`);
        }
      }
    }
    
    console.log('');
  }

  async criarConfiguracoesIniciais() {
    console.log(`${colors.cyan}⚙️  Criando configurações iniciais...${colors.reset}`);

    const configuracoes = [
      {
        chave: 'sistema',
        valor: {
          nome: 'Giro Premiado',
          versao: '1.0.0',
          valorDeposito: 125,
          valorRecebimento: 1000,
          totalParticipantesPorRodada: 15,
          tempoEstimadoDias: 4
        }
      },
      {
        chave: 'pix',
        valor: {
          tiposChave: ['cpf', 'email', 'telefone', 'aleatoria'],
          tempoConfirmacao: 24 // horas
        }
      },
      {
        chave: 'notificacoes',
        valor: {
          emailAtivo: true,
          whatsappAtivo: false,
          pushAtivo: true
        }
      }
    ];

    const configCollection = this.db.collection('configuracoes');

    for (const config of configuracoes) {
      const exists = await configCollection.findOne({ chave: config.chave });
      
      if (!exists) {
        await configCollection.insertOne({
          ...config,
          createdAt: new Date(),
          updatedAt: new Date()
        });
        console.log(`${colors.green}  ✅ Configuração criada: ${config.chave}${colors.reset}`);
      } else {
        console.log(`${colors.yellow}  ⏭️  Configuração já existe: ${config.chave}${colors.reset}`);
      }
    }
    
    console.log('');
  }

  async criarUsuarioAdmin() {
    console.log(`${colors.cyan}👤 Verificando usuário admin...${colors.reset}`);

    try {
      const bcrypt = require('bcryptjs');
      const users = this.db.collection('users');

      const adminExists = await users.findOne({ email: 'admin@girosolidario.com' });

      if (!adminExists) {
        const salt = await bcrypt.genSalt(10);
        const senhaHash = await bcrypt.hash('admin123', salt);

        const admin = {
          nome: 'Administrador',
          email: 'admin@girosolidario.com',
          telefone: '11999999999',
          cpf: '00000000000',
          chavePix: 'admin@girosolidario.com',
          tipoChavePix: 'email',
          senha: senhaHash,
          role: 'admin',
          status: 'ativo',
          saldo: 0,
          totalGanho: 0,
          totalInvestido: 0,
          createdAt: new Date(),
          updatedAt: new Date()
        };

        await users.insertOne(admin);
        console.log(`${colors.green}  ✅ Usuário admin criado!${colors.reset}`);
        console.log(`     Email: admin@girosolidario.com`);
        console.log(`     Senha: admin123`);
      } else {
        console.log(`${colors.yellow}  ⏭️  Usuário admin já existe${colors.reset}`);
      }
    } catch (error) {
      console.log(`${colors.red}  ❌ Erro ao criar admin: ${error.message}${colors.reset}`);
    }
    
    console.log('');
  }

  async criarRodadaExemplo() {
    console.log(`${colors.cyan}🎲 Criando rodada de exemplo...${colors.reset}`);

    try {
      const rodadas = this.db.collection('rodadas');
      const rodadaExists = await rodadas.findOne({ numero: 1 });

      if (!rodadaExists) {
        const rodada = {
          numero: 1,
          nome: 'Rodada #1 (Exemplo)',
          status: 'aguardando',
          participantes: [],
          totalDepositosConfirmados: 0,
          todosDepositaram: false,
          historicoMovimentacoes: [],
          createdAt: new Date(),
          updatedAt: new Date()
        };

        await rodadas.insertOne(rodada);
        console.log(`${colors.green}  ✅ Rodada de exemplo criada!${colors.reset}`);
      } else {
        console.log(`${colors.yellow}  ⏭️  Rodada de exemplo já existe${colors.reset}`);
      }
    } catch (error) {
      console.log(`${colors.red}  ❌ Erro ao criar rodada: ${error.message}${colors.reset}`);
    }
    
    console.log('');
  }

  async mostrarEstatisticas() {
    console.log(`${colors.cyan}📊 Estatísticas do banco:${colors.reset}`);

    const collections = await this.db.listCollections().toArray();
    
    for (const col of collections) {
      const count = await this.db.collection(col.name).countDocuments();
      console.log(`   ${col.name}: ${colors.bright}${count}${colors.reset} documentos`);
    }
    
    console.log('');
  }

  async run() {
    console.log(`${colors.magenta}${colors.bright}🚀 INICIANDO SETUP DO BANCO DE DADOS${colors.reset}\n`);

    // Conectar
    const connected = await this.connect();
    if (!connected) {
      console.log(`${colors.red}❌ Setup interrompido${colors.reset}`);
      console.log(`${colors.yellow}💡 Execute primeiro: brew services start mongodb-community@5.0${colors.reset}`);
      process.exit(1);
    }

    // Executar etapas
    await this.criarCollections();
    await this.criarIndices();
    await this.criarConfiguracoesIniciais();
    await this.criarUsuarioAdmin();
    await this.criarRodadaExemplo();
    await this.mostrarEstatisticas();

    console.log(`${colors.green}${colors.bright}✅ SETUP COMPLETO COM SUCESSO!${colors.reset}\n`);

    // Fechar conexão
    await mongoose.connection.close();
    console.log(`${colors.yellow}📡 Conexão fechada${colors.reset}`);
  }
}

// Executar setup
const setup = new DatabaseSetup();
setup.run().catch(error => {
  console.error(`${colors.red}❌ Erro fatal: ${error}${colors.reset}`);
  process.exit(1);
});
