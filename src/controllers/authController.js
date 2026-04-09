const User = require('../models/User');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const mongoose = require('mongoose');
const RodadaService = require('../services/rodadaService');

// Configuracao de email
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.hostinger.com',
  port: parseInt(process.env.SMTP_PORT) || 465,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

const gerarToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });
};

// REGISTRAR
exports.registrar = async (req, res) => {
  try {
    console.log('Registro recebido:', req.body);

    const { nome, email, telefone, cpf, chavePix, tipoChavePix, senha, codigoConvite } = req.body;

    if (!nome || !email || !telefone || !cpf || !chavePix || !tipoChavePix || !senha) {
      return res.status(400).json({
        success: false,
        error: 'Todos os campos sao obrigatorios'
      });
    }

    const existe = await User.findOne({ $or: [{ email }, { cpf }] });
    if (existe) {
      return res.status(400).json({ success: false, error: 'Usuario ja existe' });
    }

    const salt = await bcrypt.genSalt(10);
    const senhaHash = await bcrypt.hash(senha, salt);

    const usuario = new User({
      nome,
      email,
      telefone,
      cpf,
      chavePix,
      tipoChavePix,
      senha: senhaHash
    });

    usuario.codigoConvite = 'CONVITE-' + Math.random().toString(36).substring(2, 10).toUpperCase();

    let indicador = null;
    let rodadaAdicionada = null;
    let mensagemAuto = null;
    let corAdicionado = null;
    let rodadaIdAdicionada = null;

    if (codigoConvite) {
      indicador = await User.findOne({ codigoConvite });

      if (indicador) {
        usuario.indicadoPor = indicador._id;

        await User.findByIdAndUpdate(indicador._id, {
          $push: { meusIndicados: usuario._id },
          $inc: { totalIndicacoes: 1 }
        });
      }
    }

    await usuario.save();
    console.log(`Usuario ${usuario.nome} criado com ID: ${usuario._id}`);

    if (indicador) {
      // Buscar rodada do indicador (pode ser em_andamento ou aguardando)
      let rodadaDoIndicador = await RodadaService.buscarRodadaParaNovoVermelho(indicador._id.toString());

      if (rodadaDoIndicador) {
        const vermelhosAtuais = rodadaDoIndicador.participantes.filter(p => p.cor === 'vermelho').length;
        const temEstrutura = !!(rodadaDoIndicador.verde && rodadaDoIndicador.pretos && rodadaDoIndicador.azuis);

        console.log(`\n📋 Processando convite para rodada: ${rodadaDoIndicador.nome}`);
        console.log(`   Status: ${rodadaDoIndicador.status}`);
        console.log(`   Tem estrutura: ${temEstrutura ? 'SIM' : 'NÃO'}`);
        console.log(`   Vermelhos atuais: ${vermelhosAtuais}/8`);

        // Se a rodada tem estrutura e tem vaga para vermelho, adiciona como VERMELHO
        if (temEstrutura && vermelhosAtuais < 8) {
          console.log(`🔴 Adicionando ${usuario.nome} como VERMELHO na rodada ${rodadaDoIndicador.nome}`);

          try {
            await RodadaService.adicionarParticipanteVermelho(
              rodadaDoIndicador._id.toString(),
              usuario._id.toString(),
              indicador._id.toString()
            );

            rodadaAdicionada = rodadaDoIndicador.nome;
            corAdicionado = 'vermelho';
            rodadaIdAdicionada = rodadaDoIndicador._id;

            console.log(`✅ Usuario ${usuario.nome} adicionado como VERMELHO a rodada ${rodadaDoIndicador.nome}`);
            mensagemAuto = `Adicionado como VERMELHO na rodada ${rodadaDoIndicador.nome}`;

          } catch (error) {
            console.error('❌ Erro ao adicionar como vermelho:', error);
            mensagemAuto = `Erro ao adicionar na rodada: ${error.message}`;
          }
        }
        // Se a rodada NÃO tem estrutura (ainda em formação), adiciona como AMARELO na MESMA rodada
        else if (!temEstrutura) {
          console.log(`🟡 Adicionando ${usuario.nome} como AMARELO na rodada existente ${rodadaDoIndicador.nome} (ainda em formacao)`);

          try {
            await RodadaService.adicionarParticipanteAmarelo(
              rodadaDoIndicador._id.toString(),
              usuario._id.toString(),
              indicador._id.toString()
            );

            rodadaAdicionada = rodadaDoIndicador.nome;
            corAdicionado = 'amarelo';
            rodadaIdAdicionada = rodadaDoIndicador._id;

            console.log(`✅ Usuario ${usuario.nome} adicionado como AMARELO na rodada ${rodadaDoIndicador.nome}`);
            mensagemAuto = `Adicionado como AMARELO na rodada ${rodadaDoIndicador.nome}`;

          } catch (error) {
            console.error('❌ Erro ao adicionar como amarelo:', error);
            mensagemAuto = `Erro ao adicionar na rodada: ${error.message}`;
          }
        }
        // Se tem estrutura mas está cheia de vermelhos
        else if (temEstrutura && vermelhosAtuais >= 8) {
          console.log(`⚠️ Rodada ${rodadaDoIndicador.nome} esta cheia de vermelhos (${vermelhosAtuais}/8)`);
          mensagemAuto = `A rodada do seu convidante esta completa. Uma nova rodada sera criada para voce.`;

          // Criar nova rodada
          console.log(`🆕 Criando nova rodada para o indicador ${indicador.nome}...`);
          const novaRodada = await RodadaService.criarRodada(indicador._id.toString());

          if (novaRodada) {
            try {
              await RodadaService.adicionarParticipanteAmarelo(
                novaRodada._id.toString(),
                usuario._id.toString(),
                indicador._id.toString()
              );

              rodadaAdicionada = novaRodada.nome;
              corAdicionado = 'amarelo';
              rodadaIdAdicionada = novaRodada._id;
              mensagemAuto = `Nova rodada ${novaRodada.nome} criada! Voce foi adicionado como AMARELO.`;

              console.log(`✅ Usuario ${usuario.nome} adicionado como AMARELO na nova rodada ${novaRodada.nome}`);
            } catch (error) {
              console.error('❌ Erro ao adicionar como amarelo:', error);
              mensagemAuto = `Erro ao adicionar na rodada: ${error.message}`;
            }
          }
        }
      }
      // Se o indicador não tem nenhuma rodada, criar uma nova
      else {
        console.log(`🆕 Indicador ${indicador.nome} nao tem rodada. Criando nova rodada...`);

        const novaRodada = await RodadaService.criarRodada(indicador._id.toString());

        if (novaRodada) {
          try {
            await RodadaService.adicionarParticipanteAmarelo(
              novaRodada._id.toString(),
              usuario._id.toString(),
              indicador._id.toString()
            );

            rodadaAdicionada = novaRodada.nome;
            corAdicionado = 'amarelo';
            rodadaIdAdicionada = novaRodada._id;
            mensagemAuto = `Nova rodada ${novaRodada.nome} criada! Voce foi adicionado como AMARELO.`;

            console.log(`✅ Usuario ${usuario.nome} adicionado como AMARELO na nova rodada ${novaRodada.nome}`);
          } catch (error) {
            console.error('❌ Erro ao adicionar como amarelo:', error);
            mensagemAuto = `Erro ao adicionar na rodada: ${error.message}`;
          }
        }
      }
    }

    const token = gerarToken(usuario._id);

    const response = {
      success: true,
      token,
      usuario: {
        id: usuario._id,
        nome: usuario.nome,
        email: usuario.email,
        codigoConvite: usuario.codigoConvite
      }
    };

    if (rodadaAdicionada && corAdicionado) {
      const corTexto = corAdicionado === 'vermelho' ? 'VERMELHO' : 'AMARELO';
      response.automatico = `Adicionado a rodada ${rodadaAdicionada} como ${corTexto}`;
      response.rodadaId = rodadaIdAdicionada;
    } else if (mensagemAuto) {
      response.automatico = mensagemAuto;
    }

    res.status(201).json(response);

  } catch (error) {
    console.error('Erro no registro:', error);
    res.status(500).json({
      success: false,
      error: process.env.NODE_ENV === 'development' ? error.message : 'Erro interno no servidor'
    });
  }
};

