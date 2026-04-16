const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const compression = require('compression');
const timeout = require('connect-timeout');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5001;

// ===========================================
// CONFIGURAÇÕES DE SEGURANÇA
// ===========================================

// 1. Helmet - Proteção de headers HTTP
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));

// 2. Compressão para respostas
app.use(compression());

// 3. Timeout para evitar ataques de slowloris
app.use(timeout('30s'));
app.use((req, res, next) => {
  if (!req.timedout) next();
});

// 4. Remover header X-Powered-By
app.use((req, res, next) => {
  res.removeHeader('X-Powered-By');
  next();
});

// ===========================================
// RATE LIMITING
// ===========================================

// Rate limit geral para API
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 200, // limite de 200 requisições por IP
  message: { success: false, error: 'Muitas requisições. Tente novamente mais tarde.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limit específico para login (mais restrito)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 5, // apenas 5 tentativas por IP
  skipSuccessfulRequests: true,
  message: { success: false, error: 'Muitas tentativas de login. Tente novamente em 15 minutos.' },
});

// Rate limit para registro
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 3, // apenas 3 registros por IP
  message: { success: false, error: 'Muitas tentativas de registro. Tente novamente em 1 hora.' },
});

// Rate limit para recuperação de senha
const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 3, // apenas 3 solicitações por IP
  message: { success: false, error: 'Muitas solicitações. Tente novamente em 1 hora.' },
});

// Rate limit para webhook (mais generoso)
const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 30, // 30 requisições por minuto (webhook pode enviar várias)
  skip: (req) => {
    const trustedIps = process.env.TRUSTED_IPS ? process.env.TRUSTED_IPS.split(',') : [];
    return trustedIps.includes(req.ip);
  }
});

// ===========================================
// SANITIZAÇÃO (CORRIGIDA)
// ===========================================

// 5. MongoSanitize - Previne NoSQL injection (configuração corrigida)
app.use(mongoSanitize({
  replaceWith: '_',
  onSanitize: ({ req, key }) => {
    console.warn(`⚠️ [Security] Tentativa de NoSQL injection detectada no campo: ${key}`);
  }
}));

// 6. XSS-Clean - Previne cross-site scripting
app.use(xss());

// ===========================================
// CORS CONFIGURAÇÃO CORRIGIDA
// ===========================================

const allowedOrigins = [
  'https://giropremiados.com.br',
  'https://www.giropremiados.com.br',
  'http://localhost:3000',
  'http://localhost:5001',
  'https://api.giropremiados.com.br'
];

app.use(cors({
  origin: function (origin, callback) {
    // Permitir requisições sem origin (como mobile apps ou Postman)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.log(`❌ CORS bloqueado para origem: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
}));

// Adicionar middleware para OPTIONS (preflight)
app.options('*', cors());

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ===========================================
// APLICAR RATE LIMITERS NAS ROTAS
// ===========================================

app.use('/api/', globalLimiter);
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth/registrar', registerLimiter);
app.use('/api/auth/forgot-password', forgotPasswordLimiter);
app.use('/api/webhook/', webhookLimiter);

// ===========================================
// CONEXÃO MONGODB
// ===========================================

mongoose.connect(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
  family: 4,
  maxPoolSize: 10,
  minPoolSize: 2,
})
  .then(() => console.log('✅ MongoDB Conectado'))
  .catch(err => console.error('❌ Erro MongoDB:', err));

// ===========================================
// ROTAS
// ===========================================

app.use('/api/auth', require('./src/routes/auth.routes'));
app.use('/api/users', require('./src/routes/user.routes'));
app.use('/api/rodadas', require('./src/routes/rodada.routes'));
app.use('/api/transacoes', require('./src/routes/transacao.routes'));
app.use('/api/indicacoes', require('./src/routes/indicacao.routes'));
app.use('/api/pix', require('./src/routes/pix.routes'));
app.use('/api/webhook', require('./src/routes/webhook.routes'));
app.use('/api/email', require('./src/routes/email.routes'));

// Rota de teste
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Servidor rodando', timestamp: new Date().toISOString() });
});

// Rota raiz
app.get('/', (req, res) => {
  res.json({
    message: 'API Giro Premiado',
    version: '1.0.0',
    security: {
      rateLimit: 'Ativo',
      helmet: 'Ativo',
      sanitization: 'Ativo',
      xss: 'Ativo'
    },
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

// ===========================================
// MIDDLEWARE DE ERRO 404
// ===========================================
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

// ===========================================
// MIDDLEWARE DE ERRO GLOBAL
// ===========================================
app.use((err, req, res, next) => {
  console.error('❌ Erro:', err.stack);

  if (err.timeout) {
    return res.status(503).json({ error: 'Tempo limite da requisição excedido' });
  }

  if (err.code === 'ERR_RATE_LIMIT') {
    return res.status(429).json({ error: 'Muitas requisições. Tente novamente mais tarde.' });
  }

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
  🔒 Segurança: Helmet, RateLimit, Sanitize, XSS
  `);
});

module.exports = app;