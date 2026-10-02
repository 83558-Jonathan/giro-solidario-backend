const User = require('../models/User')
const Rodada = require('../models/Rodada')
const Transacao = require('../models/Transacao')
const nodemailer = require('nodemailer')
const {
  VALOR_VERMELHO,
  PREMIO_VERDE,
  VALOR_VERMELHO_TEXTO,
  PREMIO_VERDE_TEXTO,
  formatarMoeda
} = require('../config/constantes')

const getFrontendUrl = () => {
  const url = process.env.FRONTEND_URL || 'https://giropremiados.com.br'
  return url.replace(/\/$/, '')
}

// ===========================================
// TRANSPORTER
// ===========================================
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.hostinger.com',
  port: parseInt(process.env.SMTP_PORT) || 465,
  secure: process.env.SMTP_SECURE === 'true',
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  timeout: 15000,
  connectionTimeout: 15000,
  greetingTimeout: 15000,
  socketTimeout: 15000
})

// Verifica conexão SMTP no boot (sem debug verboso)
;(async () => {
  try {
    await transporter.verify()
    console.log('SMTP configurado corretamente')
  } catch (error) {
    console.error('❌ Erro na conexão SMTP:', error.message)
  }
})()

const FROM = () =>
  `"Giro Premiado" <${
    process.env.SMTP_USER || 'naoresponder@giropremiados.com.br'
  }>`

// ===========================================
// TEMPLATE BASE — layout compartilhado
// ===========================================
function templateBase ({
  cor = '#10B981',
  emoji = '🎉',
  titulo = '',
  subtitulo = '',
  conteudo = '',
  ctaTexto = null,
  ctaUrl = null,
  corTexto = '#10B981'
}) {
  const frontendUrl = getFrontendUrl()
  const anoAtual = new Date().getFullYear()

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${titulo}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f3f4f6;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.05);">
          <!-- HEADER -->
          <tr>
            <td style="background:linear-gradient(135deg,${cor} 0%,${cor}dd 100%);padding:32px 24px;text-align:center;">
              <div style="font-size:44px;line-height:1;margin-bottom:8px;">${emoji}</div>
              <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:800;letter-spacing:-0.3px;">${titulo}</h1>
              ${
                subtitulo
                  ? `<p style="margin:6px 0 0 0;color:rgba(255,255,255,0.9);font-size:14px;">${subtitulo}</p>`
                  : ''
              }
            </td>
          </tr>
          <!-- BODY -->
          <tr>
            <td style="padding:28px 24px;color:#374151;font-size:15px;line-height:1.6;">
              ${conteudo}
              ${
                ctaTexto && ctaUrl
                  ? `
                <div style="text-align:center;margin:28px 0 8px 0;">
                  <a href="${ctaUrl}" style="display:inline-block;background:${cor};color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:700;font-size:15px;">${ctaTexto}</a>
                </div>
              `
                  : ''
              }
            </td>
          </tr>
          <!-- FOOTER -->
          <tr>
            <td style="background:#f9fafb;padding:20px 24px;text-align:center;border-top:1px solid #e5e7eb;">
              <p style="margin:0;color:#6b7280;font-size:12px;">
                Giro Premiado · Sistema de Renda Colaborativa
              </p>
              <p style="margin:6px 0 0 0;color:#9ca3af;font-size:11px;">
                <a href="${frontendUrl}/dashboard" style="color:${corTexto};text-decoration:none;">Acessar Dashboard</a>
                &nbsp;·&nbsp;
                <a href="${frontendUrl}" style="color:#9ca3af;text-decoration:none;">${frontendUrl.replace(
    /^https?:\/\//,
    ''
  )}</a>
              </p>
              <p style="margin:10px 0 0 0;color:#d1d5db;font-size:10px;">
                © ${anoAtual} Giro Premiado. Todos os direitos reservados.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

// ===========================================
// AUXILIAR: caixa destacada dentro do email
// ===========================================
function boxDestaque (
  texto,
  { cor = '#ecfdf5', borda = '#10B981', textoCor = '#065f46' } = {}
) {
  return `<div style="background:${cor};border-left:4px solid ${borda};border-radius:8px;padding:14px 16px;margin:16px 0;">
    <p style="margin:0;color:${textoCor};font-size:14px;line-height:1.5;">${texto}</p>
  </div>`
}