// LOGIN
exports.login = async (req, res) => {
  try {
    const { email, senha } = req.body;

    console.log('Tentativa de login:', { email });

    if (!email || !senha) {
      console.log('Campos faltando');
      return res.status(400).json({
        success: false,
        error: 'Email e senha sao obrigatorios'
      });
    }

    const usuario = await User.findOne({ email });

    if (!usuario) {
      console.log('Usuario nao encontrado:', email);
      return res.status(401).json({
        success: false,
        error: 'Email ou senha invalidos'
      });
    }

    const senhaCorreta = await bcrypt.compare(senha, usuario.senha);

    if (!senhaCorreta) {
      console.log('Senha incorreta para:', email);
      return res.status(401).json({
        success: false,
        error: 'Email ou senha invalidos'
      });
    }

    console.log('Login bem sucedido:', email);

    const token = gerarToken(usuario._id);

    return res.status(200).json({
      success: true,
      token,
      usuario: {
        id: usuario._id,
        nome: usuario.nome,
        email: usuario.email,
        codigoConvite: usuario.codigoConvite
      }
    });

  } catch (error) {
    console.error('Erro no login:', error);
    return res.status(500).json({
      success: false,
      error: 'Erro interno no servidor. Tente novamente mais tarde.'
    });
  }
};

