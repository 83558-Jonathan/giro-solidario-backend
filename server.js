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
const escapeHtml = require('escape-html')

// 🔧 MOVENDO IMPORTAÇÕES PARA O TOPO (evita recarregamento)
const RodadaService = require('./src/services/rodadaService')
const Transacao = require('./src/models/Transacao')
const abacate = require('./src/config/abacate')
const {
  processarPagamentoComControle
} = require('./src/controllers/pixController')
const expiraPixJob = require('./src/jobs/expiraPix')

// ===========================================
// JOBS E CRON
// ===========================================
cron.schedule('0 * * * *', () => {
  console.log(
    '⏰ [CRON-HORARIO] Executando limpeza de vermelhos inadimplentes...'
  )
  removerVermelhosInadimplentes().catch(err =>
    console.error('Erro na limpeza horária:', err)
  )
})

// Alocação periódica da fila (a cada 10s)
setInterval(async () => {
  try {
    console.log(`\n[CRON] Verificando e alocando fila de espera...`)
    await RodadaService.alocarFilaEmTodasRodadas()
  } catch (error) {
    console.error('[CRON] Erro na alocação periódica da fila:', error.message)
  }
}, 10000)

// Job periódico para verificar transações pendentes (fallback)
setInterval(async () => {
  try {
    const transacoesPendentes = await Transacao.find({
      status: 'pendente',
      cobrancaId: { $exists: true, $ne: null },
      createdAt: { $lt: new Date(Date.now() - 10000) }
    }).limit(50)

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
          console.log(`[JOB-PIX] ⏰ Transação ${transacao._id} expirada`)
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
}, 10000)

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
// MIDDLEWARE DE LOG MELHORADO (antes de qualquer processamento)
// ===========================================
if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    const logObj = {
      method: req.method,
      path: req.path,
      ip: getRealIp(req),
      hasBody: !!req.body,
      contentType: req.headers['content-type']
    }
    // Evita poluir o console com OPTIONS
    if (req.method === 'OPTIONS') {
      console.log(`🔍 [OPTIONS] ${req.path} - IP: ${logObj.ip}`)
    } else {
      console.log(
        `📥 [${req.method}] ${req.path} - IP: ${logObj.ip} | hasBody: ${logObj.hasBody} | Content-Type: ${logObj.contentType}`
      )
    }
    next()
  })
} else {
  app.use((req, res, next) => next())
}

// ===========================================
// CONFIGURAÇÕES DE SEGURANÇA (HELMET, COMPRESSION, TIMEOUT)
// ===========================================
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", 'https://api.abacatepay.com']
      }
    },
    frameguard: { action: 'deny' },
    dnsPrefetchControl: { allow: false },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
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

// ===========================================
// CORS (deve vir antes dos parsers para OPTIONS)
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
      console.log(`❌ CORS bloqueado para origem: ${origin}`)
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

// ===========================================
// PARSERS DE BODY (necessários antes de qualquer middleware que use req.body)
// ===========================================
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// ===========================================
// 🛡️ SANITIZAÇÃO MANUAL (agora com verificação segura)
// ===========================================

// 1. Remove operadores $ (NoSQL injection) – seguro para req.body undefined
app.use((req, res, next) => {
  const sanitizeObject = obj => {
    if (!obj || typeof obj !== 'object') return
    for (let key in obj) {
      if (key.startsWith('$')) delete obj[key]
      else if (typeof obj[key] === 'object') sanitizeObject(obj[key])
    }
  }
  if (req.body) sanitizeObject(req.body)
  if (req.query) sanitizeObject(req.query)
  next()
})

// 2. Sanitização de strings específicas (XSS básico)
const sanitizeString = str => {
  if (!str || typeof str !== 'string') return str
  return str.replace(/[<>]/g, '').trim()
}