function listaPassos (passos) {
  return `<ol style="margin:16px 0;padding-left:20px;color:#4b5563;">${passos
    .map(p => `<li style="margin-bottom:8px;line-height:1.5;">${p}</li>`)
    .join('')}</ol>`
}

// ===========================================
// EMAIL 1: Boas-vindas (cadastro)
// ===========================================
async function enviarEmailBoasVindas (
  usuario,
  { entrouNaFila, posicaoFila } = {}
) {
  const frontendUrl = getFrontendUrl()
  const primeiroNome = usuario.nome?.split(' ')[0] || 'amigo'

  let conteudo = `
    <p style="margin:0 0 12px 0;">Olá <strong>${primeiroNome}</strong>,</p>
    <p style="margin:0 0 12px 0;">Seja bem-vindo(a) ao <strong>Giro Premiado</strong>! Sua conta foi criada com sucesso. 🎊</p>
    ${boxDestaque(
      `💰 <strong>Como funciona:</strong> 8 pessoas entram como VERMELHO pagando ${VALOR_VERMELHO_TEXTO}. O VERDE da rodada recebe <strong>${PREMIO_VERDE_TEXTO}</strong> quando todos confirmarem.`
    )}
  `

  if (entrouNaFila) {
    conteudo += `
      <p style="margin:0 0 12px 0;">⏳ Você entrou na <strong>FILA DE ESPERA</strong> na posição <strong>${posicaoFila}</strong>.</p>
      ${boxDestaque(
        `Assim que uma vaga para VERMELHO abrir, você será alocado automaticamente. Fique de olho no seu email!`,
        { cor: '#fef3c7', borda: '#f59e0b', textoCor: '#78350f' }
      )}
    `
  } else {
    conteudo += `
      <p style="margin:0 0 12px 0;">🎯 Sua jornada começa agora. Compartilhe seu link de convite e venha ganhar!</p>
    `
  }

  conteudo += `
    <p style="margin:16px 0 0 0;font-size:13px;color:#6b7280;">💡 <strong>Dica:</strong> quanto mais pessoas você convidar, mais rápido a roda gira e mais perto você fica do prêmio.</p>
  `

  const html = templateBase({
    cor: '#10B981',
    emoji: '🎊',
    titulo: 'Bem-vindo ao Giro Premiado!',
    subtitulo: 'Sua conta está pronta para começar',
    conteudo,
    ctaTexto: 'ACESSAR MEU DASHBOARD',
    ctaUrl: `${frontendUrl}/dashboard`
  })

  await transporter.sendMail({
    from: FROM(),
    to: usuario.email,
    subject: '🎊 Bem-vindo ao Giro Premiado!',
    html
  })
  console.log(`📧 [email] Boas-vindas enviadas para ${usuario.email}`)
}

