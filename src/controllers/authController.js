const User = require('../models/User')
const Rodada = require('../models/Rodada')
const jwt = require('jsonwebtoken')
const bcrypt = require('bcryptjs')
const crypto = require('crypto')
const mongoose = require('mongoose')
const RodadaService = require('../services/rodadaService')
const SolicitacaoSaque = require('../models/SolicitacaoSaque')
const nodemailer = require('nodemailer')

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

    if (
      !nome ||
      !email ||
      !telefone ||
      !cpf ||
      !chavePix ||
      !tipoChavePix ||
      !senha
    )
      return res
        .status(400)
        .json({ success: false, error: 'Todos os campos são obrigatórios' })

    const existe = await User.findOne({ $or: [{ email }, { cpf }] })
    if (existe)
      return res
        .status(400)
        .json({ success: false, error: 'Usuário já existe' })

    const salt = await bcrypt.genSalt(10)
    const senhaHash = await bcrypt.hash(senha, salt)

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
    await usuario.save()
    console.log(`✅ Usuário ${usuario.nome} salvo com ID: ${usuario._id}`)

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
        console.log(`✅ [COM CONVITE] Indicador encontrado: ${indicador.nome}`)
        usuario.indicadoPor = indicador._id
        await User.findByIdAndUpdate(indicador._id, {
          $push: { meusIndicados: usuario._id },
          $inc: { totalIndicacoes: 1 }
        })
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
              mensagemAuto = `✅ Adicionado como VERMELHO na rodada ${rodadaDoIndicador.nome}. Efetue o pagamento de R$ ${dadosPagamento.valor} para confirmar.`
            } else
              mensagemAuto = `✅ Adicionado como VERMELHO na rodada ${rodadaDoIndicador.nome}, mas não foi possível gerar o QR Code. Entre em contato.`
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
              mensagemAuto = `✅ Adicionado como VERMELHO na rodada ${rodada.nome}. Efetue o pagamento de R$ ${dadosPagamento.valor}.`
            } else
              mensagemAuto = `✅ Adicionado como VERMELHO na rodada ${rodada.nome}, mas QR Code não gerado.`
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
            mensagemAuto = `✅ Adicionado como VERMELHO na rodada ${rodada.nome}. Efetue o pagamento de R$ ${dadosPagamento.valor}.`
          } else
            mensagemAuto = `✅ Adicionado como VERMELHO na rodada ${rodada.nome}, mas QR Code não gerado.`
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

    const token = gerarToken(usuario._id)
    const response = {
      success: true,
      token,
      usuario: {
        id: usuario._id,
        nome: usuario.nome,
        email: usuario.email,
        codigoConvite: usuario.codigoConvite
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

    console.log(`\n✅ REGISTRO CONCLUÍDO COM SUCESSO!`)
    console.log(`   Usuário: ${usuario.nome}`)
    console.log(`   Entrou na fila: ${entrouNaFila ? 'SIM' : 'NÃO'}`)
    console.log(`   Posição na fila: ${posicaoFila || 'N/A'}`)
    console.log(`   Rodada: ${rodadaAdicionada || 'Nenhuma'}`)
    console.log(`   Cor: ${corAdicionado || 'Nenhuma'}`)
    console.log(`   Pagamento: ${dadosPagamento ? 'QR Code gerado' : 'Nenhum'}`)
    res.status(201).json(response)
  } catch (error) {
    console.error('❌ Erro no registro:', error)
    res
      .status(500)
      .json({
        success: false,
        error:
          process.env.NODE_ENV === 'development'
            ? error.message
            : 'Erro interno no servidor'
      })
  }
}

exports.login = async (req, res) => {
  try {
    const { email, senha } = req.body
    if (!email || !senha)
      return res
        .status(400)
        .json({ success: false, error: 'Email e senha são obrigatórios' })
    const usuario = await User.findOne({ email })
    if (!usuario)
      return res
        .status(401)
        .json({ success: false, error: 'Email ou senha inválidos' })
    const senhaCorreta = await bcrypt.compare(senha, usuario.senha)
    if (!senhaCorreta)
      return res
        .status(401)
        .json({ success: false, error: 'Email ou senha inválidos' })
    const token = gerarToken(usuario._id)
    return res
      .status(200)
      .json({
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
    return res
      .status(500)
      .json({
        success: false,
        error: 'Erro interno no servidor. Tente novamente mais tarde.'
      })
  }
}

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
    res
      .status(500)
      .json({
        success: false,
        error:
          process.env.NODE_ENV === 'development'
            ? error.message
            : 'Erro interno no servidor'
      })
  }
}

exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body
    if (!email)
      return res
        .status(400)
        .json({ success: false, error: 'Email é obrigatório' })
    const usuario = await User.findOne({ email })
    if (!usuario)
      return res
        .status(200)
        .json({
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
    const mailOptions = {
      from: `"Giro Premiado" <${
        process.env.SMTP_USER || 'naoresponder@giropremiados.com.br'
      }>`,
      to: usuario.email,
      subject: 'Recuperação de Senha - Giro Premiado',
      html: `<div>...</div>` // manter o HTML original
    }
    await transporter.sendMail(mailOptions)
    res.json({
      success: true,
      message: 'Email de recuperação enviado com sucesso'
    })
  } catch (error) {
    console.error('Erro no forgotPassword:', error)
    res
      .status(500)
      .json({
        success: false,
        error: 'Erro ao enviar email de recuperação. Tente novamente.'
      })
  }
}

exports.resetPassword = async (req, res) => {
  try {
    const { token, senha } = req.body
    if (!token || !senha)
      return res
        .status(400)
        .json({ success: false, error: 'Token e nova senha são obrigatórios' })
    if (senha.length < 6)
      return res
        .status(400)
        .json({
          success: false,
          error: 'A senha deve ter pelo menos 6 caracteres'
        })
    if (!/[A-Z]/.test(senha))
      return res
        .status(400)
        .json({
          success: false,
          error: 'A senha deve conter pelo menos uma letra maiúscula'
        })
    if (!/[0-9]/.test(senha))
      return res
        .status(400)
        .json({
          success: false,
          error: 'A senha deve conter pelo menos um número'
        })
    const usuario = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: new Date() }
    })
    if (!usuario)
      return res
        .status(400)
        .json({
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
    res
      .status(500)
      .json({
        success: false,
        error: 'Erro ao redefinir senha. Tente novamente.'
      })
  }
}
