const User = require('../models/User')
const Rodada = require('../models/Rodada')
const jwt = require('jsonwebtoken')
const bcrypt = require('bcryptjs')
const crypto = require('crypto')
const mongoose = require('mongoose')
const RodadaService = require('../services/rodadaService')
const SolicitacaoSaque = require('../models/SolicitacaoSaque')
const nodemailer = require('nodemailer')

// NOVO: serviços de engajamento
const emailController = require('./emailController')
const pushService = require('../services/pushService')
const activityService = require('../services/activityService')
const notificationService = require('../services/notificationService')

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.hostinger.com',
  port: parseInt(process.env.SMTP_PORT) || 465,
  secure: process.env.SMTP_SECURE === 'true',
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
})

const gerarToken = id =>
  jwt.sign({ id }, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' })

async function getProximaPosicaoFila () {
  try {
    const ultimoNaFila = await User.findOne({ aguardandoVermelho: true }).sort({
      posicaoFila: -1
    })
    return ultimoNaFila ? ultimoNaFila.posicaoFila + 1 : 1
  } catch (error) {
    console.error('Erro ao buscar próxima posição na fila:', error)
    return 1
  }
}

function rodadaPodeReceberVermelho (rodada) {
  if (!rodada) return false
  const temEstrutura = !!(
    rodada.verde &&
    Array.isArray(rodada.pretos) &&
    rodada.pretos.length === 2 &&
    Array.isArray(rodada.azuis) &&
    rodada.azuis.length === 4
  )
  const podeReceber =
    rodada.status === 'em_andamento' ||
    (rodada.status === 'aguardando' && temEstrutura)
  const vagasVermelho =
    8 - (rodada.participantes?.filter(p => p.cor === 'vermelho').length || 0)
  return podeReceber && vagasVermelho > 0
}

async function buscarRodadaDisponivelParaNovoUsuario () {
  try {
    console.log(`\n🔍 [SEM CONVITE] Buscando rodada disponível...`)
    const rodadaEmAndamento = await Rodada.findOne({
      status: 'em_andamento',
      $expr: {
        $lt: [
          {
            $size: {
              $filter: {
                input: '$participantes',
                as: 'p',
                cond: { $eq: ['$$p.cor', 'vermelho'] }
              }
            }
          },
          8
        ]
      }
    }).sort({ createdAt: 1 })
    if (rodadaEmAndamento && rodadaPodeReceberVermelho(rodadaEmAndamento))
      return { rodada: rodadaEmAndamento, podeAdicionar: true }

    const rodadaAguardandoComEstrutura = await Rodada.findOne({
      status: 'aguardando',
      verde: { $exists: true, $ne: null },
      pretos: { $exists: true, $ne: [] },
      azuis: { $exists: true, $ne: [] },
      $expr: {
        $lt: [
          {
            $size: {
              $filter: {
                input: '$participantes',
                as: 'p',
                cond: { $eq: ['$$p.cor', 'vermelho'] }
              }
            }
          },
          8
        ]
      }
    }).sort({ createdAt: 1 })
    if (
      rodadaAguardandoComEstrutura &&
      rodadaPodeReceberVermelho(rodadaAguardandoComEstrutura)
    )
      return { rodada: rodadaAguardandoComEstrutura, podeAdicionar: true }

    console.log(
      `⚠️ [SEM CONVITE] Nenhuma rodada com vaga disponível. Usuario entrara na FILA DE ESPERA.`
    )
    return { rodada: null, podeAdicionar: false }
  } catch (error) {
    console.error('❌ [SEM CONVITE] Erro ao buscar rodada:', error)
    return { rodada: null, podeAdicionar: false }
  }
}

// ===========================================
// REGISTRAR — nome, email, cpf, senha (+ codigoConvite opcional)
// ===========================================
exports.registrar = async (req, res) => {
  try {
    console.log('📝 Registro recebido:', {
      nome: req.body?.nome,
      email: req.body?.email,
      cpf: req.body?.cpf,
      temSenha: !!req.body?.senha,
      codigoConvite: req.body?.codigoConvite
    })

    const { nome, email, cpf, senha, codigoConvite } = req.body

    // ---- Validações de entrada ----
    if (!nome || !email || !cpf || !senha) {
      return res.status(400).json({
        success: false,
        error: 'Nome, email, CPF e senha são obrigatórios'
      })
    }

    if (String(senha).length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Senha deve ter pelo menos 6 caracteres'
      })
    }

    const cpfLimpo = String(cpf).replace(/\D/g, '')
    if (cpfLimpo.length !== 11) {
      return res.status(400).json({
        success: false,
        error: 'CPF deve ter 11 dígitos'
      })
    }

    const emailNormalizado = String(email).trim().toLowerCase()
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(emailNormalizado)) {
      return res.status(400).json({
        success: false,
        error: 'Email inválido'
      })
    }

    // ---- Verifica duplicidade ----
    const existe = await User.findOne({
      $or: [{ email: emailNormalizado }, { cpf: cpfLimpo }]
    })
    if (existe) {
      const campo = existe.email === emailNormalizado ? 'Email' : 'CPF'
      return res
        .status(400)
        .json({ success: false, error: `${campo} já cadastrado` })
    }

    // ---- Cria usuário ----
    const salt = await bcrypt.genSalt(10)
    const senhaHash = await bcrypt.hash(senha, salt)

    const usuario = new User({
      nome: nome.trim(),
      email: emailNormalizado,
      cpf: cpfLimpo,
      senha: senhaHash,
      // NOVO: marca onboarding como não concluído
      onboardingCompleto: false,
      ultimoAcesso: new Date()
    })
    usuario.codigoConvite =
      'CONVITE-' + Math.random().toString(36).substring(2, 10).toUpperCase()
    await usuario.save()
    console.log(`Usuário ${usuario.nome} salvo com ID: ${usuario._id}`)

    // ===========================================
    // LÓGICA DE FILA / RODADA / INDICAÇÃO
    // ===========================================
    let indicador = null,
      rodadaAdicionada = null,
      mensagemAuto = null,
      corAdicionado = null,
      rodadaIdAdicionada = null,
      entrouNaFila = false,
      posicaoFila = null,
      dadosPagamento = null

    if (codigoConvite) {
      console.log(`\n🔗 [COM CONVITE] Código recebido: ${codigoConvite}`)
      indicador = await User.findOne({ codigoConvite })
      if (indicador) {
        console.log(`[COM CONVITE] Indicador encontrado: ${indicador.nome}`)
        usuario.indicadoPor = indicador._id
        await User.findByIdAndUpdate(indicador._id, {
          $push: { meusIndicados: usuario._id },
          $inc: { totalIndicacoes: 1 }
        })

        // NOVO: notifica indicador (in-app + push + activity)
        const primeiroNomeIndicado = usuario.nome.split(' ')[0]
        notificationService
          .novoIndicado(indicador._id, primeiroNomeIndicado)
          .catch(err => console.error('❌ [notif] novoIndicado:', err.message))
        pushService
          .enviarParaUsuario(
            indicador._id,
            pushService.templates.novoIndicado(primeiroNomeIndicado)
          )
          .catch(err => console.error('❌ [push] novoIndicado:', err.message))
        activityService
          .novoIndicado(indicador._id, indicador.nome, usuario.nome)
          .catch(err =>
            console.error('❌ [activity] novoIndicado:', err.message)
          )

        let rodadaDoIndicador =
          await RodadaService.buscarRodadaParaNovoVermelho(
            indicador._id.toString()
          )
        if (rodadaDoIndicador && rodadaPodeReceberVermelho(rodadaDoIndicador)) {
          try {
            const resultado = await RodadaService.adicionarParticipanteVermelho(
              rodadaDoIndicador._id.toString(),
              usuario._id.toString(),
              indicador._id.toString()
            )
            rodadaAdicionada = rodadaDoIndicador.nome
            corAdicionado = 'vermelho'
            rodadaIdAdicionada = rodadaDoIndicador._id
            entrouNaFila = false
            if (resultado.transacao) {
              dadosPagamento = resultado.transacao
              mensagemAuto = `Adicionado como VERMELHO na rodada ${rodadaDoIndicador.nome}. Efetue o pagamento de R$ ${dadosPagamento.valor} para confirmar.`
            } else
              mensagemAuto = `Adicionado como VERMELHO na rodada ${rodadaDoIndicador.nome}, mas não foi possível gerar o QR Code. Entre em contato.`
          } catch (error) {
            console.error('❌ Erro ao adicionar como vermelho:', error)
            usuario.aguardandoVermelho = true
            posicaoFila = await getProximaPosicaoFila()
            usuario.posicaoFila = posicaoFila
            usuario.dataEntradaFila = new Date()
            await usuario.save()
            entrouNaFila = true
            mensagemAuto = `Erro ao adicionar à rodada. Você foi colocado na FILA DE ESPERA, posição ${posicaoFila}.`
          }
        } else {
          usuario.aguardandoVermelho = true
          posicaoFila = await getProximaPosicaoFila()
          usuario.posicaoFila = posicaoFila
          usuario.dataEntradaFila = new Date()
          await usuario.save()
          entrouNaFila = true
          mensagemAuto = `A rodada do seu convidante não pode receber mais vermelhos. Você foi colocado na FILA DE ESPERA, posição ${posicaoFila}.`
        }
      } else {
        console.log(
          `⚠️ [COM CONVITE] Código ${codigoConvite} não encontrado. Tratando como cadastro sem convite...`
        )
        const { rodada, podeAdicionar } =
          await buscarRodadaDisponivelParaNovoUsuario()
        if (rodada && podeAdicionar) {
          try {
            const resultado = await RodadaService.adicionarParticipanteVermelho(
              rodada._id.toString(),
              usuario._id.toString(),
              null
            )
            rodadaAdicionada = rodada.nome
            corAdicionado = 'vermelho'
            rodadaIdAdicionada = rodada._id
            entrouNaFila = false
            if (resultado.transacao) {
              dadosPagamento = resultado.transacao
              mensagemAuto = `Adicionado como VERMELHO na rodada ${rodada.nome}. Efetue o pagamento de R$ ${dadosPagamento.valor}.`
            } else
              mensagemAuto = `Adicionado como VERMELHO na rodada ${rodada.nome}, mas QR Code não gerado.`
          } catch (error) {
            usuario.aguardandoVermelho = true
            posicaoFila = await getProximaPosicaoFila()
            usuario.posicaoFila = posicaoFila
            usuario.dataEntradaFila = new Date()
            await usuario.save()
            entrouNaFila = true
            mensagemAuto = `Erro ao adicionar. Você foi colocado na FILA DE ESPERA, posição ${posicaoFila}.`
          }
        } else {
          usuario.aguardandoVermelho = true
          posicaoFila = await getProximaPosicaoFila()
          usuario.posicaoFila = posicaoFila
          usuario.dataEntradaFila = new Date()
          await usuario.save()
          entrouNaFila = true
          mensagemAuto = `Nenhuma vaga disponível. Você está na FILA DE ESPERA, posição ${posicaoFila}.`
        }
      }
    } else {
      console.log(
        `\n🚫 [SEM CONVITE] Usuário cadastrando sem código de convite`
      )
      const { rodada, podeAdicionar } =
        await buscarRodadaDisponivelParaNovoUsuario()
      if (rodada && podeAdicionar) {
        try {
          const resultado = await RodadaService.adicionarParticipanteVermelho(
            rodada._id.toString(),
            usuario._id.toString(),
            null
          )
          rodadaAdicionada = rodada.nome
          corAdicionado = 'vermelho'
          rodadaIdAdicionada = rodada._id
          entrouNaFila = false
          if (resultado.transacao) {
            dadosPagamento = resultado.transacao
            mensagemAuto = `Adicionado como VERMELHO na rodada ${rodada.nome}. Efetue o pagamento de R$ ${dadosPagamento.valor}.`
          } else
            mensagemAuto = `Adicionado como VERMELHO na rodada ${rodada.nome}, mas QR Code não gerado.`
        } catch (error) {
          usuario.aguardandoVermelho = true
          posicaoFila = await getProximaPosicaoFila()
          usuario.posicaoFila = posicaoFila
          usuario.dataEntradaFila = new Date()
          await usuario.save()
          entrouNaFila = true
          mensagemAuto = `Erro ao adicionar. Você foi colocado na FILA DE ESPERA, posição ${posicaoFila}.`
        }
      } else {
        usuario.aguardandoVermelho = true
        posicaoFila = await getProximaPosicaoFila()
        usuario.posicaoFila = posicaoFila
        usuario.dataEntradaFila = new Date()
        await usuario.save()
        entrouNaFila = true
        mensagemAuto = `Nenhuma vaga disponível. Você está na FILA DE ESPERA, posição ${posicaoFila}.`
      }
    }

    // ===========================================
    // NOVO: ENVIO DE EMAILS E NOTIFICAÇÕES (não bloqueiam a resposta)
    // ===========================================
    // 1. Boas-vindas (sempre)
    emailController
      .enviarEmailBoasVindas(usuario, { entrouNaFila, posicaoFila })
      .catch(err => console.error('❌ [email] Boas-vindas:', err.message))

    // 2. QR Code PIX (se gerou)
    if (dadosPagamento && usuario.email) {
      const rodadaPopulada = rodadaIdAdicionada
        ? await Rodada.findById(rodadaIdAdicionada).select('nome').lean()
        : null
      emailController
        .enviarEmailQrCodePix(
          usuario,
          { _id: dadosPagamento.id },
          dadosPagamento.qrCode,
          dadosPagamento.qrCodeImage,
          dadosPagamento.valor,
          rodadaPopulada
        )
        .catch(err => console.error('❌ [email] QR Code:', err.message))
    }

    // 3. Activity log (entrada na rodada)
    if (rodadaIdAdicionada) {
      activityService
        .entrada(usuario._id, usuario.nome, rodadaIdAdicionada)
        .catch(() => {})
    }

    // ===========================================
    // RESPOSTA
    // ===========================================
    const token = gerarToken(usuario._id)
    const response = {
      success: true,
      token,
      usuario: {
        id: usuario._id,
        nome: usuario.nome,
        email: usuario.email,
        cpf: usuario.cpf,
        codigoConvite: usuario.codigoConvite,
        // NOVO
        onboardingCompleto: usuario.onboardingCompleto || false
      },
      entrouNaFila,
      posicaoFila,
      automatico: !!rodadaAdicionada,
      mensagem: mensagemAuto
    }
    if (rodadaAdicionada && corAdicionado) {
      response.rodadaId = rodadaIdAdicionada
      response.corAtribuida = corAdicionado
    }
    if (dadosPagamento) {
      response.pagamento = {
        transacaoId: dadosPagamento.id,
        qrCode: dadosPagamento.qrCode,
        qrCodeImage: dadosPagamento.qrCodeImage,
        valor: dadosPagamento.valor,
        expiraEm: dadosPagamento.expiraEm
      }
    }

    console.log(`\nREGISTRO CONCLUÍDO COM SUCESSO!`)
    console.log(`   Usuário: ${usuario.nome}`)
    console.log(`   Email: ${usuario.email}`)
    console.log(`   CPF: ${usuario.cpf}`)
    console.log(`   Entrou na fila: ${entrouNaFila ? 'SIM' : 'NÃO'}`)
    console.log(`   Posição na fila: ${posicaoFila || 'N/A'}`)
    console.log(`   Rodada: ${rodadaAdicionada || 'Nenhuma'}`)
    console.log(`   Cor: ${corAdicionado || 'Nenhuma'}`)
    console.log(`   Pagamento: ${dadosPagamento ? 'QR Code gerado' : 'Nenhum'}`)
    res.status(201).json(response)
  } catch (error) {
    console.error('❌ Erro no registro:', error)

    if (error.code === 11000) {
      const campo = Object.keys(error.keyPattern || {})[0] || 'campo'
      return res.status(400).json({
        success: false,
        error: `${campo === 'cpf' ? 'CPF' : 'Email'} já cadastrado`
      })
    }

    res.status(500).json({
      success: false,
      error:
        process.env.NODE_ENV === 'development'
          ? error.message
          : 'Erro interno no servidor'
    })
  }
}