// ===========================================
// EMAIL 2: QR Code PIX gerado (cobrar pagamento)
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
  const primeiroNome = usuario.nome?.split(' ')[0] || 'amigo'
  const nomeRodada = rodada?.nome || transacao?.rodada?.nome || 'sua rodada'
  const valorFmt = formatarMoeda(valor || VALOR_VERMELHO)
  const srcImg = qrCodeImage?.startsWith('data:')
    ? qrCodeImage
    : `data:image/png;base64,${qrCodeImage}`

  const conteudo = `
    <p style="margin:0 0 12px 0;">Olá <strong>${primeiroNome}</strong>,</p>
    <p style="margin:0 0 12px 0;">🎉 <strong>Você entrou na ${nomeRodada}!</strong> Falta apenas uma etapa: efetuar o pagamento para confirmar sua vaga.</p>

    ${boxDestaque(
      `💳 <strong>Valor a pagar:</strong> ${valorFmt}<br>
       ⏰ <strong>Prazo:</strong> 1 hora para pagar
       <br><br>
       <span style="color:#991b1b;">⚠️ Se não pagar no prazo, sua vaga será liberada automaticamente para outro participante.</span>`
    )}

    <div style="text-align:center;margin:24px 0;">
      <p style="margin:0 0 12px 0;font-size:14px;color:#4b5563;font-weight:600;">Escaneie o QR Code abaixo no app do seu banco:</p>
      <img src="${srcImg}" alt="QR Code PIX" width="220" height="220" style="border:8px solid #ffffff;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.08);" />
    </div>

    <p style="margin:16px 0 8px 0;font-size:13px;color:#6b7280;"><strong>Ou copie o código PIX (copia e cola):</strong></p>
    <div style="background:#f3f4f6;border-radius:8px;padding:12px;font-family:monospace;font-size:11px;word-break:break-all;color:#4b5563;max-height:80px;overflow:hidden;">
      ${qrCode}
    </div>

    ${listaPassos([
      'Abra o app do seu banco e escolha a opção <strong>PIX</strong>',
      'Escaneie o QR Code ou cole o código copia-e-cola',
      'Confirme o pagamento — a confirmação é automática',
      'Pronto! Sua vaga está garantida 🎯'
    ])}

    <p style="margin:16px 0 0 0;font-size:13px;color:#6b7280;">💡 <strong>Depois de pagar, a rodada avança mais rápido e você fica mais perto do prêmio de ${PREMIO_VERDE_TEXTO}!</strong></p>
  `

  const html = templateBase({
    cor: '#10B981',
    emoji: '💳',
    titulo: 'Pague seu PIX e garanta sua vaga',
    subtitulo: `Valor: ${valorFmt} · Rodada ${nomeRodada}`,
    conteudo,
    ctaTexto: 'ABRIR MEU DASHBOARD',
    ctaUrl: `${frontendUrl}/dashboard`
  })

  await transporter.sendMail({
    from: FROM(),
    to: usuario.email,
    subject: `💳 Pague ${valorFmt} e garanta sua vaga — ${nomeRodada}`,
    html
  })
  console.log(`📧 [email] QR Code PIX enviado para ${usuario.email}`)
}

// ===========================================
// EMAIL 3: Lembrete de pagamento (cobrança)
// ===========================================
async function enviarEmailCobranca (usuario, rodada, valor, tipo = 'cobranca') {
  const frontendUrl = getFrontendUrl()
  const primeiroNome = usuario.nome?.split(' ')[0] || 'amigo'
  const nomeRodada = rodada?.nome || 'sua rodada'
  const valorFmt = formatarMoeda(valor || VALOR_VERMELHO)

  const ehLembrete = tipo === 'lembrete'

  const conteudo = `
    <p style="margin:0 0 12px 0;">Olá <strong>${primeiroNome}</strong>,</p>
    <p style="margin:0 0 12px 0;">
      ${ehLembrete ? '⏰ Passando para lembrar: ' : '⚠️ Atenção: '}
      <strong>seu pagamento está pendente</strong> na ${nomeRodada}.
    </p>

    ${boxDestaque(
      `💰 <strong>Valor:</strong> ${valorFmt}<br>
       🎯 <strong>Rodada:</strong> ${nomeRodada}`,
      { cor: '#fef3c7', borda: '#f59e0b', textoCor: '#78350f' }
    )}

    <p style="margin:12px 0;">Quando todos os 8 VERMELHOS pagarem, a rodada avança e o <strong>VERDE</strong> da vez recebe <strong>${PREMIO_VERDE_TEXTO}</strong>. Faltando só você, a roda para!</p>

    <p style="margin:12px 0 0 0;font-size:14px;color:#4b5563;">👉 Acesse o dashboard para gerar um novo QR Code PIX e efetuar o pagamento.</p>
  `

  const html = templateBase({
    cor: ehLembrete ? '#f59e0b' : '#ef4444',
    emoji: ehLembrete ? '⏰' : '⚠️',
    titulo: ehLembrete
      ? 'Lembrete: falta você pagar!'
      : 'Não deixe sua vaga expirar',
    subtitulo: `${nomeRodada} · ${valorFmt}`,
    conteudo,
    ctaTexto: 'PAGAR AGORA',
    ctaUrl: `${frontendUrl}/dashboard`,
    corTexto: ehLembrete ? '#f59e0b' : '#ef4444'
  })

  await transporter.sendMail({
    from: FROM(),
    to: usuario.email,
    subject: ehLembrete
      ? `⏰ Lembrete: pague ${valorFmt} para não perder sua vaga`
      : `⚠️ ${valorFmt} pendente — não deixe sua vaga expirar`,
    html
  })
  console.log(`📧 [email] Cobrança (${tipo}) enviada para ${usuario.email}`)
}