app.use((req, res, next) => {
  const fieldsToSanitize = [
    'nome',
    'email',
    'telefone',
    'cpf',
    'chavePix',
    'codigoConvite',
    'mensagem',
    'motivo'
  ]
  // Só processa se o body existir (evita erro em OPTIONS)
  if (req.body) {
    for (const field of fieldsToSanitize) {
      if (req.body[field]) req.body[field] = sanitizeString(req.body[field])
    }
  }
  if (req.query) {
    for (const field of fieldsToSanitize) {
      if (req.query[field]) req.query[field] = sanitizeString(req.query[field])
    }
  }
  next()
})

// 3. Proteção contra parameter pollution (objetos muito aninhados)
app.use((req, res, next) => {
  const checkDepth = (obj, depth = 0) => {
    if (depth > 5) throw new Error('Objeto muito aninhado')
    for (let key in obj) {
      if (typeof obj[key] === 'object' && obj[key] !== null)
        checkDepth(obj[key], depth + 1)
    }
  }
  try {
    if (req.body && typeof req.body === 'object') checkDepth(req.body)
    next()
  } catch (err) {
    console.error(
      `❌ Parameter pollution detectado em ${req.path}:`,
      err.message
    )
    return res.status(400).json({ error: 'Requisição malformada' })
  }
})

// 4. Desabilitar métodos HTTP não utilizados
app.use((req, res, next) => {
  const allowedMethods = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
  if (!allowedMethods.includes(req.method)) {
    return res.status(405).send('Method Not Allowed')
  }
  next()
})

// 5. Bloqueio de acesso a arquivos sensíveis
app.use((req, res, next) => {
  if (req.path.match(/\.(env|git|log|sql|bak|config|key|pem)$/)) {
    console.warn(
      `⚠️ Tentativa de acesso a arquivo sensível: ${req.path} - IP: ${getRealIp(
        req
      )}`
    )
    return res.status(403).send('Acesso negado')
  }
  next()
})

// ===========================================
// RATE LIMITING (proteção contra DDoS e brute force)
// ===========================================
const globalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 1500, // triplicado (antes 500)
  message: {
    success: false,
    error: 'Muitas requisições. Tente novamente mais tarde.'
  },
  standardHeaders: true,
  legacyHeaders: false
})

const loginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 300, // triplicado (antes 100)
  skipSuccessfulRequests: true,
  message: {
    success: false,
    error: 'Muitas tentativas de login. Tente novamente em 5 minutos.'
  }
})

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 300, // triplicado (antes 100)
  message: {
    success: false,
    error: 'Muitas tentativas de registro. Tente novamente em 1 hora.'
  }
})

const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 150, // triplicado (antes 50)
  message: {
    success: false,
    error: 'Muitas solicitações. Tente novamente em 1 hora.'
  }
})

const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 600, // triplicado (antes 200)
  message: { success: false, error: 'Muitas requisições para o webhook.' },
  skip: req => {
    const trustedIps = process.env.TRUSTED_IPS
      ? process.env.TRUSTED_IPS.split(',')
      : []
    return trustedIps.includes(getRealIp(req))
  }
})

const chatHistoryLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 90, // triplicado (antes 30)
  message: { error: 'Muitas requisições ao histórico. Aguarde um momento.' }
})

const mandalaLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 90, // triplicado (antes 30)
  message: { error: 'Muitas requisições à mandala. Aguarde um momento.' }
})

const rodadasListLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 60, // triplicado (antes 20)
  message: { error: 'Muitas requisições. Aguarde um pouco.' }
})

const usersListLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 60, // triplicado (antes 20)
  message: { error: 'Muitas requisições. Aguarde um pouco.' }
})

const saqueLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15, // triplicado (antes 5)
  message: { error: 'Muitas solicitações de saque. Tente mais tarde.' }
})

const jogarNovamenteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 9, // triplicado (antes 3)
  message: { error: 'Muitas tentativas de reentrada. Aguarde.' }
})

