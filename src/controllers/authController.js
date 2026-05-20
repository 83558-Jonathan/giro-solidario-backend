const User = require('../models/User')
const Rodada = require('../models/Rodada')
const jwt = require('jsonwebtoken')
const bcrypt = require('bcryptjs')
const crypto = require('crypto')
const mongoose = require('mongoose')
const RodadaService = require('../services/rodadaService')
const SolicitacaoSaque = require('../models/SolicitacaoSaque')

// Configuracao de email
const nodemailer = require('nodemailer')

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.hostinger.com',
  port: parseInt(process.env.SMTP_PORT) || 465,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
})

const gerarToken = id => {
  return jwt.sign({ id }, process.env.JWT_SECRET || 'secret', {
    expiresIn: '7d'
  })
}

// ===========================================
// FUNÇÃO AUXILIAR: Buscar próxima posição na fila
// ===========================================
async function getProximaPosicaoFila () {
  try {
    const ultimoNaFila = await User.findOne({
      aguardandoVermelho: true
    }).sort({ posicaoFila: -1 })

    return ultimoNaFila ? ultimoNaFila.posicaoFila + 1 : 1
  } catch (error) {
    console.error('Erro ao buscar próxima posição na fila:', error)
    return 1
  }
}

// ===========================================
// FUNÇÃO AUXILIAR: Verifica se rodada pode receber vermelho
// ===========================================
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

