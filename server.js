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
const User = require('./src/models/User')
const jwt = require('jsonwebtoken')
const cron = require('node-cron')
const escapeHtml = require('escape-html')

const {
  removerVermelhosInadimplentes,
  processarTransacoesExpiradas
} = require('./src/controllers/pixController')

const RodadaService = require('./src/services/rodadaService')
const Transacao = require('./src/models/Transacao')
const { abacateV2 } = require('./src/config/abacate')
const {
  processarPagamentoComControle
} = require('./src/controllers/pixController')
const expiraPixJob = require('./src/jobs/expiraPix')

// NOVOS SERVIÇOS
const pushService = require('./src/services/pushService')
const activityService = require('./src/services/activityService')
const notificationService = require('./src/services/notificationService')

// ===========================================
// JOBS E CRON
// ===========================================

// Limpeza de vermelhos inadimplentes (1h)
cron.schedule('0 * * * *', () => {
  console.log(
    '⏰ [CRON-HORARIO] Executando limpeza de vermelhos inadimplentes...'
  )
  removerVermelhosInadimplentes().catch(err =>
    console.error('Erro na limpeza horária:', err)
  )
})

// NOVO: Re-engagement — usuários inativos há 3+ dias
cron.schedule('0 10 * * *', async () => {
  try {
    console.log('⏰ [CRON-REENGAGE] Buscando usuários inativos...')
    const tresDiasAtras = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)

    const inativos = await User.find({
      ultimoAcesso: { $lt: tresDiasAtras },
      aguardandoVermelho: false
    })
      .select('_id nome email')
      .limit(500)

    if (!inativos.length) {
      console.log('   Nenhum usuário inativo encontrado')
      return
    }

    let enviados = 0
    for (const u of inativos) {
      const primeiroNome = u.nome?.split(' ')[0] || 'amigo'
      const payload = pushService.templates.reEngajamento(primeiroNome)
      const r = await pushService.enviarParaUsuario(u._id, payload)
      enviados += r.enviados
    }
    console.log(`   ${enviados} push de re-engajamento enviados`)
  } catch (err) {
    console.error('[CRON-REENGAGE] Erro:', err.message)
  }
})

// NOVO: Rodada quase completa — a cada 1 minuto, dispara push pra fila
let pushRodadaQuaseCompleta = new Map() // rodadaId → timestamp do último envio
cron.schedule('* * * * *', async () => {
  try {
    // Busca rodadas com 7/8 vermelhos que NÃO avisamos nos últimos 10 min
    const dezMinAtras = Date.now() - 10 * 60 * 1000
    const rodadas = await Rodada.find({
      status: { $in: ['em_andamento', 'aguardando'] }
    }).select('_id nome participantes')

    for (const r of rodadas) {
      const vermelhos = r.participantes.filter(p => p.cor === 'vermelho')
      const pendentes = vermelhos.filter(p => !p.depositoConfirmado)
      // Só dispara se falta só 1
      if (vermelhos.length === 7 && pendentes.length === 1) {
        const ultimoAviso = pushRodadaQuaseCompleta.get(String(r._id))
        if (ultimoAviso && ultimoAviso > dezMinAtras) continue

        pushRodadaQuaseCompleta.set(String(r._id), Date.now())

        // Pega quem está na fila
        const fila = await User.find({ aguardandoVermelho: true }).select('_id')
        if (fila.length) {
          const payload = pushService.templates.rodadaQuaseCompleta(
            r.nome,
            7,
            8
          )
          const ids = fila.map(u => u._id)
          const res = await pushService.enviarParaUsuarios(ids, payload)
          console.log(
            `⚡ [CRON-QUASE] ${r.nome} está 7/8 — ${res.enviados} push enviados para fila`
          )
        }
      } else {
        // Limpa cache se não está mais em 7/8
        pushRodadaQuaseCompleta.delete(String(r._id))
      }
    }
  } catch (err) {
    console.error('[CRON-QUASE] Erro:', err.message)
  }
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

// Job periódico para verificar transações pendentes (V2 - fallback)
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
        const response = await abacateV2.get('/v2/transparents/check', {
          params: { id: transacao.cobrancaId }
        })
        const statusApi =
          response.data?.data?.status?.toUpperCase?.() ||
          response.data?.data?.status

        if (statusApi === 'PAID') {
          console.log(
            `[JOB-PIX] Pagamento confirmado para transação ${transacao._id}`
          )
          await processarPagamentoComControle(
            transacao._id.toString(),
            'job-periodico'
          )
        } else if (statusApi === 'EXPIRED' || statusApi === 'CANCELLED') {
          console.log(`[JOB-PIX] ⏰ Transação ${transacao._id} ${statusApi}`)
          await Transacao.updateOne(
            { _id: transacao._id, status: 'pendente' },
            { $set: { status: 'cancelada_expirada' } }
          )
        }
      } catch (err) {
        if (err.response?.status === 400) {
          console.warn(
            `[JOB-PIX] Transação ${transacao._id} não encontrada na AbacatePay — marcando como cancelada`
          )
          await Transacao.updateOne(
            { _id: transacao._id, status: 'pendente' },
            { $set: { status: 'cancelada_expirada' } }
          )
        } else if (err.response?.status === 401) {
          console.error(
            '[JOB-PIX] ❌ Chave de API V2 inválida. Verifique ABACATE_API_KEY_V2.'
          )
        } else {
          console.error(
            `[JOB-PIX] Erro ao verificar transação ${transacao._id}:`,
            err.response?.data?.error || err.message
          )
        }
      }
    }
  } catch (error) {
    console.error('[JOB-PIX] Erro no job de verificação periódica:', error)
  }
}, 30000)