// ===========================================
// LOGIN — aceita email ou cpf + senha
// ===========================================
exports.login = async (req, res) => {
  try {
    const { email, cpf, senha } = req.body

    if ((!email && !cpf) || !senha) {
      return res.status(400).json({
        success: false,
        error: 'Informe email (ou CPF) e senha'
      })
    }

    let query = null
    if (email) {
      query = { email: String(email).trim().toLowerCase() }
    } else {
      const cpfLimpo = String(cpf).replace(/\D/g, '')
      if (cpfLimpo.length !== 11) {
        return res.status(400).json({ success: false, error: 'CPF inválido' })
      }
      query = { cpf: cpfLimpo }
    }

    const usuario = await User.findOne(query)
    if (!usuario) {
      return res
        .status(401)
        .json({ success: false, error: 'Credenciais inválidas' })
    }

    const senhaCorreta = await bcrypt.compare(senha, usuario.senha)
    if (!senhaCorreta) {
      return res
        .status(401)
        .json({ success: false, error: 'Credenciais inválidas' })
    }

    // NOVO: atualiza último acesso
    User.updateOne(
      { _id: usuario._id },
      { $set: { ultimoAcesso: new Date() } }
    ).catch(() => {})

    const token = gerarToken(usuario._id)
    return res.status(200).json({
      success: true,
      token,
      usuario: {
        id: usuario._id,
        nome: usuario.nome,
        email: usuario.email,
        cpf: usuario.cpf,
        codigoConvite: usuario.codigoConvite,
        role: usuario.role,
        // NOVO
        onboardingCompleto: usuario.onboardingCompleto || false
      }
    })
  } catch (error) {
    console.error('Erro no login:', error)
    return res.status(500).json({
      success: false,
      error: 'Erro interno no servidor. Tente novamente mais tarde.'
    })
  }
}