// ===========================================
// EMAIL 4: Prêmio recebido (verde ganhou)
// ===========================================
async function enviarEmailPremio (usuario, rodada, valor) {
  const frontendUrl = getFrontendUrl()
  const primeiroNome = usuario.nome?.split(' ')[0] || 'amigo'
  const nomeRodada = rodada?.nome || 'sua rodada'
  const valorFmt = formatarMoeda(valor || PREMIO_VERDE)

  const conteudo = `
    <p style="margin:0 0 12px 0;">🎉 <strong>Parabéns, ${primeiroNome}!</strong></p>
    <p style="margin:0 0 12px 0;">Você foi o <strong>VERDE</strong> da ${nomeRodada} e todos os pagamentos foram confirmados. Você acabou de ganhar:</p>

    <div style="text-align:center;background:linear-gradient(135deg,#10B981,#059669);border-radius:12px;padding:24px;margin:20px 0;">
      <p style="margin:0;color:#ffffff;font-size:14px;opacity:0.9;">Seu prêmio</p>
      <p style="margin:8px 0 0 0;color:#ffffff;font-size:36px;font-weight:800;letter-spacing:-1px;">${valorFmt}</p>
    </div>

    <p style="margin:12px 0;">💰 O valor já está disponível no seu saldo de prêmios. Você pode <strong>sacar a qualquer momento</strong> para sua chave PIX.</p>

    ${boxDestaque(
      `🎁 <strong>Dica:</strong> você pode usar parte do prêmio para jogar novamente e continuar na rodada, ou sacar tudo de uma vez. Você decide!`,
      { cor: '#ecfdf5', borda: '#10B981', textoCor: '#065f46' }
    )}
  `

  const html = templateBase({
    cor: '#10B981',
    emoji: '🏆',
    titulo: 'Você ganhou o prêmio!',
    subtitulo: `Rodada ${nomeRodada} concluída`,
    conteudo,
    ctaTexto: 'SACAR MEU PRÊMIO',
    ctaUrl: `${frontendUrl}/dashboard`
  })

  await transporter.sendMail({
    from: FROM(),
    to: usuario.email,
    subject: `🏆 Você ganhou ${valorFmt} no Giro Premiado!`,
    html
  })
  console.log(`📧 [email] Prêmio enviado para ${usuario.email}`)
}