// ===========================================
// FUNÇÃO AUXILIAR: Buscar rodada disponível para usuário SEM convite
// ===========================================
async function buscarRodadaDisponivelParaNovoUsuario () {
  try {
    console.log(`\n🔍 [SEM CONVITE] Buscando rodada disponível...`)

    // PRIORIDADE 1: Rodada em andamento com vaga para vermelho (menos de 8 vermelhos)
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

    if (rodadaEmAndamento && rodadaPodeReceberVermelho(rodadaEmAndamento)) {
      const vermelhosAtuais = rodadaEmAndamento.participantes.filter(
        p => p.cor === 'vermelho'
      ).length
      console.log(
        `✅ [SEM CONVITE] Rodada encontrada: ${rodadaEmAndamento.nome}`
      )
      console.log(`   Status: em_andamento, Vermelhos: ${vermelhosAtuais}/8`)
      console.log(`   → Usuário será adicionado como VERMELHO`)
      return { rodada: rodadaEmAndamento, podeAdicionar: true }
    }

    // PRIORIDADE 2: Rodada aguardando com estrutura (pode receber vermelho)
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
    ) {
      const vermelhosAtuais = rodadaAguardandoComEstrutura.participantes.filter(
        p => p.cor === 'vermelho'
      ).length
      console.log(
        `✅ [SEM CONVITE] Rodada com estrutura encontrada: ${rodadaAguardandoComEstrutura.nome}`
      )
      console.log(`   Status: aguardando, Vermelhos: ${vermelhosAtuais}/8`)
      console.log(`   → Usuário será adicionado como VERMELHO`)
      return { rodada: rodadaAguardandoComEstrutura, podeAdicionar: true }
    }

    // PRIORIDADE 3: Rodada aguardando em formação (sem estrutura) – NÃO adicionar usuário
    const rodadaAguardando = await Rodada.findOne({
      status: 'aguardando',
      $expr: { $lt: [{ $size: '$participantes' }, 15] }
    }).sort({ createdAt: 1 })

    if (rodadaAguardando) {
      console.log(
        `⚠️ [SEM CONVITE] Rodada em formação encontrada: ${rodadaAguardando.nome}, mas sem estrutura. Usuário irá para a fila.`
      )
    }

    // PRIORIDADE 4: Nenhuma rodada com vaga → ir para FILA
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
// REGISTRAR (CORRIGIDO - RETORNA QR CODE)
// ===========================================
exports.registrar = async (req, res) => {
  try {
    console.log('📝 Registro recebido:', req.body)

    const {
      nome,
      email,
      telefone,
      cpf,
      chavePix,
      tipoChavePix,
      senha,
      codigoConvite
    } = req.body

    // Validação de campos obrigatórios
    if (
      !nome ||
      !email ||
      !telefone ||
      !cpf ||
      !chavePix ||
      !tipoChavePix ||
      !senha
    ) {
      return res.status(400).json({
        success: false,
        error: 'Todos os campos são obrigatórios'
      })
    }

    // Verificar se usuário já existe
    const existe = await User.findOne({ $or: [{ email }, { cpf }] })
    if (existe) {
      return res
        .status(400)
        .json({ success: false, error: 'Usuário já existe' })
    }

    // Hash da senha
    const salt = await bcrypt.genSalt(10)
    const senhaHash = await bcrypt.hash(senha, salt)

    // Criar usuário
    const usuario = new User({
      nome,
      email,
      telefone,
      cpf,
      chavePix,
      tipoChavePix,
      senha: senhaHash
    })

    usuario.codigoConvite =
      'CONVITE-' + Math.random().toString(36).substring(2, 10).toUpperCase()

    // Salvar usuário
    await usuario.save()
    console.log(`✅ Usuário ${usuario.nome} salvo com ID: ${usuario._id}`)

    let indicador = null
    let rodadaAdicionada = null
    let mensagemAuto = null
    let corAdicionado = null
    let rodadaIdAdicionada = null
    let entrouNaFila = false
    let posicaoFila = null
    let dadosPagamento = null // NOVO: armazenar dados do PIX

    // ===========================================
    // CASO 1: Usuário tem código de convite
    // ===========================================
    if (codigoConvite) {
      console.log(`\n🔗 [COM CONVITE] Código recebido: ${codigoConvite}`)

      indicador = await User.findOne({ codigoConvite })

      if (indicador) {
        console.log(`✅ [COM CONVITE] Indicador encontrado: ${indicador.nome}`)
        usuario.indicadoPor = indicador._id

        await User.findByIdAndUpdate(indicador._id, {
          $push: { meusIndicados: usuario._id },
          $inc: { totalIndicacoes: 1 }
        })

        // Buscar rodada do indicador
        let rodadaDoIndicador =
          await RodadaService.buscarRodadaParaNovoVermelho(
            indicador._id.toString()
          )

        if (rodadaDoIndicador && rodadaPodeReceberVermelho(rodadaDoIndicador)) {
          const vermelhosAtuais = rodadaDoIndicador.participantes.filter(
            p => p.cor === 'vermelho'
          ).length
          console.log(
            `\n📋 Processando convite para rodada: ${rodadaDoIndicador.nome}`
          )
          console.log(`   Vermelhos atuais: ${vermelhosAtuais}/8`)
          console.log(
            `🔴 Adicionando ${usuario.nome} como VERMELHO na rodada ${rodadaDoIndicador.nome}`
          )

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
              mensagemAuto = `✅ Adicionado como VERMELHO na rodada ${rodadaDoIndicador.nome}. Efetue o pagamento de R$ ${dadosPagamento.valor} para confirmar.`
            } else {
              mensagemAuto = `✅ Adicionado como VERMELHO na rodada ${rodadaDoIndicador.nome}, mas não foi possível gerar o QR Code. Entre em contato.`
            }

            console.log(
              `✅ Usuário ${usuario.nome} adicionado como VERMELHO à rodada ${rodadaDoIndicador.nome}`
            )
          } catch (error) {
            console.error('❌ Erro ao adicionar como vermelho:', error)
            mensagemAuto = `Erro ao adicionar na rodada: ${error.message}`
            // Fallback: colocar na fila
            usuario.aguardandoVermelho = true
            posicaoFila = await getProximaPosicaoFila()
            usuario.posicaoFila = posicaoFila
            usuario.dataEntradaFila = new Date()
            await usuario.save()
            entrouNaFila = true
            rodadaAdicionada = null
            corAdicionado = null
            mensagemAuto = `Erro ao adicionar à rodada. Você foi colocado na FILA DE ESPERA, posição ${posicaoFila}.`
          }
        } else {
          // Não pode adicionar como vermelho → fila
          console.log(
            `⚠️ Rodada do indicador não disponível para receber vermelho. Indo para fila.`
          )
          usuario.aguardandoVermelho = true
          posicaoFila = await getProximaPosicaoFila()
          usuario.posicaoFila = posicaoFila
          usuario.dataEntradaFila = new Date()
          await usuario.save()
          entrouNaFila = true
          rodadaAdicionada = null
          corAdicionado = null
          mensagemAuto = `A rodada do seu convidante não pode receber mais vermelhos. Você foi colocado na FILA DE ESPERA, posição ${posicaoFila}.`
          console.log(
            `✅ Usuario ${usuario.nome} colocado na fila de espera (posição ${posicaoFila})`
          )
        }
      } else {
        console.log(
          `⚠️ [COM CONVITE] Código ${codigoConvite} não encontrado. Tratando como cadastro sem convite...`
        )
        // Código inválido - tratar como cadastro sem convite
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
              mensagemAuto = `✅ Adicionado como VERMELHO na rodada ${rodada.nome}. Efetue o pagamento de R$ ${dadosPagamento.valor}.`
            } else {
              mensagemAuto = `✅ Adicionado como VERMELHO na rodada ${rodada.nome}, mas QR Code não gerado.`
            }
            console.log(
              `✅ Usuário ${usuario.nome} adicionado como VERMELHO à rodada ${rodada.nome}`
            )
          } catch (error) {
            console.error('❌ Erro ao adicionar como vermelho:', error)
            usuario.aguardandoVermelho = true
            posicaoFila = await getProximaPosicaoFila()
            usuario.posicaoFila = posicaoFila
            usuario.dataEntradaFila = new Date()
            await usuario.save()
            entrouNaFila = true
            mensagemAuto = `Erro ao adicionar. Você foi colocado na FILA DE ESPERA, posição ${posicaoFila}.`
          }
        } else {
          // Vai para fila
          usuario.aguardandoVermelho = true
          posicaoFila = await getProximaPosicaoFila()
          usuario.posicaoFila = posicaoFila
          usuario.dataEntradaFila = new Date()
          await usuario.save()
          entrouNaFila = true
          mensagemAuto = `Nenhuma vaga disponível. Você está na FILA DE ESPERA, posição ${posicaoFila}.`
          console.log(
            `✅ Usuario ${usuario.nome} colocado na fila de espera (posição ${posicaoFila})`
          )
        }
      }
    }

    // ===========================================
    // CASO 2: Usuário SEM código de convite (cadastro direto)
    // ===========================================
    else {
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
            mensagemAuto = `✅ Adicionado como VERMELHO na rodada ${rodada.nome}. Efetue o pagamento de R$ ${dadosPagamento.valor}.`
          } else {
            mensagemAuto = `✅ Adicionado como VERMELHO na rodada ${rodada.nome}, mas QR Code não gerado.`
          }
          console.log(
            `✅ [SEM CONVITE] Usuário ${usuario.nome} adicionado como VERMELHO à rodada ${rodada.nome}`
          )
        } catch (error) {
          console.error('❌ Erro ao adicionar como vermelho:', error)
          usuario.aguardandoVermelho = true
          posicaoFila = await getProximaPosicaoFila()
          usuario.posicaoFila = posicaoFila
          usuario.dataEntradaFila = new Date()
          await usuario.save()
          entrouNaFila = true
          mensagemAuto = `Erro ao adicionar. Você foi colocado na FILA DE ESPERA, posição ${posicaoFila}.`
        }
      } else {
        // Vai para fila
        usuario.aguardandoVermelho = true
        posicaoFila = await getProximaPosicaoFila()
        usuario.posicaoFila = posicaoFila
        usuario.dataEntradaFila = new Date()
        await usuario.save()
        entrouNaFila = true
        mensagemAuto = `Nenhuma vaga disponível. Você está na FILA DE ESPERA, posição ${posicaoFila}.`
        console.log(
          `✅ [SEM CONVITE] Usuario ${usuario.nome} colocado na fila de espera (posição ${posicaoFila})`
        )
      }
    }

    // Gerar token
    const token = gerarToken(usuario._id)

    // ===========================================
    // MONTAR RESPOSTA COMPLETA (COM PAGAMENTO)
    // ===========================================
    const response = {
      success: true,
      token,
      usuario: {
        id: usuario._id,
        nome: usuario.nome,
        email: usuario.email,
        codigoConvite: usuario.codigoConvite
      },
      entrouNaFila: entrouNaFila,
      posicaoFila: posicaoFila,
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

    console.log(`\n✅ REGISTRO CONCLUÍDO COM SUCESSO!`)
    console.log(`   Usuário: ${usuario.nome}`)
    console.log(`   Entrou na fila: ${entrouNaFila ? 'SIM' : 'NÃO'}`)
    console.log(`   Posição na fila: ${posicaoFila || 'N/A'}`)
    console.log(`   Rodada: ${rodadaAdicionada || 'Nenhuma'}`)
    console.log(`   Cor: ${corAdicionado || 'Nenhuma'}`)
    console.log(`   Pagamento: ${dadosPagamento ? 'QR Code gerado' : 'Nenhum'}`)
    console.log(`${'='.repeat(60)}\n`)

    res.status(201).json(response)
  } catch (error) {
    console.error('❌ Erro no registro:', error)
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
// LOGIN
// ===========================================
exports.login = async (req, res) => {
  try {
    const { email, senha } = req.body

    console.log('Tentativa de login:', { email })

    if (!email || !senha) {
      console.log('Campos faltando')
      return res.status(400).json({
        success: false,
        error: 'Email e senha são obrigatórios'
      })
    }

    const usuario = await User.findOne({ email })

    if (!usuario) {
      console.log('Usuário não encontrado:', email)
      return res.status(401).json({
        success: false,
        error: 'Email ou senha inválidos'
      })
    }

    const senhaCorreta = await bcrypt.compare(senha, usuario.senha)

    if (!senhaCorreta) {
      console.log('Senha incorreta para:', email)
      return res.status(401).json({
        success: false,
        error: 'Email ou senha inválidos'
      })
    }

    console.log('Login bem sucedido:', email)

    const token = gerarToken(usuario._id)

    return res.status(200).json({
      success: true,
      token,
      usuario: {
        id: usuario._id,
        nome: usuario.nome,
        email: usuario.email,
        codigoConvite: usuario.codigoConvite,
        role: usuario.role
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
// GET ME - COM STATUS DE FILA E PERMISSÃO DE SAQUE
// ===========================================
exports.getMe = async (req, res) => {
  try {
    const usuario = await User.findById(req.usuarioId)
      .select('-senha')
      .populate('indicadoPor', 'nome email')
      .populate('meusIndicados', 'nome email createdAt')

    if (!usuario) {
      return res.status(404).json({
        success: false,
        error: 'Usuário não encontrado'
      })
    }

    // Verificar se há solicitação de saque pendente
    const solicitacaoPendente = await SolicitacaoSaque.findOne({
      usuario: req.usuarioId,
      status: 'pendente'
    })

    const podeSacar = !solicitacaoPendente && usuario.saldoPremio > 0

    // NOVO: verificar se o usuário está em rodada ativa
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
// FORGOT PASSWORD (mantido igual)
// ===========================================
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body

    console.log('Solicitação de recuperação de senha:', { email })

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email é obrigatório'
      })
    }

    const usuario = await User.findOne({ email })

    if (!usuario) {
      console.log('Usuário não encontrado para recuperação:', email)
      return res.status(200).json({
        success: true,
        message: 'Se o email existir, enviaremos um link de recuperação'
      })
    }

    const token = crypto.randomBytes(32).toString('hex')
    const expires = new Date()
    expires.setHours(expires.getHours() + 1)

    usuario.resetPasswordToken = token
    usuario.resetPasswordExpires = expires
    await usuario.save()

    const resetUrl = `${
      process.env.FRONTEND_URL || 'https://giropremiados.com.br'
    }/reset-password?token=${token}`

    const mailOptions = {
      from: `"Giro Premiado" <${
        process.env.SMTP_USER || 'naoresponder@giropremiados.com.br'
      }>`,
      to: usuario.email,
      subject: 'Recuperação de Senha - Giro Premiado',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="text-align: center; padding: 20px; background-color: #10B981; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0;">Giro Premiado</h1>
          </div>
          
          <div style="padding: 30px; background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 0 0 10px 10px;">
            <h2 style="color: #1f2937; margin-top: 0;">Recuperação de Senha</h2>
            
            <p style="color: #4b5563; line-height: 1.5;">
              Olá <strong>${usuario.nome}</strong>,
            </p>
            
            <p style="color: #4b5563; line-height: 1.5;">
              Recebemos uma solicitação para redefinir sua senha no Giro Premiado.
              Clique no botão abaixo para criar uma nova senha:
            </p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${resetUrl}" 
                 style="background-color: #10B981; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
                Redefinir Senha
              </a>
            </div>
            
            <p style="color: #4b5563; line-height: 1.5;">
              Se você não solicitou essa alteração, ignore este email.
              O link expira em 1 hora.
            </p>
            
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
            
            <p style="color: #9ca3af; font-size: 12px; text-align: center;">
              Giro Premiado - Sistema colaborativo de ganhos
            </p>
          </div>
        </div>
      `
    }

    await transporter.sendMail(mailOptions)

    console.log('Email de recuperação enviado para:', email)

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
// RESET PASSWORD (mantido igual)
// ===========================================
exports.resetPassword = async (req, res) => {
  try {
    const { token, senha } = req.body

    if (!token || !senha) {
      return res.status(400).json({
        success: false,
        error: 'Token e nova senha são obrigatórios'
      })
    }

    if (senha.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'A senha deve ter pelo menos 6 caracteres'
      })
    }

    if (!/[A-Z]/.test(senha)) {
      return res.status(400).json({
        success: false,
        error: 'A senha deve conter pelo menos uma letra maiúscula'
      })
    }

    if (!/[0-9]/.test(senha)) {
      return res.status(400).json({
        success: false,
        error: 'A senha deve conter pelo menos um número'
      })
    }

    const usuario = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: new Date() }
    })

    if (!usuario) {
      return res.status(400).json({
        success: false,
        error:
          'Token inválido ou expirado. Solicite um novo link de recuperação.'
      })
    }

    const salt = await bcrypt.genSalt(10)
    const senhaHash = await bcrypt.hash(senha, salt)

    usuario.senha = senhaHash
    usuario.resetPasswordToken = undefined
    usuario.resetPasswordExpires = undefined
    await usuario.save()

    res.json({
      success: true,
      message: 'Senha redefinida com sucesso'
    })
  } catch (error) {
    console.error('Erro no resetPassword:', error)
    res.status(500).json({
      success: false,
      error: 'Erro ao redefinir senha. Tente novamente.'
    })
  }
}