// ===========================================
// TRUST PROXY
// ===========================================
app.set('trust proxy', 'loopback')

const getRealIp = req => {
  const forwarded = req.headers['x-forwarded-for']
  if (forwarded) return forwarded.split(',')[0].trim()
  return req.ip || req.connection.remoteAddress
}

// ===========================================
// CORS
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
// PARSERS DE BODY (com rawBody para webhook HMAC)
// ===========================================
app.use(
  express.json({
    limit: '10mb',
    verify: (req, res, buf) => {
      req.rawBody = buf
    }
  })
)
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// ===========================================
// MIDDLEWARE DE LOG
// ===========================================
if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    const logObj = {
      method: req.method,
      path: req.path,
      ip: getRealIp(req),
      hasBody: !!(req.body && Object.keys(req.body).length > 0),
      contentType: req.headers['content-type']
    }
    if (req.method === 'OPTIONS') {
      console.log(`🔍 [OPTIONS] ${req.path} - IP: ${logObj.ip}`)
    } else {
      console.log(
        `📥 [${req.method}] ${req.path} - IP: ${logObj.ip} | hasBody: ${logObj.hasBody} | Content-Type: ${logObj.contentType}`
      )
    }
    next()
  })
}

// ===========================================
// SEGURANÇA
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
// SANITIZAÇÃO
// ===========================================
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

app.use((req, res, next) => {
  const allowedMethods = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
  if (!allowedMethods.includes(req.method)) {
    return res.status(405).send('Method Not Allowed')
  }
  next()
})

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
// RATE LIMITING
// ===========================================
const globalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 1500,
  message: {
    success: false,
    error: 'Muitas requisições. Tente novamente mais tarde.'
  },
  standardHeaders: true,
  legacyHeaders: false
})

const loginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 300,
  skipSuccessfulRequests: true,
  message: {
    success: false,
    error: 'Muitas tentativas de login. Tente novamente em 5 minutos.'
  }
})

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 300,
  message: {
    success: false,
    error: 'Muitas tentativas de registro. Tente novamente em 1 hora.'
  }
})

const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 150,
  message: {
    success: false,
    error: 'Muitas solicitações. Tente novamente em 1 hora.'
  }
})