// Aplicar rate limiters
app.use('/api/', globalLimiter)
app.use('/api/auth/login', loginLimiter)
app.use('/api/auth/registrar', registerLimiter)
app.use('/api/auth/forgot-password', forgotPasswordLimiter)
app.use('/api/webhook/', webhookLimiter)
app.use('/api/rodadas', rodadasListLimiter)
app.use('/api/users', usersListLimiter)
app.use('/api/rodadas/:rodadaId/sacar-premio', saqueLimiter)
app.use('/api/rodadas/jogar-novamente', jogarNovamenteLimiter)

// Log de tentativas de acesso admin
app.use('/api/admin', (req, res, next) => {
  if (req.usuario?.role !== 'admin') {
    console.warn(
      `⚠️ Tentativa de acesso admin por ${getRealIp(req)} - usuário: ${
        req.usuario?.id || 'não autenticado'
      }`
    )
  }
  next()
})

// ===========================================
// CONEXÃO MONGODB
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

    expiraPixJob
    console.log('⏰ Job de expiração PIX agendado')

    setTimeout(async () => {
      try {
        console.log(`\n[STARTUP] Executando alocação inicial da fila...`)
        await RodadaService.alocarFilaEmTodasRodadas()
      } catch (err) {
        console.error('[STARTUP] Erro ao alocar fila:', err.message)
      }
    }, 5000)
  })
  .catch(err => console.error('❌ Erro na conexão MongoDB:', err))

// ===========================================
// SOCKET.IO (CHAT) – CORREÇÃO ROBUSTA
// ===========================================
const io = socketIo(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true
  }
})

// Inicializa o io nos controllers/services
const pixController = require('./src/controllers/pixController')
pixController.initializeIo(io)
RodadaService.initializeIo(io)

// Middleware de autenticação – COM TRATAMENTO DE ERRO SEGURO
io.use(async (socket, next) => {
  const token = socket.handshake.auth.token
  if (!token) {
    console.log(
      `❌ Socket rejeitado: token ausente (IP: ${socket.handshake.address})`
    )
    return next(new Error('Autenticação necessária'))
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    const usuario = await require('./src/models/User')
      .findById(decoded.id)
      .select('id nome email role')
    if (!usuario) {
      console.log(
        `❌ Socket rejeitado: usuário não encontrado (ID: ${decoded.id})`
      )
      return next(new Error('Usuário não encontrado'))
    }
    socket.usuario = usuario
    next()
  } catch (err) {
    console.log(`❌ Socket rejeitado: token inválido - ${err.message}`)
    next(new Error('Token inválido'))
  }
})

// Rate limiting por socket (evita flooding)
const socketRateLimit = new Map()

