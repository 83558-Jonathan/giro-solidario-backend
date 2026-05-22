const User = require('../models/User')
const Rodada = require('../models/Rodada')
const Transacao = require('../models/Transacao')
const nodemailer = require('nodemailer')

const getFrontendUrl = () => {
  const url = process.env.FRONTEND_URL || 'https://giropremiados.com.br'
  return url.replace(/\/$/, '')
}

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  timeout: 10000,
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 10000,
  debug: true,
  logger: true
})

const emailCooldownCache = new Map()
async function testarConexaoSMTP () {
  try {
    await transporter.verify()
    console.log('✅ SMTP configurado corretamente')
  } catch (error) {
    console.error('❌ Erro na conexão SMTP:', error.message)
  }
}
testarConexaoSMTP()

function podeEnviarEmail (usuarioId, rodadaId) {
  const key = `${usuarioId}_${rodadaId}`
  const ultimoEnvio = emailCooldownCache.get(key)
  if (!ultimoEnvio) return true
  const horasDesdeUltimo = (Date.now() - ultimoEnvio) / (1000 * 60 * 60)
  return horasDesdeUltimo >= 24
}
function registrarEnvio (usuarioId, rodadaId) {
  const key = `${usuarioId}_${rodadaId}`
  emailCooldownCache.set(key, Date.now())
  setTimeout(() => emailCooldownCache.delete(key), 24 * 60 * 60 * 1000)
}

async function enviarEmailPremio (usuario, rodada, valor) {
  /* manter o HTML original, usar getFrontendUrl() */
}
async function enviarEmailCobranca (usuario, rodada, valor, tipo = 'cobranca') {
  /* manter HTML */
}
async function enviarEmailQrCodePix (
  usuario,
  transacao,
  qrCode,
  qrCodeImage,
  valor,
  rodada
) {
  /* manter HTML */
}

exports.notificarPremioVerde = async (usuarioId, rodadaId, valor = 1000) => {
  try {
    const usuario = await User.findById(usuarioId)
    const rodada = await Rodada.findById(rodadaId)
    if (!usuario || !rodada) throw new Error('Usuário ou rodada não encontrado')
    await enviarEmailPremio(usuario, rodada, valor)
    return true
  } catch (error) {
    console.error('❌ Erro ao notificar verde sobre prêmio:', error)
    return false
  }
}

exports.cobrarUsuario = async (req, res) => {
  try {
    const { usuarioId } = req.params
    const { rodadaId, valor } = req.body
    if (!rodadaId)
      return res.status(400).json({ error: 'rodadaId obrigatório' })
    if (!podeEnviarEmail(usuarioId, rodadaId)) {
      const ultimoEnvio = emailCooldownCache.get(`${usuarioId}_${rodadaId}`)
      const horasRestantes = 24 - (Date.now() - ultimoEnvio) / (1000 * 60 * 60)
      return res
        .status(429)
        .json({
          error: `Aguarde ${Math.ceil(horasRestantes)} horas para novo lembrete`
        })
    }
    const usuario = await User.findById(usuarioId)
    const rodada = await Rodada.findById(rodadaId)
    if (!usuario || !rodada)
      return res.status(404).json({ error: 'Usuário ou rodada não encontrado' })
    await enviarEmailCobranca(usuario, rodada, valor || 150, 'cobranca')
    registrarEnvio(usuarioId, rodadaId)
    res.json({
      success: true,
      message: `Lembrete enviado para ${usuario.nome}`
    })
  } catch (error) {
    console.error('Erro ao cobrar usuário:', error)
    res.status(500).json({ error: error.message })
  }
}

exports.enviarLembrete = async (req, res) => {
  try {
    const { usuarioId } = req.params
    const { rodadaId, valor } = req.body
    if (!rodadaId)
      return res.status(400).json({ error: 'rodadaId obrigatório' })
    if (!podeEnviarEmail(usuarioId, rodadaId)) {
      const ultimoEnvio = emailCooldownCache.get(`${usuarioId}_${rodadaId}`)
      const horasRestantes = 24 - (Date.now() - ultimoEnvio) / (1000 * 60 * 60)
      return res
        .status(429)
        .json({ error: `Aguarde ${Math.ceil(horasRestantes)} horas` })
    }
    const usuario = await User.findById(usuarioId)
    const rodada = await Rodada.findById(rodadaId)
    if (!usuario || !rodada)
      return res.status(404).json({ error: 'Usuário ou rodada não encontrado' })
    await enviarEmailCobranca(usuario, rodada, valor || 150, 'lembrete')
    registrarEnvio(usuarioId, rodadaId)
    res.json({
      success: true,
      message: `Lembrete enviado para ${usuario.nome}`
    })
  } catch (error) {
    console.error('Erro ao enviar lembrete:', error)
    res.status(500).json({ error: error.message })
  }
}

