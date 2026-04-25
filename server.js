const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const timeout = require('connect-timeout');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5001;
const criarAdmin = require('./src/scripts/seedAdmin');

// ===========================================
// IMPORTAR SERVICES
// ===========================================
const RodadaService = require('./src/services/rodadaService');

// ===========================================
// TRUST PROXY (para obter IP real do cliente via Cloudflare)
// ===========================================
app.set('trust proxy', true);

// ===========================================
// FUNÇÃO AUXILIAR PARA OBTER IP REAL
// ===========================================
const getRealIp = (req) => {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.connection.remoteAddress;
};

// ===========================================
// ALOCAÇÃO PERIÓDICA DA FILA DE ESPERA
// ===========================================

// Executar a cada 30 segundos para garantir que a fila seja processada
setInterval(async () => {
  try {
    console.log(`\n[CRON] Verificando e alocando fila de espera...`);
    await RodadaService.alocarFilaEmTodasRodadas();
  } catch (error) {
    console.error('[CRON] Erro na alocação periódica da fila:', error.message);
  }
}, 30000); // 30 segundos

// ===========================================
// CONFIGURACOES DE SEGURANCA
// ===========================================

// 1. Helmet - Protecao de headers HTTP
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

// 2. Compressao para respostas
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

// 5. Middleware para log do IP (debug - opcional)
app.use((req, res, next) => {
  console.log(`[${req.method}] ${req.path} - IP: ${getRealIp(req)}`);
  next();
});

// ===========================================
// RATE LIMITING AUMENTADO PARA DEV (COM IP REAL)
// ===========================================

// Rate limit geral para API - AUMENTADO para 500
const globalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 500, // 500 requisicoes por minuto por IP (antes 300)
  keyGenerator: getRealIp,
  message: { success: false, error: 'Muitas requisicoes. Tente novamente mais tarde.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limit especifico para login - AUMENTADO para 100
const loginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutos
  max: 100, // 100 tentativas por IP em 5 minutos (antes 20)
  keyGenerator: getRealIp,
  skipSuccessfulRequests: true,
  message: { success: false, error: 'Muitas tentativas de login. Tente novamente em 5 minutos.' },
});

// Rate limit para registro - AUMENTADO para 100
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 100, // 100 registros por IP por hora (antes 20)
  keyGenerator: getRealIp,
  message: { success: false, error: 'Muitas tentativas de registro. Tente novamente em 1 hora.' },
});

// Rate limit para recuperacao de senha - AUMENTADO para 50
const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 50, // 50 solicitacoes por IP por hora (antes 10)
  keyGenerator: getRealIp,
  message: { success: false, error: 'Muitas solicitacoes. Tente novamente em 1 hora.' },
});

// Rate limit para webhook - AUMENTADO para 200
const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 200, // 200 requisicoes por minuto (antes 60)
  keyGenerator: getRealIp,
  skip: (req) => {
    const trustedIps = process.env.TRUSTED_IPS ? process.env.TRUSTED_IPS.split(',') : [];
    return trustedIps.includes(getRealIp(req));
  }
});

// ===========================================
// MIDDLEWARE PADRAO
// ===========================================

// CORS - mantido
const allowedOrigins = [
  'https://giropremiados.com.br',
  'https://www.giropremiados.com.br',
  'http://localhost:3000',
  'http://localhost:5001'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.log(`CORS bloqueado para origem: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
}));

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
// CONEXAO MONGODB
// ===========================================

mongoose.connect(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
  family: 4,
  maxPoolSize: 10,
  minPoolSize: 2,
})
  .then(async () => {
    console.log('✅ MongoDB Conectado');
    criarAdmin().catch(err => console.error('Erro ao criar admin:', err));

    // Executar alocação inicial da fila após 5 segundos
    setTimeout(async () => {
      console.log(`\n[STARTUP] Executando alocação inicial da fila...`);
      await RodadaService.alocarFilaEmTodasRodadas();
    }, 5000);
  })
  .catch(err => console.error('Erro MongoDB:', err));

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
app.use('/api/admin', require('./src/routes/admin.routes'));
app.use('/api/solicitacoes', require('./src/routes/solicitacao.routes'));

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
      rateLimit: 'Ativo (por IP real)',
      helmet: 'Ativo'
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
        avancar: 'POST /api/rodadas/:id/avancar',
        forcarAlocacaoFila: 'POST /api/rodadas/admin/forcar-alocacao-fila'
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
    error: 'Rota nao encontrada',
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
  console.error('Erro:', err.stack);

  if (err.timeout) {
    return res.status(503).json({ error: 'Tempo limite da requisicao excedido' });
  }

  if (err.code === 'ERR_RATE_LIMIT') {
    return res.status(429).json({ error: 'Muitas requisicoes. Tente novamente mais tarde.' });
  }

  res.status(500).json({
    error: 'Erro interno do servidor',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

app.listen(PORT, () => {
  console.log(`
  🚀 Servidor rodando na porta ${PORT}
  📍 Ambiente: ${process.env.NODE_ENV || 'development'}
  🔗 URL: http://localhost:${PORT}
  `);
});

module.exports = app;