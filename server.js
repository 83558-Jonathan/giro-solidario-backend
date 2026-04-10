const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5001;

// Middleware
const allowedOrigins = [
  'https://giropremiados.com.br',
  'https://www.giropremiados.com.br',
  'http://localhost:3000'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Conectar MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB Conectado'))
  .catch(err => console.error('❌ Erro MongoDB:', err));

// Rotas
app.use('/api/auth', require('./src/routes/auth.routes'));
app.use('/api/users', require('./src/routes/user.routes'));
app.use('/api/rodadas', require('./src/routes/rodada.routes'));
app.use('/api/transacoes', require('./src/routes/transacao.routes'));
app.use('/api/indicacoes', require('./src/routes/indicacao.routes'));
app.use('/api/pix', require('./src/routes/pix.routes'));
app.use('/api/webhook', require('./src/routes/webhook.routes'));

// Rota de teste
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Servidor rodando' });
});

// Rota raiz com documentação
app.get('/', (req, res) => {
  res.json({
    message: 'API Giro Premiado',
    version: '1.0.0',
    endpoints: {
      auth: {
        registrar: 'POST /api/auth/registrar',
        login: 'POST /api/auth/login',
        me: 'GET /api/auth/me',
        forgotPassword: 'POST /api/auth/forgot-password',
        resetPassword: 'POST /api/auth/reset-password'
      },
      users: {
        listar: 'GET /api/users',
        buscar: 'GET /api/users/:id',
        atualizar: 'PUT /api/users/:id',
        indicados: 'GET /api/users/:id/indicados'
      },
      rodadas: {
        listar: 'GET /api/rodadas',
        criar: 'POST /api/rodadas',
        buscar: 'GET /api/rodadas/:id',
        mandala: 'GET /api/rodadas/:id/mandala',
        participar: 'POST /api/rodadas/:id/participantes',
        iniciar: 'POST /api/rodadas/:id/iniciar',
        avancar: 'POST /api/rodadas/:id/avancar'
      },
      transacoes: {
        minhas: 'GET /api/transacoes/minhas',
        estatisticas: 'GET /api/transacoes/estatisticas',
        porRodada: 'GET /api/transacoes/rodada/:rodadaId',
        confirmar: 'POST /api/transacoes/:id/confirmar',
        cancelar: 'POST /api/transacoes/:id/cancelar'
      },
      indicacoes: {
        minhas: 'GET /api/indicacoes/minhas',
        meuIndicador: 'GET /api/indicacoes/meu-indicador',
        permissao: 'GET /api/indicacoes/permissao/:rodadaId',
        gerarLink: 'GET /api/indicacoes/gerar-link',
        verificarRodada: 'GET /api/indicacoes/verificar-rodada'
      },
      pix: {
        criarCobranca: 'POST /api/pix/criar-cobranca',
        verificarStatus: 'GET /api/pix/status/:transacaoId',
        renovarCobranca: 'POST /api/pix/renovar-cobranca'
      },
      webhook: {
        pix: 'POST /api/webhook/pix?webhookSecret=SEU_SECRET'
      }
    }
  });
});

// Middleware de erro 404
app.use((req, res) => {
  res.status(404).json({
    error: 'Rota não encontrada',
    availableEndpoints: [
      '/',
      '/api/health',
      '/api/auth',
      '/api/users',
      '/api/rodadas',
      '/api/transacoes',
      '/api/indicacoes',
      '/api/pix',
      '/api/webhook/pix'
    ]
  });
});

// Middleware de erro global
app.use((err, req, res, next) => {
  console.error('❌ Erro:', err.stack);
  res.status(500).json({
    error: 'Erro interno do servidor',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

app.listen(PORT, () => {
  console.log(`
  🚀 Servidor rodando na porta ${PORT}
  📝 Ambiente: ${process.env.NODE_ENV || 'development'}
  🔗 URL: http://localhost:${PORT}
  `);
});

module.exports = app;