exports.cobrarTodosPendentes = async (req, res) => {
  try {
    const { rodadaId } = req.params
    const rodada = await Rodada.findById(rodadaId)
    if (!rodada) return res.status(404).json({ error: 'Rodada não encontrada' })
    const vermelhosPendentes = rodada.participantes.filter(
      p => p.cor === 'vermelho' && !p.depositoConfirmado
    )
    const resultados = [],
      erros = []
    for (const v of vermelhosPendentes) {
      const usuarioId = v.usuario.toString()
      if (!podeEnviarEmail(usuarioId, rodadaId)) {
        const ultimoEnvio = emailCooldownCache.get(`${usuarioId}_${rodadaId}`)
        const horasRestantes =
          24 - (Date.now() - ultimoEnvio) / (1000 * 60 * 60)
        erros.push({
          usuario: v.nome || v.usuario,
          erro: `Aguardar ${Math.ceil(horasRestantes)}h`
        })
        continue
      }
      try {
        const usuario = await User.findById(v.usuario)
        await enviarEmailCobranca(usuario, rodada, 150, 'lembrete')
        registrarEnvio(usuarioId, rodadaId)
        resultados.push({ usuario: usuario.nome, email: usuario.email })
      } catch (err) {
        erros.push({ usuario: v.nome || v.usuario, erro: err.message })
      }
    }
    res.json({
      success: true,
      message: `Lembretes enviados para ${resultados.length} usuário(s)`,
      data: { enviados: resultados, erros }
    })
  } catch (error) {
    console.error('Erro ao cobrar todos:', error)
    res.status(500).json({ error: error.message })
  }
}

exports.verificarCooldown = async (req, res) => {
  try {
    const { usuarioId, rodadaId } = req.params
    const podeEnviar = podeEnviarEmail(usuarioId, rodadaId)
    let horasRestantes = 0
    if (!podeEnviar) {
      const ultimoEnvio = emailCooldownCache.get(`${usuarioId}_${rodadaId}`)
      if (ultimoEnvio)
        horasRestantes = 24 - (Date.now() - ultimoEnvio) / (1000 * 60 * 60)
    }
    res.json({
      success: true,
      podeEnviar,
      horasRestantes: Math.ceil(horasRestantes)
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
}

exports.notificarAdminNovaSolicitacao = async (usuario, rodada, valor) => {
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@giropremiados.com.br'
  const mailOptions = {
    from: `"Giro Premiado" <${process.env.SMTP_USER}>`,
    to: adminEmail,
    subject: `💰 NOVA SOLICITAÇÃO DE SAQUE - R$ ${valor}`,
    html: `<div>...</div>`
  }
  try {
    await transporter.sendMail(mailOptions)
  } catch (err) {
    console.error('Erro ao notificar admin:', err.message)
  }
}

exports.notificarUsuarioSaqueAprovado = async (usuario, solicitacao) => {
  const frontendUrl = getFrontendUrl()
  const mailOptions = {
    from: `"Giro Premiado" <${process.env.SMTP_USER}>`,
    to: usuario.email,
    subject: `✅ Seu saque foi aprovado!`,
    html: `<div>...</div>`
  }
  try {
    await transporter.sendMail(mailOptions)
  } catch (err) {
    console.error(
      'Erro ao notificar usuário sobre saque aprovado:',
      err.message
    )
  }
}

// NOVA FUNÇÃO (usada no adminController.recusarSaque)
exports.notificarSaqueRecusado = async (usuario, solicitacao, motivo) => {
  const frontendUrl = getFrontendUrl()
  const mailOptions = {
    from: `"Giro Premiado" <${process.env.SMTP_USER}>`,
    to: usuario.email,
    subject: `❌ Seu saque foi recusado`,
    html: `<div style="font-family: Arial, sans-serif; max-width: 600px;">
      <div style="text-align: center; padding: 20px; background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); border-radius: 10px 10px 0 0;">
        <h1 style="color: white;">❌ SAQUE RECUSADO</h1>
      </div>
      <div style="padding: 30px; background-color: #f9fafb;">
        <p>Olá <strong>${usuario.nome}</strong>,</p>
        <p>Sua solicitação de saque no valor de <strong>R$ ${
          solicitacao.valor
        }</strong> foi <strong style="color: #ef4444;">RECUSADA</strong> pelo administrador.</p>
        <div style="background-color: #fee2e2; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <p><strong>Motivo:</strong> ${motivo || 'Não informado'}</p>
        </div>
        <p>O valor permanece em seu saldo de prêmios. Você pode solicitar um novo saque a qualquer momento.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${frontendUrl}/dashboard" style="background-color: #10B981; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: bold;">ACESSAR DASHBOARD</a>
        </div>
      </div>
    </div>`
  }
  try {
    await transporter.sendMail(mailOptions)
  } catch (err) {
    console.error('Erro ao notificar recusa de saque:', err.message)
  }
}

exports.enviarEmailQrCodePix = enviarEmailQrCodePix