// ===========================================
// GET ME
// ===========================================
exports.getMe = async (req, res) => {
  try {
    const usuario = await User.findById(req.usuarioId)
      .select('-senha')
      .populate('indicadoPor', 'nome email')
      .populate('meusIndicados', 'nome email createdAt')
    if (!usuario)
      return res
        .status(404)
        .json({ success: false, error: 'Usuário não encontrado' })
    const solicitacaoPendente = await SolicitacaoSaque.findOne({
      usuario: req.usuarioId,
      status: 'pendente'
    })
    const podeSacar = !solicitacaoPendente && usuario.saldoPremio > 0
    const rodadaAtiva = await RodadaService.buscarRodadaAtivaDoUsuario(
      req.usuarioId
    )
    const estaEmRodadaAtiva = !!rodadaAtiva
    const podeJogarNovamente = !estaEmRodadaAtiva && !usuario.aguardandoVermelho
    const usuarioObj = usuario.toObject()
    usuarioObj.naFilaEspera = usuario.aguardandoVermelho === true
    usuarioObj.posicaoFila = usuario.posicaoFila || null
    usuarioObj.podeSacar = podeSacar
    usuarioObj.saldoPremio = usuario.saldoPremio
    usuarioObj.estaEmRodadaAtiva = estaEmRodadaAtiva
    usuarioObj.podeJogarNovamente = podeJogarNovamente
    res.json({ success: true, data: usuarioObj })
  } catch (error) {
    console.error('Erro no getMe:', error)
    res.status(500).json({
      success: false,
      error:
        process.env.NODE_ENV === 'development'
          ? error.message
          : 'Erro interno no servidor'
    })
  }
}

