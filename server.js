const express = require('express')
const http = require('http')
const socketIo = require('socket.io')
const mongoose = require('mongoose')
const cors = require('cors')
const helmet = require('helmet')
const compression = require('compression')
const timeout = require('connect-timeout')
const rateLimit = require('express-rate-limit')
require('dotenv').config()

const app = express()
const server = http.createServer(app)
const PORT = process.env.PORT || 5001
const criarAdmin = require('./src/scripts/seedAdmin')
const ChatMessage = require('./src/models/ChatMessage')
const Rodada = require('./src/models/Rodada')
const jwt = require('jsonwebtoken')
const {
  removerVermelhosInadimplentes,
  processarTransacoesExpiradas
} = require('./src/controllers/pixController')
const cron = require('node-cron')

// Executa a cada 1 minuto (ajuste conforme necessidade)
cron.schedule('* * * * *', () => {
  console.log('⏰ [CRON] Executando job de expiração de PIX...')
  processarTransacoesExpiradas().catch(err =>
    console.error('Erro no job:', err)
  )
})

// Executa diariamente à meia-noite (00:00)
cron.schedule('0 0 * * *', () => {
  console.log(
    '⏰ [CRON-DIARIO] Executando limpeza de vermelhos inadimplentes...'
  )
  removerVermelhosInadimplentes().catch(err =>
    console.error('Erro na limpeza diária:', err)
  )
})

// ===========================================
// ALOCAÇÃO PERIÓDICA DA FILA DE ESPERA
// ===========================================
setInterval(async () => {
  try {
    const RodadaService = require('./src/services/rodadaService')
    console.log(`\n[CRON] Verificando e alocando fila de espera...`)
    await RodadaService.alocarFilaEmTodasRodadas()
  } catch (error) {
    console.error('[CRON] Erro na alocação periódica da fila:', error.message)
  }
}, 10000) // a cada 10 segundos

// ===========================================
// JOB PERIÓDICO: VERIFICAR TRANSAÇÕES PENDENTES (fallback para webhook)
// ===========================================
setInterval(async () => {
  try {
    const Transacao = require('./src/models/Transacao')
    const abacate = require('./src/config/abacate')
    const {
      processarPagamentoComControle
    } = require('./src/controllers/pixController')

    // Buscar transações pendentes que já geraram QR Code
    const transacoesPendentes = await Transacao.find({
      status: 'pendente',
      cobrancaId: { $exists: true, $ne: null },
      // Evitar verificar transações criadas há menos de 10 segundos (evitar sobrecarga)
      createdAt: { $lt: new Date(Date.now() - 10000) }
    }).limit(50) // limite para não sobrecarregar a API do AbacatePay

    if (transacoesPendentes.length === 0) return

    console.log(
      `[JOB-PIX] Verificando ${transacoesPendentes.length} transações pendentes...`
    )

    for (const transacao of transacoesPendentes) {
      try {
        const response = await abacate.get(`/pixQrCode/check`, {
          params: { id: transacao.cobrancaId }
        })
        const statusApi =
          response.data.data?.status?.toUpperCase?.() ||
          response.data.data?.status

        if (
          statusApi === 'PAID' ||
          statusApi === 'COMPLETED' ||
          statusApi === 'CONFIRMED'
        ) {
          console.log(
            `[JOB-PIX] ✅ Pagamento confirmado para transação ${transacao._id}`
          )
          await processarPagamentoComControle(
            transacao._id.toString(),
            'job-periodico'
          )
        } else if (statusApi === 'EXPIRED') {
          console.log(
            `[JOB-PIX] ⏰ Transação ${transacao._id} expirada (será tratada pelo job de expiração)`
          )
          // O job de expiração já irá tratá-la (expiraPix.js)
        }
      } catch (err) {
        console.error(
          `[JOB-PIX] Erro ao verificar transação ${transacao._id}:`,
          err.message
        )
      }
    }
  } catch (error) {
    console.error('[JOB-PIX] Erro no job de verificação periódica:', error)
  }
}, 10000) // a cada 10 segundos

// ===========================================
// TRUST PROXY (IP real via Cloudflare)
// ===========================================
app.set('trust proxy', 'loopback')

const getRealIp = req => {
  const forwarded = req.headers['x-forwarded-for']
  if (forwarded) return forwarded.split(',')[0].trim()
  return req.ip || req.connection.remoteAddress
}

// ===========================================
// CONFIGURAÇÕES DE SEGURANÇA
// ===========================================
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:']
      }
    },
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true }
  })
)
app.use(compression())
app.use(timeout('30s'))
app.use((req, res, next) => {
  if (!req.timedout) next()
})
app.use((req, res, next) => {
  res.removeHeader('X-Powered-By')
  next()
})

// Log opcional
app.use((req, res, next) => {
  console.log(`[${req.method}] ${req.path} - IP: ${getRealIp(req)}`)
  next()
})

