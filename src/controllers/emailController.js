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

;(async () => {
  try {
    await transporter.verify()
    console.log('SMTP configurado corretamente')
  } catch (error) {
    console.error('Erro na conexao SMTP:', error.message)
  }
})()

const FROM = () =>
  `"Giro Premiado" <${process.env.SMTP_USER || 'mail@giropremiados.com.br'}>`

// ===========================================
// TEMPLATE BASE
// ===========================================
function templateBase ({
  cor = '#10B981',
  emoji = '',
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
              ${
                emoji
                  ? `<div style="font-size:44px;line-height:1;margin-bottom:8px;">${emoji}</div>`
                  : ''
              }
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
// AUXILIARES
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
// EMAIL 1: Boas-vindas
// ===========================================
async function enviarEmailBoasVindas (
  usuario,
  { entrouNaFila, posicaoFila } = {}
) {
  const frontendUrl = getFrontendUrl()
  const primeiroNome = usuario.nome?.split(' ')[0] || 'amigo'

  let conteudo = `
    <p style="margin:0 0 12px 0;">Ola <strong>${primeiroNome}</strong>,</p>
    <p style="margin:0 0 12px 0;">Seja bem-vindo(a) ao <strong>Giro Premiado</strong>! Sua conta foi criada com sucesso.</p>
    ${boxDestaque(
      `<strong>Como funciona:</strong> 8 pessoas entram como VERMELHO pagando ${VALOR_VERMELHO_TEXTO}. O VERDE da rodada recebe <strong>${PREMIO_VERDE_TEXTO}</strong> quando todos confirmarem.`
    )}
  `

  if (entrouNaFila) {
    conteudo += `
      <p style="margin:0 0 12px 0;">Voce entrou na <strong>FILA DE ESPERA</strong> na posicao <strong>${posicaoFila}</strong>.</p>
      ${boxDestaque(
        `Assim que uma vaga para VERMELHO abrir, voce sera alocado automaticamente. Fique de olho no seu email!`,
        { cor: '#fef3c7', borda: '#f59e0b', textoCor: '#78350f' }
      )}
    `
  } else {
    conteudo += `
      <p style="margin:0 0 12px 0;">Sua jornada comeca agora. Compartilhe seu link de convite e venha ganhar!</p>
    `
  }

  conteudo += `
    <p style="margin:16px 0 0 0;font-size:13px;color:#6b7280;"><strong>Dica:</strong> quanto mais pessoas voce convidar, mais rapido a roda gira e mais perto voce fica do premio.</p>
  `

  const html = templateBase({
    cor: '#10B981',
    emoji: '',
    titulo: 'Bem-vindo ao Giro Premiado!',
    subtitulo: 'Sua conta esta pronta para comecar',
    conteudo,
    ctaTexto: 'ACESSAR MEU DASHBOARD',
    ctaUrl: `${frontendUrl}/dashboard`
  })

  await transporter.sendMail({
    from: FROM(),
    to: usuario.email,
    subject: 'Bem-vindo ao Giro Premiado!',
    html
  })
  console.log(`[email] ✅ Boas-vindas enviadas para ${usuario.email}`)
}

// ===========================================
// EMAIL 2: QR Code PIX (MELHORADO)
// ===========================================
// 🎯 MUDANÇA: CTA vai direto para /pagamento/:transacaoId
// (antes ia pro /dashboard e o usuário tinha que procurar)
async function enviarEmailQrCodePix (
  usuario,
  transacao,
  qrCode,
  qrCodeImage,
  valor,
  rodada
) {
  if (!qrCode || !qrCodeImage) {
    console.warn(
      `[email] enviarEmailQrCodePix ABORTADO: qrCode=${!!qrCode}, qrCodeImage=${!!qrCodeImage} (usuario=${
        usuario?.email
      }, transacao=${transacao?._id})`
    )
    return false
  }

  const frontendUrl = getFrontendUrl()
  const primeiroNome = usuario.nome?.split(' ')[0] || 'amigo'
  const nomeRodada = rodada?.nome || transacao?.rodada?.nome || 'sua rodada'
  const valorFmt = formatarMoeda(valor || VALOR_VERMELHO)
  const srcImg = qrCodeImage.startsWith('data:')
    ? qrCodeImage
    : `data:image/png;base64,${qrCodeImage}`
  const transacaoId = transacao?._id || transacao?.id

  // ⬇️ Link direto para o pagamento (não mais /dashboard)
  const linkPagamento = transacaoId
    ? `${frontendUrl}/pagamento/${transacaoId}`
    : `${frontendUrl}/dashboard`

  const conteudo = `
    <p style="margin:0 0 12px 0;">Ola <strong>${primeiroNome}</strong>,</p>
    <p style="margin:0 0 12px 0;"><strong>Voce entrou na ${nomeRodada}!</strong> Falta apenas uma etapa: efetuar o pagamento para confirmar sua vaga.</p>

    ${boxDestaque(
      `<strong>Valor a pagar:</strong> ${valorFmt}<br>
       <strong>Prazo:</strong> 1 hora para pagar
       <br><br>
       <span style="color:#991b1b;">Atencao: se nao pagar no prazo, sua vaga sera liberada automaticamente para outro participante.</span>`
    )}

    <div style="text-align:center;margin:24px 0;">
      <p style="margin:0 0 12px 0;font-size:14px;color:#4b5563;font-weight:600;">Escaneie o QR Code abaixo no app do seu banco:</p>
      <img src="${srcImg}" alt="QR Code PIX" width="220" height="220" style="border:8px solid #ffffff;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.08);" />
    </div>

    <p style="margin:16px 0 8px 0;font-size:13px;color:#6b7280;"><strong>Ou copie o codigo PIX (copia e cola):</strong></p>
    <div style="background:#f3f4f6;border-radius:8px;padding:12px;font-family:monospace;font-size:11px;word-break:break-all;color:#4b5563;">
      ${qrCode}
    </div>

    ${listaPassos([
      'Abra o app do seu banco e escolha a opcao <strong>PIX</strong>',
      'Escaneie o QR Code ou cole o codigo copia-e-cola',
      'Confirme o pagamento - a confirmacao e automatica',
      'Pronto! Sua vaga esta garantida'
    ])}

    <p style="margin:16px 0 0 0;font-size:13px;color:#6b7280;"><strong>Depois de pagar, a rodada avanca mais rapido e voce fica mais perto do premio de ${PREMIO_VERDE_TEXTO}!</strong></p>
  `

  const html = templateBase({
    cor: '#10B981',
    emoji: '',
    titulo: 'Pague seu PIX e garanta sua vaga',
    subtitulo: `Valor: ${valorFmt} - Rodada ${nomeRodada}`,
    conteudo,
    ctaTexto: 'PAGAR AGORA',
    ctaUrl: linkPagamento
  })

  await transporter.sendMail({
    from: FROM(),
    to: usuario.email,
    subject: `Pague ${valorFmt} e garanta sua vaga - ${nomeRodada}`,
    html
  })
  console.log(`[email] ✅ QR Code PIX enviado para ${usuario.email}`)
  return true
}

// ===========================================
// EMAIL 3: Lembrete de pagamento
// ===========================================
async function enviarEmailCobranca (usuario, rodada, valor, tipo = 'cobranca') {
  const frontendUrl = getFrontendUrl()
  const primeiroNome = usuario.nome?.split(' ')[0] || 'amigo'
  const nomeRodada = rodada?.nome || 'sua rodada'
  const valorFmt = formatarMoeda(valor || VALOR_VERMELHO)

  const ehLembrete = tipo === 'lembrete'

  const conteudo = `
    <p style="margin:0 0 12px 0;">Ola <strong>${primeiroNome}</strong>,</p>
    <p style="margin:0 0 12px 0;">
      ${ehLembrete ? 'Passando para lembrar: ' : 'Atencao: '}
      <strong>seu pagamento esta pendente</strong> na ${nomeRodada}.
    </p>

    ${boxDestaque(
      `<strong>Valor:</strong> ${valorFmt}<br>
       <strong>Rodada:</strong> ${nomeRodada}`,
      { cor: '#fef3c7', borda: '#f59e0b', textoCor: '#78350f' }
    )}

    <p style="margin:12px 0;">Quando todos os 8 VERMELHOS pagarem, a rodada avanca e o <strong>VERDE</strong> da vez recebe <strong>${PREMIO_VERDE_TEXTO}</strong>. Faltando so voce, a roda para!</p>

    <p style="margin:12px 0 0 0;font-size:14px;color:#4b5563;">Acesse o dashboard para gerar um novo QR Code PIX e efetuar o pagamento.</p>
  `

  const html = templateBase({
    cor: ehLembrete ? '#f59e0b' : '#ef4444',
    emoji: '',
    titulo: ehLembrete
      ? 'Lembrete: falta voce pagar!'
      : 'Nao deixe sua vaga expirar',
    subtitulo: `${nomeRodada} - ${valorFmt}`,
    conteudo,
    ctaTexto: 'PAGAR AGORA',
    ctaUrl: `${frontendUrl}/dashboard`,
    corTexto: ehLembrete ? '#f59e0b' : '#ef4444'
  })

  await transporter.sendMail({
    from: FROM(),
    to: usuario.email,
    subject: ehLembrete
      ? `Lembrete: pague ${valorFmt} para nao perder sua vaga`
      : `${valorFmt} pendente - nao deixe sua vaga expirar`,
    html
  })
  console.log(`[email] ✅ Cobranca (${tipo}) enviada para ${usuario.email}`)
}

// ===========================================
// EMAIL 4: Premio recebido
// ===========================================
async function enviarEmailPremio (usuario, rodada, valor) {
  const frontendUrl = getFrontendUrl()
  const primeiroNome = usuario.nome?.split(' ')[0] || 'amigo'
  const nomeRodada = rodada?.nome || 'sua rodada'
  const valorFmt = formatarMoeda(valor || PREMIO_VERDE)

  const conteudo = `
    <p style="margin:0 0 12px 0;"><strong>Parabens, ${primeiroNome}!</strong></p>
    <p style="margin:0 0 12px 0;">Voce foi o <strong>VERDE</strong> da ${nomeRodada} e todos os pagamentos foram confirmados. Voce acabou de ganhar:</p>

    <div style="text-align:center;background:linear-gradient(135deg,#10B981,#059669);border-radius:12px;padding:24px;margin:20px 0;">
      <p style="margin:0;color:#ffffff;font-size:14px;opacity:0.9;">Seu premio</p>
      <p style="margin:8px 0 0 0;color:#ffffff;font-size:36px;font-weight:800;letter-spacing:-1px;">${valorFmt}</p>
    </div>

    <p style="margin:12px 0;">O valor ja esta disponivel no seu saldo de premios. Voce pode <strong>sacar a qualquer momento</strong> para sua chave PIX.</p>

    ${boxDestaque(
      `<strong>Dica:</strong> voce pode usar parte do premio para jogar novamente e continuar na rodada, ou sacar tudo de uma vez. Voce decide!`
    )}
  `

  const html = templateBase({
    cor: '#10B981',
    emoji: '🏆',
    titulo: 'Voce ganhou o premio!',
    subtitulo: `Rodada ${nomeRodada} concluida`,
    conteudo,
    ctaTexto: 'SACAR MEU PREMIO',
    ctaUrl: `${frontendUrl}/dashboard`
  })

  await transporter.sendMail({
    from: FROM(),
    to: usuario.email,
    subject: `Voce ganhou ${valorFmt} no Giro Premiado!`,
    html
  })
  console.log(`[email] ✅ Premio enviado para ${usuario.email}`)
}

// ===========================================
// EMAIL 5: Progressão de cor (MELHORADO)
// ===========================================
// 🎯 MUDANÇA: templates específicos por cor, celebrativos
// 🎯 MUDANÇA: retorna false se concluido (evita duplicata com enviarEmailPremio)
async function enviarEmailRodadaAvancada (
  usuario,
  rodada,
  corNova,
  corAnterior
) {
  // ⬇️ PROTEÇÃO: concluido é tratado por enviarEmailPremio
  if (corNova === 'concluido') {
    console.log(
      `[email] enviarEmailRodadaAvancada SKIP (concluido → enviarEmailPremio cuida)`
    )
    return false
  }

  const frontendUrl = getFrontendUrl()
  const primeiroNome = usuario.nome?.split(' ')[0] || 'amigo'
  const nomeRodada = rodada?.nome || 'sua rodada'

  let config

  switch (corNova) {
    case 'azul':
      config = {
        cor: '#3b82f6',
        emoji: '🎉',
        titulo: 'Você avançou! Agora é AZUL',
        subtitulo: `${nomeRodada} · próximo passo`,
        heroEmoji: '🔵',
        mensagem: `Parabéns, <strong>${primeiroNome}</strong>! Você pagou e subiu de VERMELHO para <strong>AZUL</strong> na ${nomeRodada}.`,
        missao:
          'Sua nova missão: <strong>convidar 2 amigos</strong> para a rodada. Cada amigo que entrar e pagar rende <strong>R$ 5 de comissão</strong> pra você.',
        proximoPasso:
          'Quando os outros participantes avançarem, você vai para PRETO → VERDE → <strong>PRÊMIO de R$ 100</strong>.',
        ctaTexto: 'CONVIDAR MEUS AMIGOS',
        ctaUrl: `${frontendUrl}/dashboard`,
        dica: 'Compartilhe seu link no WhatsApp, Instagram ou onde quiser. Sem limite de comissões.'
      }
      break

    case 'preto':
      config = {
        cor: '#4b5563',
        emoji: '🚀',
        titulo: 'Você é PRETO agora!',
        subtitulo: `${nomeRodada} · faltam 1 passo`,
        heroEmoji: '⚫',
        mensagem: `Incrível, <strong>${primeiroNome}</strong>! Você avançou de AZUL para <strong>PRETO</strong> na ${nomeRodada}.`,
        missao:
          'Você está a <strong>1 passo do prêmio</strong>. O próximo avanço te leva para VERDE.',
        proximoPasso:
          'Continue acompanhando a rodada. Quando os vermelhos pagarem, você será o VERDE e receberá <strong>R$ 100</strong>!',
        ctaTexto: 'ACOMPANHAR MINHA RODADA',
        ctaUrl: `${frontendUrl}/dashboard`,
        dica: 'Fique de olho no seu dashboard — você é o próximo da fila para o prêmio.'
      }
      break

    case 'verde':
      config = {
        cor: '#10B981',
        emoji: '🟢',
        titulo: 'VOCÊ É O VERDE!',
        subtitulo: `${nomeRodada} · posição de premiação`,
        heroEmoji: '🟢',
        mensagem: `<strong>${primeiroNome}, você é o VERDE!</strong> Chegou no topo da ${nomeRodada}.`,
        missao:
          'Seu prêmio de <strong>R$ 100</strong> está garantido. Falta apenas os 8 vermelhos pagarem.',
        proximoPasso:
          'Assim que o último vermelho pagar, <strong>R$ 100 serão creditados automaticamente</strong> no seu saldo. Você poderá sacar via PIX ou jogar novamente.',
        ctaTexto: 'ACOMPANHAR RODADA',
        ctaUrl: `${frontendUrl}/dashboard`,
        dica: 'Fique online! Assim que os pagamentos forem confirmados, você recebe uma notificação.'
      }
      break

    case 'vermelho':
      // Caso raro: usuário entrou como vermelho numa rodada nova
      config = {
        cor: '#ef4444',
        emoji: '💳',
        titulo: 'Você é VERMELHO!',
        subtitulo: `${nomeRodada} · falta pagar`,
        heroEmoji: '🔴',
        mensagem: `Olá <strong>${primeiroNome}</strong>! Você entrou na ${nomeRodada} como <strong>VERMELHO</strong>.`,
        missao: `Efetue o pagamento de <strong>${VALOR_VERMELHO_TEXTO}</strong> para fazer a roda girar.`,
        proximoPasso:
          'Após o pagamento, você sobe para AZUL quando todos os outros vermelhos pagarem.',
        ctaTexto: 'PAGAR AGORA',
        ctaUrl: `${frontendUrl}/dashboard`,
        dica: 'O prazo é de 1 hora. Sem pagamento, sua vaga é liberada.'
      }
      break

    default:
      config = {
        cor: '#6b7280',
        emoji: '📢',
        titulo: `Sua nova posição: ${corNova?.toUpperCase() || 'ATUALIZADA'}`,
        subtitulo: nomeRodada,
        heroEmoji: '📢',
        mensagem: `Sua cor na ${nomeRodada} mudou para <strong>${
          corNova?.toUpperCase() || '—'
        }</strong>.`,
        missao: '',
        proximoPasso: '',
        ctaTexto: 'VER MINHA POSIÇÃO',
        ctaUrl: `${frontendUrl}/dashboard`,
        dica: ''
      }
  }

  const conteudo = `
    <p style="margin:0 0 12px 0;">Olá <strong>${primeiroNome}</strong>,</p>
    <p style="margin:0 0 16px 0;font-size:16px;">${config.mensagem}</p>

    <div style="text-align:center;padding:24px 16px;margin:20px 0;background:linear-gradient(135deg,${
      config.cor
    }15,${config.cor}05);border-radius:16px;border:2px solid ${config.cor}30;">
      <div style="font-size:56px;line-height:1;margin-bottom:12px;">${
        config.heroEmoji
      }</div>
      <p style="margin:0;color:${
        config.cor
      };font-size:24px;font-weight:800;letter-spacing:-0.5px;">
        ${corNova?.toUpperCase()}
      </p>
      <p style="margin:4px 0 0 0;color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:1.5px;font-weight:700;">
        Nova posição
      </p>
    </div>

    ${
      config.missao
        ? `<div style="background:#fef3c7;border-left:4px solid #f59e0b;border-radius:8px;padding:14px 16px;margin:16px 0;">
            <p style="margin:0;color:#78350f;font-size:14px;line-height:1.5;">${config.missao}</p>
           </div>`
        : ''
    }

    ${
      config.proximoPasso
        ? `<p style="margin:12px 0;color:#374151;font-size:14px;line-height:1.6;">
            <strong>Próximo passo:</strong> ${config.proximoPasso}
           </p>`
        : ''
    }

    ${
      config.dica
        ? `<p style="margin:16px 0 0 0;color:#6b7280;font-size:13px;font-style:italic;">
            💡 ${config.dica}
           </p>`
        : ''
    }
  `

  const html = templateBase({
    cor: config.cor,
    emoji: config.emoji,
    titulo: config.titulo,
    subtitulo: config.subtitulo,
    conteudo,
    ctaTexto: config.ctaTexto,
    ctaUrl: config.ctaUrl,
    corTexto: config.cor
  })

  await transporter.sendMail({
    from: FROM(),
    to: usuario.email,
    subject: `${config.emoji} ${config.titulo} — ${nomeRodada}`,
    html
  })
  console.log(
    `[email] ✅ Progressão ${corAnterior || '?'}→${corNova} enviada para ${
      usuario.email
    }`
  )
  return true
}

// ===========================================
// EMAIL 6: Convite
// ===========================================
async function enviarEmailConvite (usuario, linkConvite) {
  const primeiroNome = usuario.nome?.split(' ')[0] || 'amigo'
  const frontendUrl = getFrontendUrl()

  const conteudo = `
    <p style="margin:0 0 12px 0;">Ola <strong>${primeiroNome}</strong>,</p>
    <p style="margin:0 0 12px 0;">Quanto mais pessoas voce convidar, mais rapido a roda gira - e mais perto voce fica do premio!</p>

    <div style="background:#f3f4f6;border-radius:8px;padding:14px;word-break:break-all;font-family:monospace;font-size:12px;color:#4b5563;margin:16px 0;">
      ${linkConvite}
    </div>

    ${boxDestaque(
      `<strong>Bonus:</strong> seus convidados entram automaticamente na sua rodada como VERMELHOS, e voce avanca de cor mais rapido!`
    )}

    <p style="margin:12px 0;">Compartilhe agora mesmo pelo WhatsApp, Email ou copie o link e envie para quem quiser:</p>
  `

  const html = templateBase({
    cor: '#8b5cf6',
    emoji: '',
    titulo: 'Convide amigos e ganhe mais rapido',
    subtitulo: 'Cada convite aproxima voce do premio',
    conteudo,
    ctaTexto: 'COMPARTILHAR MEU LINK',
    ctaUrl: `${frontendUrl}/dashboard`,
    corTexto: '#8b5cf6'
  })

  await transporter.sendMail({
    from: FROM(),
    to: usuario.email,
    subject: 'Convide amigos e acelere sua rodada!',
    html
  })
  console.log(`[email] ✅ Convite enviado para ${usuario.email}`)
}

// ===========================================
// EXPORTS
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
    if (!usuario || !rodada) throw new Error('Usuario ou rodada nao encontrado')
    await enviarEmailPremio(usuario, rodada, valor)
    return true
  } catch (error) {
    console.error('Erro ao notificar verde sobre premio:', error)
    return false
  }
}

