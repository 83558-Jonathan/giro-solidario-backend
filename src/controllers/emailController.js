const User = require('../models/User')
const Rodada = require('../models/Rodada')
const Transacao = require('../models/Transacao')
const nodemailer = require('nodemailer')

// ===========================================
// FUNÇÃO AUXILIAR PARA URL DO FRONTEND
// ===========================================
const getFrontendUrl = () => {
  const url = process.env.FRONTEND_URL || 'https://giropremiados.com.br'
  return url.replace(/\/$/, '') // remove barra final
}

// ===========================================
// CONFIGURAÇÃO DO TRANSPORTER SMTP
// ===========================================
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  },
  timeout: 10000,
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 10000,
  debug: true,
  logger: true
})

// Cache para controle de envios (cooldown de 24h)
const emailCooldownCache = new Map()

// Teste inicial de conexão SMTP (apenas log, não bloqueia envios)
async function testarConexaoSMTP () {
  try {
    await transporter.verify()
    console.log('✅ SMTP configurado corretamente')
    return true
  } catch (error) {
    console.error('❌ Erro na conexão SMTP:', error.message)
    return false
  }
}
testarConexaoSMTP()

// ===========================================
// COOLDOWN
// ===========================================
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

// ===========================================
// EMAIL DE PRÊMIO PARA O VERDE
// ===========================================
async function enviarEmailPremio (usuario, rodada, valor) {
  const frontendUrl = getFrontendUrl()
  const mailOptions = {
    from: `"Giro Premiado" <${process.env.SMTP_USER}>`,
    to: usuario.email,
    subject: `🎉 PARABÉNS! Você ganhou R$ ${valor} no Giro Premiado!`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="text-align: center; padding: 20px; background: linear-gradient(135deg, #f59e0b 0%, #ef4444 100%); border-radius: 10px 10px 0 0;">
          <h1 style="color: white; margin: 0;">🏆 Giro Premiado 🏆</h1>
        </div>
        <div style="padding: 30px; background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 0 0 10px 10px;">
          <div style="text-align: center;">
            <div style="font-size: 60px; margin-bottom: 10px;">🎉</div>
            <h2 style="color: #1f2937; margin-top: 0;">PARABÉNS, ${
              usuario.nome
            }!</h2>
          </div>
          <p style="color: #4b5563; line-height: 1.5; font-size: 16px;">
            Você foi o <strong style="color: #10B981;">VERDE</strong> da rodada e ganhou o prêmio máximo!
          </p>
          <div style="background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); padding: 20px; border-radius: 12px; margin: 20px 0; text-align: center;">
            <p style="margin: 0; font-size: 14px; color: #92400e;">💰 VALOR GANHO</p>
            <p style="margin: 5px 0 0; font-size: 36px; font-weight: bold; color: #d97706;">R$ ${valor}</p>
          </div>
          <div style="background-color: #ecfdf5; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #10B981;">
            <p style="margin: 0; color: #065f46; font-size: 14px;">
              <strong>📋 DETALHES DA RODADA:</strong><br/>
              Rodada: ${rodada.nome}<br/>
              Data: ${new Date().toLocaleDateString('pt-BR')}<br/>
              Status: Concluída
            </p>
          </div>
          <div style="background-color: #eff6ff; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0 0 10px 0; font-weight: bold; color: #1e40af;">🔐 COMO SACAR SEU PRÊMIO:</p>
            <ol style="margin: 0; padding-left: 20px; color: #1e3a8a;">
              <li>Acesse o sistema Giro Premiado</li>
              <li>Vá até o dashboard</li>
              <li>Clique em "SACAR MEU PRÊMIO" no modal de parabéns</li>
              <li>O valor será creditado na sua conta automaticamente</li>
            </ol>
          </div>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${frontendUrl}" 
               style="background: linear-gradient(135deg, #10B981 0%, #059669 100%); color: white; padding: 14px 35px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block; font-size: 16px;">
              🎁 ACESSAR SISTEMA E SACAR
            </a>
          </div>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
          <p style="color: #9ca3af; font-size: 12px; text-align: center;">
            Giro Premiado - Sistema colaborativo de ganhos<br/>
            <a href="${frontendUrl}" style="color: #9ca3af;">Acessar Sistema</a>
          </p>
        </div>
      </div>
    `
  }

  try {
    await transporter.sendMail(mailOptions)
    console.log(
      `📧 Email de prêmio enviado para ${usuario.email} (Rodada ${rodada.nome})`
    )
  } catch (err) {
    console.error(
      `❌ Falha ao enviar email de prêmio para ${usuario.email}:`,
      err.message
    )
  }
}

// ===========================================
// EMAIL DE COBRANÇA / LEMBRETE (sem link direto para pagamento)
// ===========================================
async function enviarEmailCobranca (usuario, rodada, valor, tipo = 'cobranca') {
  const frontendUrl = getFrontendUrl()
  const mailOptions = {
    from: `"Giro Premiado" <${process.env.SMTP_USER}>`,
    to: usuario.email,
    subject:
      tipo === 'lembrete'
        ? `🔴 Lembrete de pagamento - ${rodada.nome}`
        : `🔴 Pagamento pendente - ${rodada.nome}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="text-align: center; padding: 20px; background-color: #ef4444; border-radius: 10px 10px 0 0;">
          <h1 style="color: white; margin: 0;">Giro Premiado</h1>
        </div>
        <div style="padding: 30px; background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 0 0 10px 10px;">
          <h2 style="color: #1f2937;">Olá ${usuario.nome}!</h2>
          <p style="color: #4b5563; line-height: 1.5;">
            ${
              tipo === 'lembrete'
                ? 'Este é um lembrete amigável: seu pagamento ainda está pendente.'
                : 'Seu pagamento para a rodada ainda está pendente.'
            }
          </p>
          <div style="background-color: #fef3c7; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0; font-size: 14px;">💰 Valor a pagar:</p>
            <p style="margin: 5px 0 0; font-size: 24px; font-weight: bold; color: #d97706;">R$ ${valor.toFixed(
              2
            )}</p>
            <p style="margin: 5px 0 0; font-size: 12px; color: #92400e;">(Investimento de R$ 150,00)</p>
          </div>
          <p style="color: #4b5563;">
            ⏳ A rodada <strong>${
              rodada.nome
            }</strong> está aguardando seu pagamento para avançar!
          </p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${frontendUrl}/dashboard" 
               style="background-color: #ef4444; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
              🔴 ACESSAR DASHBOARD E PAGAR
            </a>
          </div>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
          <p style="color: #9ca3af; font-size: 12px; text-align: center;">
            Giro Premiado - Sistema colaborativo de ganhos<br/>
            <a href="${frontendUrl}" style="color: #9ca3af;">Acessar Sistema</a>
          </p>
        </div>
      </div>
    `
  }

  try {
    await transporter.sendMail(mailOptions)
    console.log(`📧 Email de ${tipo} enviado para ${usuario.email}`)
  } catch (err) {
    console.error(
      `❌ Falha ao enviar email de ${tipo} para ${usuario.email}:`,
      err.message
    )
  }
}

// ===========================================
// EMAIL COM QR CODE (APENAS IMAGEM + INSTRUÇÕES PARA O DASHBOARD)
// ===========================================
async function enviarEmailQrCodePix (
  usuario,
  transacao,
  qrCode,
  qrCodeImage,
  valor,
  rodada
) {
  const frontendUrl = getFrontendUrl()
  const imageSrc =
    qrCodeImage && qrCodeImage.startsWith('data:')
      ? qrCodeImage
      : `data:image/png;base64,${qrCodeImage || ''}`

  const mailOptions = {
    from: `"Giro Premiado" <${process.env.SMTP_USER}>`,
    to: usuario.email,
    subject: `🔴 Pagamento PIX - ${rodada.nome}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="text-align: center; padding: 20px; background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); border-radius: 10px 10px 0 0;">
          <h1 style="color: white; margin: 0;">💳 Giro Premiado</h1>
        </div>
        <div style="padding: 30px; background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 0 0 10px 10px;">
          <h2 style="color: #1f2937;">Olá ${usuario.nome}!</h2>
          <p style="color: #4b5563; line-height: 1.5;">
            Seu pagamento para a rodada <strong>${
              rodada.nome
            }</strong> foi gerado!
          </p>
          <div style="background-color: #fef3c7; padding: 20px; border-radius: 12px; margin: 20px 0; text-align: center;">
            <p style="margin: 0; font-size: 14px; color: #92400e;">💰 VALOR A PAGAR</p>
            <p style="margin: 5px 0 0; font-size: 32px; font-weight: bold; color: #d97706;">R$ ${valor.toFixed(
              2
            )}</p>
          </div>
          <div style="background-color: white; padding: 20px; border-radius: 12px; margin: 20px 0; text-align: center; border: 2px solid #e5e7eb;">
            <p style="font-weight: bold; color: #1f2937; margin-bottom: 15px;">📱 ESCANEIE O QR CODE ABAIXO:</p>
            ${
              qrCodeImage
                ? `<img src="${imageSrc}" alt="QR Code PIX" style="max-width: 200px; margin: 0 auto; display: block;"/>`
                : ''
            }
            ${
              !qrCodeImage && qrCode
                ? `<p style="font-size: 12px; word-break: break-all; background: #f3f4f6; padding: 10px; border-radius: 8px;">Código PIX:<br/>${qrCode}</p>`
                : ''
            }
          </div>
          <div style="text-align: center; margin: 20px 0;">
            <a href="${frontendUrl}/dashboard" 
               style="background-color: #ef4444; color: white; padding: 14px 35px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
               🔴 IR PARA O DASHBOARD
            </a>
          </div>
          <div style="background-color: #eff6ff; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0 0 10px 0; font-weight: bold; color: #1e40af;">⏰ INFORMAÇÕES IMPORTANTES:</p>
            <ul style="margin: 0; padding-left: 20px; color: #1e3a8a; font-size: 14px;">
              <li>O QR Code expira em 1 hora</li>
              <li>Após o pagamento, a confirmação é automática</li>
              <li>Você receberá um e-mail de confirmação</li>
            </ul>
          </div>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
          <p style="color: #9ca3af; font-size: 12px; text-align: center;">
            Giro Premiado - Sistema colaborativo de ganhos<br/>
            <a href="${frontendUrl}" style="color: #9ca3af;">Acessar Sistema</a>
          </p>
        </div>
      </div>
    `
  }

  try {
    await transporter.sendMail(mailOptions)
    console.log(
      `📧 Email com QR Code PIX enviado para ${usuario.email} (Rodada ${rodada.nome})`
    )
  } catch (err) {
    console.error(
      `❌ Falha ao enviar email com QR Code para ${usuario.email}:`,
      err.message
    )
  }
}

// ===========================================
// EXPORTAR FUNÇÕES PÚBLICAS
// ===========================================
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

    const usuario = await User.findById(usuarioId)
    const rodada = await Rodada.findById(rodadaId)
    if (!usuario || !rodada)
      return res.status(404).json({ error: 'Usuário ou rodada não encontrado' })

    if (!podeEnviarEmail(usuarioId, rodadaId)) {
      const ultimoEnvio = emailCooldownCache.get(`${usuarioId}_${rodadaId}`)
      const horasRestantes = 24 - (Date.now() - ultimoEnvio) / (1000 * 60 * 60)
      return res
        .status(429)
        .json({
          error: `Aguarde ${Math.ceil(horasRestantes)} horas para novo lembrete`
        })
    }

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
    const resultados = []
    const erros = []

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
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px;">
        <h2>💰 Nova Solicitação de Saque</h2>
        <p><strong>Usuário:</strong> ${usuario.nome}</p>
        <p><strong>Email:</strong> ${usuario.email}</p>
        <p><strong>Rodada:</strong> ${rodada.nome}</p>
        <p><strong>Valor:</strong> R$ ${valor}</p>
        <p><strong>Chave PIX:</strong> ${usuario.chavePix} (${usuario.tipoChavePix})</p>
        <hr/>
        <p>Acesse o dashboard do admin para aprovar.</p>
      </div>
    `
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
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px;">
        <div style="text-align: center; padding: 20px; background: linear-gradient(135deg, #10B981 0%, #059669 100%); border-radius: 10px 10px 0 0;">
          <h1 style="color: white;">✅ SAQUE APROVADO!</h1>
        </div>
        <div style="padding: 30px; background-color: #f9fafb;">
          <p>Olá <strong>${usuario.nome}</strong>,</p>
          <p>Sua solicitação de saque foi <strong style="color: #10B981;">APROVADA</strong>!</p>
          <div style="background-color: #ecfdf5; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <p><strong>💰 Valor:</strong> R$ ${solicitacao.valor}</p>
            <p><strong>📅 Data:</strong> ${new Date().toLocaleDateString(
              'pt-BR'
            )}</p>
          </div>
          <p>O valor será transferido para sua chave PIX em breve.</p>
          <p><strong>Chave PIX:</strong> ${usuario.chavePix} (${
      usuario.tipoChavePix
    })</p>
          <hr/>
          <p style="font-size: 12px; color: #6b7280;">Giro Premiado</p>
        </div>
      </div>
    `
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

exports.enviarEmailQrCodePix = enviarEmailQrCodePix