io.on('connection', socket => {
  if (!socket.usuario) {
    console.log(`⚠️ Socket sem autenticação (${socket.id}) – desconectando`)
    if (socket.connected) socket.disconnect(true)
    return
  }

  console.log(`🟢 Usuário conectado: ${socket.usuario.nome} (${socket.id})`)

  socket.on('entrar-sala', async rodadaId => {
    if (!socket.usuario) {
      socket.emit('erro', 'Sessão inválida. Recarregue a página.')
      return
    }
    try {
      if (!mongoose.Types.ObjectId.isValid(rodadaId)) {
        socket.emit('erro', 'ID de rodada inválido')
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

  socket.on('sair-sala', rodadaId => {
    if (!socket.usuario) return
    socket.leave(`rodada-${rodadaId}`)
    console.log(`🔴 ${socket.usuario.nome} saiu da sala da rodada ${rodadaId}`)
  })

  socket.on('nova-mensagem', async data => {
    if (!socket.usuario) {
      socket.emit('erro', 'Sessão inválida. Recarregue a página.')
      return
    }
    try {
      const now = Date.now()
      const last = socketRateLimit.get(socket.id)
      if (last && now - last < 1000) {
        socket.emit('erro', 'Muitas mensagens. Aguarde um pouco.')
        return
      }
      socketRateLimit.set(socket.id, now)

      const { rodadaId, mensagem } = data
      if (!mensagem || mensagem.trim().length === 0) return
      if (mensagem.length > 500) {
        socket.emit('erro', 'Mensagem muito longa (máximo 500 caracteres)')
        return
      }
      if (!mongoose.Types.ObjectId.isValid(rodadaId)) {
        socket.emit('erro', 'ID de rodada inválido')
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

      const mensagemSanitizada = escapeHtml(mensagem.trim())
      const nomeSanitizado = escapeHtml(socket.usuario.nome)

      const novaMsg = new ChatMessage({
        rodadaId,
        usuarioId: socket.usuario.id,
        nome: nomeSanitizado,
        mensagem: mensagemSanitizada,
        tipo: 'usuario',
        createdAt: new Date()
      })
      await novaMsg.save()

      io.to(`rodada-${rodadaId}`).emit('mensagem', {
        _id: novaMsg._id,
        usuarioId: socket.usuario.id,
        nome: nomeSanitizado,
        mensagem: mensagemSanitizada,
        tipo: 'usuario',
        createdAt: novaMsg.createdAt
      })
    } catch (error) {
      console.error('Erro ao enviar mensagem:', error)
      socket.emit('erro', 'Erro ao enviar mensagem')
    }
  })

  socket.on('mensagem-sistema', async data => {
    if (!socket.usuario) {
      socket.emit('erro', 'Sessão inválida. Recarregue a página.')
      return
    }
    const { rodadaId, mensagem, acao } = data
    if (!rodadaId || !mensagem) return
    if (socket.usuario.role !== 'admin') {
      socket.emit(
        'erro',
        'Apenas administradores podem enviar mensagens do sistema'
      )
      return
    }
    if (!mongoose.Types.ObjectId.isValid(rodadaId)) {
      socket.emit('erro', 'ID de rodada inválido')
      return
    }
    try {
      const rodada = await Rodada.findById(rodadaId)
      if (!rodada) {
        socket.emit('erro', 'Rodada não encontrada')
        return
      }
      const mensagemSanitizada = escapeHtml(mensagem.trim())
      const novaMsg = new ChatMessage({
        rodadaId,
        mensagem: mensagemSanitizada,
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
    if (socket.usuario) {
      console.log(
        `🔴 Usuário desconectado: ${socket.usuario.nome} (${socket.id})`
      )
    } else {
      console.log(`🔴 Socket desconectado (sem autenticação): ${socket.id}`)
    }
    socketRateLimit.delete(socket.id)
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

const chatRoutes = require('./src/routes/chat.routes')
app.use('/api/chat', chatHistoryLimiter, chatRoutes)
app.use('/api/rodadas/:rodadaId/mandala', mandalaLimiter)

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
    endpoints: {}
  })
})

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Rota não encontrada' })
})

// Error handler global (melhorado para capturar erros inesperados)
app.use((err, req, res, next) => {
  // Log detalhado do erro
  console.error('❌ ERRO GLOBAL:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: getRealIp(req),
    body: req.body ? JSON.stringify(req.body).substring(0, 200) : undefined,
    headers: req.headers ? { ...req.headers, authorization: '***' } : undefined
  })

  if (err.timeout) {
    return res
      .status(503)
      .json({ error: 'Tempo limite da requisição excedido' })
  }
  if (err.code === 'ERR_RATE_LIMIT') {
    return res
      .status(429)
      .json({ error: 'Muitas requisições. Tente novamente mais tarde.' })
  }
  const errorMsg =
    process.env.NODE_ENV === 'development'
      ? err.message
      : 'Erro interno do servidor'
  res.status(500).json({ error: errorMsg })
})

server.listen(PORT, () => {
  console.log(`
  🚀 Servidor rodando na porta ${PORT}
  📍 Ambiente: ${process.env.NODE_ENV || 'development'}
  🔗 URL: http://localhost:${PORT}
  💬 WebSocket (chat) ativo
  `)
})

module.exports = { app, server, io }