const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 600,
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
  max: 90,
  message: { error: 'Muitas requisições ao histórico. Aguarde um momento.' }
})

const mandalaLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 90,
  message: { error: 'Muitas requisições à mandala. Aguarde um momento.' }
})

const rodadasListLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 60,
  message: { error: 'Muitas requisições. Aguarde um pouco.' }
})

const usersListLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 60,
  message: { error: 'Muitas requisições. Aguarde um pouco.' }
})

const saqueLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { error: 'Muitas solicitações de saque. Tente mais tarde.' }
})

const jogarNovamenteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 9,
  message: { error: 'Muitas tentativas de reentrada. Aguarde.' }
})

app.use('/api/', globalLimiter)
app.use('/api/auth/login', loginLimiter)
app.use('/api/auth/registrar', registerLimiter)
app.use('/api/auth/forgot-password', forgotPasswordLimiter)
app.use('/api/webhook/', webhookLimiter)
app.use('/api/rodadas', rodadasListLimiter)
app.use('/api/users', usersListLimiter)
app.use('/api/rodadas/:rodadaId/sacar-premio', saqueLimiter)
app.use('/api/rodadas/jogar-novamente', jogarNovamenteLimiter)

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
    console.log('MongoDB Conectado')

    // Inicializar serviços que precisam de io (feito depois do socket.io)
    // (o socket.io é inicializado mais abaixo, e os serviços recebem io lá)

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
// SOCKET.IO
// ===========================================
const io = socketIo(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true
  }
})

// Injeta io nos serviços e controllers
const pixController = require('./src/controllers/pixController')
pixController.initializeIo(io)
RodadaService.initializeIo(io)
activityService.setIo(io)
notificationService.setIo(io)

// Inicializa pushService
pushService.inicializar()

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
    const usuario = await User.findById(decoded.id).select('id nome email role')
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

const socketRateLimit = new Map()

io.on('connection', socket => {
  if (!socket.usuario) {
    console.log(`⚠️ Socket sem autenticação (${socket.id}) – desconectando`)
    if (socket.connected) socket.disconnect(true)
    return
  }

  console.log(`🟢 Usuário conectado: ${socket.usuario.nome} (${socket.id})`)

  // Entra automaticamente na sala pessoal (pra notificações dirigidas)
  socket.join(`user-${socket.usuario.id}`)

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

// NOVAS ROTAS
app.use('/api/push', require('./src/routes/push.routes'))
app.use('/api/notificacoes', require('./src/routes/notificacao.routes'))
app.use('/api/activity', require('./src/routes/activity.routes'))
app.use('/api/onboarding', require('./src/routes/onboarding.routes'))

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
    security: { rateLimit: 'Ativo (por IP real)', helmet: 'Ativo' },
    endpoints: {}
  })
})

// 404
app.use((req, res) => {
  res
    .status(404)
    .json({ success: false, error: 'Página ou recurso não encontrado.' })
})

// Error handler global
app.use((err, req, res, next) => {
  console.error('❌ ERRO GLOBAL:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: getRealIp(req)
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
  if (err.name === 'ValidationError') {
    const primeiro = Object.values(err.errors)[0]
    return res.status(400).json({
      success: false,
      error: `O campo "${primeiro?.path || 'campo'}" está inválido.`
    })
  }
  if (err.name === 'CastError') {
    return res.status(400).json({
      success: false,
      error: 'Um dos dados enviados está em formato inválido.'
    })
  }

  const errorMsg =
    process.env.NODE_ENV === 'development'
      ? err.message
      : 'Algo deu errado. Tente novamente em alguns instantes.'
  res.status(500).json({ success: false, error: errorMsg })
})

server.listen(PORT, () => {
  console.log(`
🚀 Servidor rodando na porta ${PORT}
📍 Ambiente: ${process.env.NODE_ENV || 'development'}
🔗 URL: http://localhost:${PORT}
💬 WebSocket (chat) ativo
🔔 Push Notification ativo
`)
})

module.exports = { app, server, io }