// ===========================================
// EMAIL 5: Rodada avançou (nova cor atribuída)
// ===========================================
async function enviarEmailRodadaAvancada (
  usuario,
  rodada,
  corNova,
  corAnterior
) {
  const frontendUrl = getFrontendUrl()
  const primeiroNome = usuario.nome?.split(' ')[0] || 'amigo'
  const nomeRodada = rodada?.nome || 'sua rodada'

  const descricoes = {
    amarelo: {
      emoji: '🟡',
      titulo: 'Você está na fila',
      texto: 'Aguarde uma vaga para entrar como VERMELHO.'
    },
    vermelho: {
      emoji: '🔴',
      titulo: 'Você é VERMELHO!',
      texto: `Efetue o pagamento de ${VALOR_VERMELHO_TEXTO} para fazer a roda girar.`
    },
    azul: {
      emoji: '🔵',
      titulo: 'Você subiu! Agora é AZUL',
      texto: 'Sua missão: trazer 2 amigos para a rodada.'
    },
    preto: {
      emoji: '⚫',
      titulo: 'Você é PRETO',
      texto: 'Continue dando suporte à rodada — logo você será VERDE!'
    },
    verde: {
      emoji: '🟢',
      titulo: '🎊 Você é o VERDE da vez!',
      texto: `Aguarde os 8 VERMELHOS pagarem para receber ${PREMIO_VERDE_TEXTO}.`
    },
    concluido: {
      emoji: '🏆',
      titulo: 'Você ganhou o prêmio!',
      texto: `Seu saldo de ${PREMIO_VERDE_TEXTO} já está disponível para saque.`
    }
  }

  const info = descricoes[corNova] || {
    emoji: '🎯',
    titulo: 'Sua cor mudou',
    texto: `Você agora é ${corNova?.toUpperCase()}.`
  }

  const conteudo = `
    <p style="margin:0 0 12px 0;">Olá <strong>${primeiroNome}</strong>,</p>
    <p style="margin:0 0 12px 0;">🎯 A ${nomeRodada} avançou e você tem uma nova posição:</p>

    <div style="text-align:center;background:#f9fafb;border-radius:12px;padding:24px;margin:16px 0;">
      <div style="font-size:40px;line-height:1;">${info.emoji}</div>
      <p style="margin:8px 0 4px 0;font-size:18px;font-weight:800;color:#111827;">${
        info.titulo
      }</p>
      <p style="margin:0;color:#6b7280;font-size:14px;">${info.texto}</p>
    </div>

    ${
      corNova === 'azul'
        ? listaPassos([
            'Abra o dashboard e gere seu link de convite',
            'Compartilhe com 2 amigos',
            'Quando eles se cadastrarem, você sobe para PRETO'
          ])
        : ''
    }

    ${
      corNova === 'verde'
        ? boxDestaque(
            `Você é o sortudo desta rodada! Assim que os 8 VERMELHOS pagarem, você recebe ${PREMIO_VERDE_TEXTO} automaticamente.`
          )
        : ''
    }
  `

  const html = templateBase({
    cor:
      corNova === 'verde'
        ? '#10B981'
        : corNova === 'azul'
        ? '#3b82f6'
        : corNova === 'concluido'
        ? '#10B981'
        : '#6b7280',
    emoji: info.emoji,
    titulo: info.titulo,
    subtitulo: `${nomeRodada} avançou`,
    conteudo,
    ctaTexto: 'VER MINHA POSIÇÃO',
    ctaUrl: `${frontendUrl}/dashboard`
  })

  await transporter.sendMail({
    from: FROM(),
    to: usuario.email,
    subject: `${info.emoji} ${info.titulo} — ${nomeRodada}`,
    html
  })
  console.log(`📧 [email] Rodada avançada enviado para ${usuario.email}`)
}

// ===========================================
// EMAIL 6: Convite (motivação para trazer amigos)
// ===========================================
async function enviarEmailConvite (usuario, linkConvite) {
  const primeiroNome = usuario.nome?.split(' ')[0] || 'amigo'
  const frontendUrl = getFrontendUrl()

  const conteudo = `
    <p style="margin:0 0 12px 0;">Olá <strong>${primeiroNome}</strong>,</p>
    <p style="margin:0 0 12px 0;">🚀 Quanto mais pessoas você convidar, mais rápido a roda gira — e mais perto você fica do prêmio!</p>

    <div style="background:#f3f4f6;border-radius:8px;padding:14px;word-break:break-all;font-family:monospace;font-size:12px;color:#4b5563;margin:16px 0;">
      ${linkConvite}
    </div>

    ${boxDestaque(
      `🎁 <strong>Bônus:</strong> seus convidados entram automaticamente na sua rodada como VERMELHOS, e você avança de cor mais rápido!`
    )}

    <p style="margin:12px 0;">Compartilhe agora mesmo pelo WhatsApp, Email ou copie o link e envie para quem quiser:</p>
  `

  const html = templateBase({
    cor: '#8b5cf6',
    emoji: '🚀',
    titulo: 'Convide amigos e ganhe mais rápido',
    subtitulo: 'Cada convite aproxima você do prêmio',
    conteudo,
    ctaTexto: 'COMPARTILHAR MEU LINK',
    ctaUrl: `${frontendUrl}/dashboard`,
    corTexto: '#8b5cf6'
  })

  await transporter.sendMail({
    from: FROM(),
    to: usuario.email,
    subject: '🚀 Convide amigos e acelere sua rodada!',
    html
  })
  console.log(`📧 [email] Convite enviado para ${usuario.email}`)
}