// ===========================================
// FORGOT PASSWORD
// ===========================================
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body
    if (!email)
      return res
        .status(400)
        .json({ success: false, error: 'Email é obrigatório' })
    const usuario = await User.findOne({
      email: String(email).trim().toLowerCase()
    })
    if (!usuario)
      return res.status(200).json({
        success: true,
        message: 'Se o email existir, enviaremos um link de recuperação'
      })
    const token = crypto.randomBytes(32).toString('hex')
    const expires = new Date()
    expires.setHours(expires.getHours() + 1)
    usuario.resetPasswordToken = token
    usuario.resetPasswordExpires = expires
    await usuario.save()

    const resetUrl = `${
      process.env.FRONTEND_URL || 'https://giropremiados.com.br'
    }/reset-password?token=${token}`

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f9fafb;padding:24px;border-radius:12px;">
        <div style="background:linear-gradient(135deg,#10B981,#059669);padding:24px;border-radius:12px 12px 0 0;text-align:center;">
          <h1 style="color:#fff;margin:0;font-size:22px;">🔐 Recuperação de Senha</h1>
        </div>
        <div style="background:#fff;padding:28px;border-radius:0 0 12px 12px;">
          <p>Olá <strong>${usuario.nome}</strong>,</p>
          <p>Você solicitou a recuperação de senha da sua conta no Giro Premiado.</p>
          <p>Clique no botão abaixo para criar uma nova senha. O link é válido por <strong>1 hora</strong>:</p>
          <div style="text-align:center;margin:28px 0;">
            <a href="${resetUrl}" style="display:inline-block;background:#10B981;color:#fff;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:bold;">REDEFINIR SENHA</a>
          </div>
          <p style="color:#6b7280;font-size:13px;">Se você não solicitou isso, ignore este email.</p>
          <p style="color:#9ca3af;font-size:12px;margin-top:24px;">Link direto: <br>${resetUrl}</p>
        </div>
      </div>
    `

    await transporter.sendMail({
      from: `"Giro Premiado" <${
        process.env.SMTP_USER || 'naoresponder@giropremiados.com.br'
      }>`,
      to: usuario.email,
      subject: '🔐 Recuperação de Senha - Giro Premiado',
      html
    })
    res.json({
      success: true,
      message: 'Email de recuperação enviado com sucesso'
    })
  } catch (error) {
    console.error('Erro no forgotPassword:', error)
    res.status(500).json({
      success: false,
      error: 'Erro ao enviar email de recuperação. Tente novamente.'
    })
  }
}

// ===========================================
// RESET PASSWORD
// ===========================================
exports.resetPassword = async (req, res) => {
  try {
    const { token, senha } = req.body
    if (!token || !senha)
      return res
        .status(400)
        .json({ success: false, error: 'Token e nova senha são obrigatórios' })

    if (senha.length < 6)
      return res.status(400).json({
        success: false,
        error: 'A senha deve ter pelo menos 6 caracteres'
      })

    const usuario = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: new Date() }
    })
    if (!usuario)
      return res.status(400).json({
        success: false,
        error:
          'Token inválido ou expirado. Solicite um novo link de recuperação.'
      })
    const salt = await bcrypt.genSalt(10)
    const senhaHash = await bcrypt.hash(senha, salt)
    usuario.senha = senhaHash
    usuario.resetPasswordToken = undefined
    usuario.resetPasswordExpires = undefined
    await usuario.save()
    res.json({ success: true, message: 'Senha redefinida com sucesso' })
  } catch (error) {
    console.error('Erro no resetPassword:', error)
    res.status(500).json({
      success: false,
      error: 'Erro ao redefinir senha. Tente novamente.'
    })
  }
}