// GET ME
exports.getMe = async (req, res) => {
  try {
    const usuario = await User.findById(req.usuarioId)
      .select('-senha')
      .populate('indicadoPor', 'nome email')
      .populate('meusIndicados', 'nome email createdAt');

    if (!usuario) {
      return res.status(404).json({
        success: false,
        error: 'Usuario nao encontrado'
      });
    }

    res.json({ success: true, data: usuario });
  } catch (error) {
    console.error('Erro no getMe:', error);
    res.status(500).json({
      success: false,
      error: process.env.NODE_ENV === 'development' ? error.message : 'Erro interno no servidor'
    });
  }
};

// ESQUECEU A SENHA
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    console.log('Solicitacao de recuperacao de senha:', { email });

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email é obrigatorio'
      });
    }

    const usuario = await User.findOne({ email });

    if (!usuario) {
      console.log('Usuario nao encontrado para recuperacao:', email);
      return res.status(200).json({
        success: true,
        message: 'Se o email existir, enviaremos um link de recuperacao'
      });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date();
    expires.setHours(expires.getHours() + 1);

    usuario.resetPasswordToken = token;
    usuario.resetPasswordExpires = expires;
    await usuario.save();

    const resetUrl = `${process.env.FRONTEND_URL || 'https://giropremiados.com.br'}/reset-password?token=${token}`;

    const mailOptions = {
      from: `"Giro Premiado" <${process.env.SMTP_USER || 'naoresponder@giropremiados.com.br'}>`,
      to: usuario.email,
      subject: 'Recuperacao de Senha - Giro Premiado',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="text-align: center; padding: 20px; background-color: #10B981; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0;">Giro Premiado</h1>
          </div>
          
          <div style="padding: 30px; background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 0 0 10px 10px;">
            <h2 style="color: #1f2937; margin-top: 0;">Recuperacao de Senha</h2>
            
            <p style="color: #4b5563; line-height: 1.5;">
              Ola <strong>${usuario.nome}</strong>,
            </p>
            
            <p style="color: #4b5563; line-height: 1.5;">
              Recebemos uma solicitacao para redefinir sua senha no Giro Premiado.
              Clique no botao abaixo para criar uma nova senha:
            </p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${resetUrl}" 
                 style="background-color: #10B981; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
                Redefinir Senha
              </a>
            </div>
            
            <p style="color: #4b5563; line-height: 1.5;">
              Se voce nao solicitou essa alteracao, ignore este email.
              O link expira em 1 hora.
            </p>
            
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
            
            <p style="color: #9ca3af; font-size: 12px; text-align: center;">
              Giro Premiado - Sistema colaborativo de ganhos
            </p>
          </div>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);

    console.log('Email de recuperacao enviado para:', email);

    res.json({
      success: true,
      message: 'Email de recuperacao enviado com sucesso'
    });

  } catch (error) {
    console.error('Erro no forgotPassword:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao enviar email de recuperacao. Tente novamente.'
    });
  }
};

// REDEFINIR SENHA
exports.resetPassword = async (req, res) => {
  try {
    const { token, senha } = req.body;

    if (!token || !senha) {
      return res.status(400).json({
        success: false,
        error: 'Token e nova senha sao obrigatorios'
      });
    }

    if (senha.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'A senha deve ter pelo menos 6 caracteres'
      });
    }

    if (!/[A-Z]/.test(senha)) {
      return res.status(400).json({
        success: false,
        error: 'A senha deve conter pelo menos uma letra maiuscula'
      });
    }

    if (!/[0-9]/.test(senha)) {
      return res.status(400).json({
        success: false,
        error: 'A senha deve conter pelo menos um numero'
      });
    }

    const usuario = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: new Date() }
    });

    if (!usuario) {
      return res.status(400).json({
        success: false,
        error: 'Token invalido ou expirado. Solicite um novo link de recuperacao.'
      });
    }

    const salt = await bcrypt.genSalt(10);
    const senhaHash = await bcrypt.hash(senha, salt);

    usuario.senha = senhaHash;
    usuario.resetPasswordToken = undefined;
    usuario.resetPasswordExpires = undefined;
    await usuario.save();

    res.json({
      success: true,
      message: 'Senha redefinida com sucesso'
    });

  } catch (error) {
    console.error('Erro no resetPassword:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao redefinir senha. Tente novamente.'
    });
  }
};