// ===========================================
// COOLDOWN
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
// ENDPOINTS REST
// ===========================================
exports.cobrarUsuario = async (req, res) => {
  try {
    const { usuarioId } = req.params
    const { rodadaId, valor } = req.body
    if (!rodadaId)
      return res.status(400).json({ error: 'rodadaId obrigatorio' })

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
      return res.status(404).json({ error: 'Usuario ou rodada nao encontrado' })

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
    console.error('Erro ao cobrar usuario:', error)
    res.status(500).json({ error: error.message })
  }
}

exports.enviarLembrete = async (req, res) => {
  try {
    const { usuarioId } = req.params
    const { rodadaId, valor } = req.body
    if (!rodadaId)
      return res.status(400).json({ error: 'rodadaId obrigatorio' })

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
      return res.status(404).json({ error: 'Usuario ou rodada nao encontrado' })

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
    if (!rodada) return res.status(404).json({ error: 'Rodada nao encontrada' })

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
      message: `Lembretes enviados para ${resultados.length} usuario(s)`,
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
// NOTIFICACOES ADMIN
// ===========================================
exports.notificarAdminNovaSolicitacao = async (usuario, rodada, valor) => {
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@giropremiados.com.br'
  const frontendUrl = getFrontendUrl()
  const valorFmt = formatarMoeda(valor)

  const conteudo = `
    <p style="margin:0 0 12px 0;">Nova solicitacao de saque recebida.</p>
    ${boxDestaque(
      `<strong>Usuario:</strong> ${usuario.nome} (${usuario.email})<br>
       <strong>Valor:</strong> ${valorFmt}<br>
       <strong>Rodada:</strong> ${rodada.nome}<br>
       <strong>Chave PIX:</strong> ${usuario.chavePix || 'nao informada'} (${
        usuario.tipoChavePix || '-'
      })`
    )}
    <p style="margin:12px 0;">Acesse o painel admin para aprovar ou recusar.</p>
  `

  const html = templateBase({
    cor: '#3b82f6',
    emoji: '',
    titulo: 'Nova solicitacao de saque',
    subtitulo: `${valorFmt} - ${usuario.nome}`,
    conteudo,
    ctaTexto: 'ABRIR PAINEL ADMIN',
    ctaUrl: `${frontendUrl}/admin`,
    corTexto: '#3b82f6'
  })

  try {
    await transporter.sendMail({
      from: FROM(),
      to: adminEmail,
      subject: `Nova solicitacao de saque - ${valorFmt} (${usuario.nome})`,
      html
    })
    console.log(`[email] ✅ Admin notificado sobre saque de ${usuario.nome}`)
  } catch (err) {
    console.error('Erro ao notificar admin:', err.message)
  }
}

// ===========================================
// NOTIFICACOES DE SAQUE
// ===========================================
exports.notificarUsuarioSaqueAprovado = async (usuario, solicitacao) => {
  const frontendUrl = getFrontendUrl()
  const valorFmt = formatarMoeda(solicitacao.valor)
  const primeiroNome = usuario.nome?.split(' ')[0] || 'amigo'

  const conteudo = `
    <p style="margin:0 0 12px 0;">Ola <strong>${primeiroNome}</strong>,</p>
    <p style="margin:0 0 12px 0;">Boa noticia! Seu saque foi <strong>aprovado</strong> e o PIX esta a caminho.</p>

    <div style="text-align:center;background:linear-gradient(135deg,#10B981,#059669);border-radius:12px;padding:24px;margin:20px 0;">
      <p style="margin:0;color:#ffffff;font-size:14px;opacity:0.9;">Valor enviado</p>
      <p style="margin:8px 0 0 0;color:#ffffff;font-size:32px;font-weight:800;">${valorFmt}</p>
    </div>

    <p style="margin:12px 0;">O valor chegara na sua chave PIX <strong>${
      solicitacao.chavePix
    }</strong> em instantes.</p>

    ${boxDestaque(
      `<strong>E ai, vamos de novo?</strong> Voce ja tem saldo de premio - clique em "Jogar Novamente" no dashboard para continuar na roda e concorrer a mais ${PREMIO_VERDE_TEXTO}!`
    )}
  `

  const html = templateBase({
    cor: '#10B981',
    emoji: '💸',
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
    console.log(`[email] ✅ Saque aprovado enviado para ${usuario.email}`)
  } catch (err) {
    console.error(
      'Erro ao notificar usuario sobre saque aprovado:',
      err.message
    )
  }
}

exports.notificarSaqueRecusado = async (usuario, solicitacao, motivo) => {
  const frontendUrl = getFrontendUrl()
  const valorFmt = formatarMoeda(solicitacao.valor)
  const primeiroNome = usuario.nome?.split(' ')[0] || 'amigo'

  const conteudo = `
    <p style="margin:0 0 12px 0;">Ola <strong>${primeiroNome}</strong>,</p>
    <p style="margin:0 0 12px 0;">Sua solicitacao de saque no valor de <strong>${valorFmt}</strong> foi recusada pelo administrador.</p>

    ${boxDestaque(`<strong>Motivo:</strong> ${motivo || 'Nao informado'}`, {
      cor: '#fee2e2',
      borda: '#ef4444',
      textoCor: '#991b1b'
    })}

    <p style="margin:12px 0;">O valor permanece no seu saldo de premios. Voce pode solicitar um novo saque a qualquer momento.</p>
  `

  const html = templateBase({
    cor: '#ef4444',
    emoji: '❌',
    titulo: 'Seu saque foi recusado',
    subtitulo: `${valorFmt} - ${solicitacao.rodada?.nome || 'Rodada'}`,
    conteudo,
    ctaTexto: 'VOLTAR AO DASHBOARD',
    ctaUrl: `${frontendUrl}/dashboard`,
    corTexto: '#ef4444'
  })

  try {
    await transporter.sendMail({
      from: FROM(),
      to: usuario.email,
      subject: `Saque de ${valorFmt} recusado - veja o motivo`,
      html
    })
    console.log(`[email] ✅ Saque recusado enviado para ${usuario.email}`)
  } catch (err) {
    console.error('Erro ao notificar recusa de saque:', err.message)
  }
}