// ===========================================
// RATE LIMITING
// ===========================================
const globalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 500,
  message: {
    success: false,
    error: 'Muitas requisições. Tente novamente mais tarde.'
  },
  standardHeaders: true,
  legacyHeaders: false
})

const loginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 100,
  skipSuccessfulRequests: true,
  message: {
    success: false,
    error: 'Muitas tentativas de login. Tente novamente em 5 minutos.'
  }
})

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 100,
  message: {
    success: false,
    error: 'Muitas tentativas de registro. Tente novamente em 1 hora.'
  }
})

const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 50,
  message: {
    success: false,
    error: 'Muitas solicitações. Tente novamente em 1 hora.'
  }
})

const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 200,
  skip: req => {
    const trustedIps = process.env.TRUSTED_IPS
      ? process.env.TRUSTED_IPS.split(',')
      : []
    return trustedIps.includes(getRealIp(req))
  }
  // keyGenerator é opcional, a biblioteca usa req.ip automaticamente
})

// ===========================================
// MIDDLEWARE PADRÃO
// ===========================================
const allowedOrigins = [
  'https://giropremiados.com.br',
  'https://www.giropremiados.com.br',
  'http://localhost:3000',
  'http://localhost:5001'
]
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true)
      if (allowedOrigins.includes(origin)) return callback(null, true)
      console.log(`CORS bloqueado para origem: ${origin}`)
      callback(new Error('Not allowed by CORS'))
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'Accept'
    ]
  })
)
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// Aplicar rate limiters
app.use('/api/', globalLimiter)
app.use('/api/auth/login', loginLimiter)
app.use('/api/auth/registrar', registerLimiter)
app.use('/api/auth/forgot-password', forgotPasswordLimiter)
app.use('/api/webhook/', webhookLimiter)

// ===========================================
// CONEXÃO MONGODB (única)
// ===========================================
mongoose
  .connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    family: 4,
    maxPoolSize: 10,
    minPoolSize: 2
  })
  .then(async () => {
    console.log('✅ MongoDB Conectado')
    await criarAdmin().catch(err => console.error('Erro ao criar admin:', err))

    // Iniciar job de expiração PIX
    require('./src/jobs/expiraPix')
    console.log('⏰ Job de expiração PIX agendado')

    // Alocação inicial da fila
    setTimeout(async () => {
      try {
        const RodadaService = require('./src/services/rodadaService')
        console.log(`\n[STARTUP] Executando alocação inicial da fila...`)
        await RodadaService.alocarFilaEmTodasRodadas()
      } catch (err) {
        console.error('[STARTUP] Erro ao alocar fila:', err.message)
      }
    }, 5000)
  })
  .catch(err => console.error('❌ Erro na conexão MongoDB:', err))

// ===========================================
// SOCKET.IO (CHAT)
// ===========================================
const io = socketIo(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true
  }
})

// INICIALIZA O io NO CONTROLLER PIX (para mensagens automáticas)
const pixController = require('./src/controllers/pixController')
pixController.initializeIo(io)

// INICIALIZA O io NO RODADA SERVICE (para mensagens automáticas)
const RodadaService = require('./src/services/rodadaService')
RodadaService.initializeIo(io)

// Middleware de autenticação para socket
io.use(async (socket, next) => {
  const token = socket.handshake.auth.token
  if (!token) return next(new Error('Autenticação necessária'))

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    const usuario = await require('./src/models/User')
      .findById(decoded.id)
      .select('id nome email')
    if (!usuario) return next(new Error('Usuário não encontrado'))
    socket.usuario = usuario
    next()
  } catch (err) {
    return next(new Error('Token inválido'))
  }
})