// ===========================================
// EXPORTS PÚBLICOS
// ===========================================
exports.enviarEmailBoasVindas = enviarEmailBoasVindas
exports.enviarEmailQrCodePix = enviarEmailQrCodePix
exports.enviarEmailCobranca = enviarEmailCobranca
exports.enviarEmailPremio = enviarEmailPremio
exports.enviarEmailRodadaAvancada = enviarEmailRodadaAvancada
exports.enviarEmailConvite = enviarEmailConvite

exports.notificarPremioVerde = async (
  usuarioId,
  rodadaId,
  valor = PREMIO_VERDE
) => {
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

// ===========================================
// COOLDOWN (24h por usuário + rodada)
// ===========================================
const emailCooldownCache = new Map()

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
// ENDPOINTS REST (cobranças/lembretes manuais)
// ===========================================
exports.cobrarUsuario = async (req, res) => {
  try {
    const { usuarioId } = req.params
    const { rodadaId, valor } = req.body
    if (!rodadaId)
      return res.status(400).json({ error: 'rodadaId obrigatório' })

    if (!podeEnviarEmail(usuarioId, rodadaId)) {
      const ultimoEnvio = emailCooldownCache.get(`${usuarioId}_${rodadaId}`)
      const horasRestantes = 24 - (Date.now() - ultimoEnvio) / (1000 * 60 * 60)
      return res.status(429).json({
        error: `Aguarde ${Math.ceil(horasRestantes)} horas para novo lembrete`
      })
    }

    const usuario = await User.findById(usuarioId)
    const rodada = await Rodada.findById(rodadaId)
    if (!usuario || !rodada)
      return res.status(404).json({ error: 'Usuário ou rodada não encontrado' })

    await enviarEmailCobranca(
      usuario,
      rodada,
      valor || VALOR_VERMELHO,
      'cobranca'
    )
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

    await enviarEmailCobranca(
      usuario,
      rodada,
      valor || VALOR_VERMELHO,
      'lembrete'
    )
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
        await enviarEmailCobranca(usuario, rodada, VALOR_VERMELHO, 'lembrete')
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

// ===========================================
// NOTIFICAÇÕES ADMIN
// ===========================================
exports.notificarAdminNovaSolicitacao = async (usuario, rodada, valor) => {
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@giropremiados.com.br'
  const frontendUrl = getFrontendUrl()
  const valorFmt = formatarMoeda(valor)

  const conteudo = `
    <p style="margin:0 0 12px 0;">Nova solicitação de saque recebida.</p>
    ${boxDestaque(
      `👤 <strong>Usuário:</strong> ${usuario.nome} (${usuario.email})<br>
       💰 <strong>Valor:</strong> ${valorFmt}<br>
       🎯 <strong>Rodada:</strong> ${rodada.nome}<br>
       🔑 <strong>Chave PIX:</strong> ${usuario.chavePix || 'não informada'} (${
        usuario.tipoChavePix || '-'
      })`
    )}
    <p style="margin:12px 0;">Acesse o painel admin para aprovar ou recusar.</p>
  `

  const html = templateBase({
    cor: '#3b82f6',
    emoji: '💰',
    titulo: 'Nova solicitação de saque',
    subtitulo: `${valorFmt} — ${usuario.nome}`,
    conteudo,
    ctaTexto: 'ABRIR PAINEL ADMIN',
    ctaUrl: `${frontendUrl}/admin`,
    corTexto: '#3b82f6'
  })

  try {
    await transporter.sendMail({
      from: FROM(),
      to: adminEmail,
      subject: `💰 Nova solicitação de saque — ${valorFmt} (${usuario.nome})`,
      html
    })
    console.log(`📧 [email] Admin notificado sobre saque de ${usuario.nome}`)
  } catch (err) {
    console.error('Erro ao notificar admin:', err.message)
  }
}

// ===========================================
// NOTIFICAÇÕES DE SAQUE
// ===========================================
exports.notificarUsuarioSaqueAprovado = async (usuario, solicitacao) => {
  const frontendUrl = getFrontendUrl()
  const valorFmt = formatarMoeda(solicitacao.valor)
  const primeiroNome = usuario.nome?.split(' ')[0] || 'amigo'

  const conteudo = `
    <p style="margin:0 0 12px 0;">Olá <strong>${primeiroNome}</strong>,</p>
    <p style="margin:0 0 12px 0;">🎉 Boa notícia! Seu saque foi <strong>aprovado</strong> e o PIX está a caminho.</p>

    <div style="text-align:center;background:linear-gradient(135deg,#10B981,#059669);border-radius:12px;padding:24px;margin:20px 0;">
      <p style="margin:0;color:#ffffff;font-size:14px;opacity:0.9;">Valor enviado</p>
      <p style="margin:8px 0 0 0;color:#ffffff;font-size:32px;font-weight:800;">${valorFmt}</p>
    </div>

    <p style="margin:12px 0;">O valor chegará na sua chave PIX <strong>${
      solicitacao.chavePix
    }</strong> em instantes.</p>

    ${boxDestaque(
      `🎁 <strong>E aí, vamos de novo?</strong> Você já tem saldo de prêmio — clique em "Jogar Novamente" no dashboard para continuar na roda e concorrer a mais ${PREMIO_VERDE_TEXTO}!`
    )}
  `

  const html = templateBase({
    cor: '#10B981',
    emoji: '',
    titulo: 'Seu saque foi aprovado!',
    subtitulo: `PIX de ${valorFmt} enviado`,
    conteudo,
    ctaTexto: 'VOLTAR AO DASHBOARD',
    ctaUrl: `${frontendUrl}/dashboard`
  })

  try {
    await transporter.sendMail({
      from: FROM(),
      to: usuario.email,
      subject: `Saque de ${valorFmt} aprovado e enviado!`,
      html
    })
    console.log(`📧 [email] Saque aprovado enviado para ${usuario.email}`)
  } catch (err) {
    console.error(
      'Erro ao notificar usuário sobre saque aprovado:',
      err.message
    )
  }
}

exports.notificarSaqueRecusado = async (usuario, solicitacao, motivo) => {
  const frontendUrl = getFrontendUrl()
  const valorFmt = formatarMoeda(solicitacao.valor)
  const primeiroNome = usuario.nome?.split(' ')[0] || 'amigo'

  const conteudo = `
    <p style="margin:0 0 12px 0;">Olá <strong>${primeiroNome}</strong>,</p>
    <p style="margin:0 0 12px 0;">Sua solicitação de saque no valor de <strong>${valorFmt}</strong> foi recusada pelo administrador.</p>

    ${boxDestaque(`<strong>Motivo:</strong> ${motivo || 'Não informado'}`, {
      cor: '#fee2e2',
      borda: '#ef4444',
      textoCor: '#991b1b'
    })}

    <p style="margin:12px 0;">O valor permanece no seu saldo de prêmios. Você pode solicitar um novo saque a qualquer momento.</p>
  `

  const html = templateBase({
    cor: '#ef4444',
    emoji: '❌',
    titulo: 'Seu saque foi recusado',
    subtitulo: `${valorFmt} — ${solicitacao.rodada?.nome || 'Rodada'}`,
    conteudo,
    ctaTexto: 'VOLTAR AO DASHBOARD',
    ctaUrl: `${frontendUrl}/dashboard`,
    corTexto: '#ef4444'
  })

  try {
    await transporter.sendMail({
      from: FROM(),
      to: usuario.email,
      subject: `❌ Saque de ${valorFmt} recusado — veja o motivo`,
      html
    })
    console.log(`📧 [email] Saque recusado enviado para ${usuario.email}`)
  } catch (err) {
    console.error('Erro ao notificar recusa de saque:', err.message)
  }
}