io.on('connection', socket => {
  console.log(`🟢 Usuário conectado: ${socket.usuario.nome} (${socket.id})`)

  // Entrar na sala da rodada
  socket.on('entrar-sala', async rodadaId => {
    try {
      const rodada = await Rodada.findById(rodadaId)
      if (!rodada) {
        socket.emit('erro', 'Rodada não encontrada')
        return
      }

      // Verificar se o usuário é participante da rodada
      const isParticipante = rodada.participantes.some(
        p => p.usuario.toString() === socket.usuario.id
      )
      if (!isParticipante) {
        socket.emit('erro', 'Você não tem permissão para entrar neste chat')
        return
      }

      socket.join(`rodada-${rodadaId}`)
      console.log(
        `📌 ${socket.usuario.nome} entrou na sala da rodada ${rodadaId}`
      )
    } catch (error) {
      console.error('Erro ao entrar na sala:', error)
      socket.emit('erro', 'Erro ao carregar o chat')
    }
  })

  // Sair da sala
  socket.on('sair-sala', rodadaId => {
    socket.leave(`rodada-${rodadaId}`)
    console.log(`🔴 ${socket.usuario.nome} saiu da sala da rodada ${rodadaId}`)
  })

  // Receber nova mensagem
  socket.on('nova-mensagem', async data => {
    try {
      const { rodadaId, mensagem } = data

      if (!mensagem || mensagem.trim().length === 0) return
      if (mensagem.length > 500) {
        socket.emit('erro', 'Mensagem muito longa (máximo 500 caracteres)')
        return
      }

      const rodada = await Rodada.findById(rodadaId)
      if (!rodada) {
        socket.emit('erro', 'Rodada não encontrada')
        return
      }
      const isParticipante = rodada.participantes.some(
        p => p.usuario.toString() === socket.usuario.id
      )
      if (!isParticipante) {
        socket.emit('erro', 'Você não tem permissão para enviar mensagens')
        return
      }

      const novaMsg = new ChatMessage({
        rodadaId,
        usuarioId: socket.usuario.id,
        nome: socket.usuario.nome,
        mensagem: mensagem.trim(),
        tipo: 'texto',
        createdAt: new Date()
      })
      await novaMsg.save()

      io.to(`rodada-${rodadaId}`).emit('mensagem', {
        _id: novaMsg._id,
        usuarioId: socket.usuario.id,
        nome: socket.usuario.nome,
        mensagem: mensagem.trim(),
        tipo: 'texto',
        createdAt: novaMsg.createdAt
      })
    } catch (error) {
      console.error('Erro ao enviar mensagem:', error)
      socket.emit('erro', 'Erro ao enviar mensagem')
    }
  })

  socket.on('mensagem-sistema', async data => {
    const { rodadaId, mensagem, acao } = data
    if (!rodadaId || !mensagem) return

    try {
      const rodada = await Rodada.findById(rodadaId)
      if (!rodada) {
        socket.emit('erro', 'Rodada não encontrada')
        return
      }

      const isParticipante = rodada.participantes.some(
        p => p.usuario.toString() === socket.usuario.id
      )
      if (!isParticipante) {
        socket.emit(
          'erro',
          'Você não tem permissão para enviar mensagens do sistema'
        )
        return
      }

      const novaMsg = new ChatMessage({
        rodadaId,
        mensagem: mensagem.trim(),
        tipo: 'sistema',
        acao: acao || null,
        createdAt: new Date()
      })
      await novaMsg.save()

      io.to(`rodada-${rodadaId}`).emit('mensagem', {
        _id: novaMsg._id,
        mensagem: novaMsg.mensagem,
        tipo: 'sistema',
        acao: novaMsg.acao,
        createdAt: novaMsg.createdAt
      })
    } catch (error) {
      console.error('Erro ao enviar mensagem do sistema:', error)
      socket.emit('erro', 'Erro ao enviar mensagem do sistema')
    }
  })

  socket.on('disconnect', () => {
    console.log(
      `🔴 Usuário desconectado: ${socket.usuario.nome} (${socket.id})`
    )
  })
})

// ===========================================
// ROTAS REST
// ===========================================
app.use('/api/auth', require('./src/routes/auth.routes'))
app.use('/api/users', require('./src/routes/user.routes'))
app.use('/api/rodadas', require('./src/routes/rodada.routes'))
app.use('/api/transacoes', require('./src/routes/transacao.routes'))
app.use('/api/indicacoes', require('./src/routes/indicacao.routes'))
app.use('/api/pix', require('./src/routes/pix.routes'))
app.use('/api/webhook', require('./src/routes/webhook.routes'))
app.use('/api/email', require('./src/routes/email.routes'))
app.use('/api/admin', require('./src/routes/admin.routes'))
app.use('/api/solicitacoes', require('./src/routes/solicitacao.routes'))
app.use('/api/chat', require('./src/routes/chat.routes'))

// ===========================================
// ROTA DE TESTE E RAIZ
// ===========================================
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Servidor rodando',
    timestamp: new Date().toISOString()
  })
})

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
  })
})

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Rota nao encontrada' })
})

// Error handler global
app.use((err, req, res, next) => {
  console.error('Erro:', err.stack)
  if (err.timeout)
    return res
      .status(503)
      .json({ error: 'Tempo limite da requisição excedido' })
  if (err.code === 'ERR_RATE_LIMIT')
    return res
      .status(429)
      .json({ error: 'Muitas requisições. Tente novamente mais tarde.' })
  res.status(500).json({
    error: 'Erro interno do servidor',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  })
})

// Inicialização do servidor
server.listen(PORT, () => {
  console.log(`
  🚀 Servidor rodando na porta ${PORT}
  📍 Ambiente: ${process.env.NODE_ENV || 'development'}
  🔗 URL: http://localhost:${PORT}
  💬 WebSocket (chat) ativo
  `)
})

module.exports = { app, server, io }
