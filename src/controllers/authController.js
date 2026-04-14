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

// ===========================================
// FUNÇÃO AUXILIAR: Buscar rodada disponível para usuário SEM convite
// ===========================================
async function buscarRodadaDisponivelParaNovoUsuario() {
  try {
    console.log(`\n🔍 [SEM CONVITE] Buscando rodada disponível...`);

    // PRIORIDADE 1: Rodada em andamento com vaga para vermelho (menos de 8 vermelhos)
    const rodadaEmAndamento = await Rodada.findOne({
      status: 'em_andamento',
      $expr: {
        $lt: [
          { $size: { $filter: { input: '$participantes', as: 'p', cond: { $eq: ['$$p.cor', 'vermelho'] } } } },
          8
        ]
      }
    }).sort({ createdAt: 1 });

    if (rodadaEmAndamento) {
      const vermelhosAtuais = rodadaEmAndamento.participantes.filter(p => p.cor === 'vermelho').length;
      console.log(`✅ [SEM CONVITE] Rodada encontrada: ${rodadaEmAndamento.nome}`);
      console.log(`   Status: em_andamento, Vermelhos: ${vermelhosAtuais}/8`);
      console.log(`   → Usuário será adicionado como VERMELHO`);
      return { rodada: rodadaEmAndamento, tipo: 'vermelho' };
    }

    // PRIORIDADE 2: Rodada aguardando (em formação) com menos de 15 participantes
    const rodadaAguardando = await Rodada.findOne({
      status: 'aguardando',
      $expr: { $lt: [{ $size: '$participantes' }, 15] }
    }).sort({ createdAt: 1 });

    if (rodadaAguardando) {
      const participantesAtuais = rodadaAguardando.participantes.length;
      const temEstrutura = !!(rodadaAguardando.verde && rodadaAguardando.pretos && rodadaAguardando.azuis);

      console.log(`✅ [SEM CONVITE] Rodada encontrada: ${rodadaAguardando.nome}`);
      console.log(`   Status: aguardando, Participantes: ${participantesAtuais}/15`);
      console.log(`   Tem estrutura: ${temEstrutura ? 'SIM' : 'NÃO'}`);
      console.log(`   → Usuário será adicionado como ${temEstrutura ? 'VERMELHO' : 'AMARELO'}`);

      return {
        rodada: rodadaAguardando,
        tipo: temEstrutura ? 'vermelho' : 'amarelo'
      };
    }

    // PRIORIDADE 3: Nenhuma rodada disponível - criar nova
    console.log(`⚠️ [SEM CONVITE] Nenhuma rodada disponível. Criando nova rodada...`);
    return { rodada: null, tipo: 'nova' };

  } catch (error) {
    console.error('❌ [SEM CONVITE] Erro ao buscar rodada:', error);
    return { rodada: null, tipo: 'erro' };
  }
}

// ===========================================
// FUNÇÃO AUXILIAR: Adicionar usuário à rodada
// ===========================================
async function adicionarUsuarioRodada(rodada, usuarioId, tipo, indicadorId = null) {
  try {
    console.log(`\n➕ [ADICIONAR] Adicionando usuário ${usuarioId} à rodada ${rodada.nome} como ${tipo.toUpperCase()}`);

    if (tipo === 'vermelho') {
      return await RodadaService.adicionarParticipanteVermelho(
        rodada._id.toString(),
        usuarioId.toString(),
        indicadorId
      );
    } else if (tipo === 'amarelo') {
      return await RodadaService.adicionarParticipanteAmarelo(
        rodada._id.toString(),
        usuarioId.toString(),
        indicadorId
      );
    } else {
      throw new Error(`Tipo inválido: ${tipo}`);
    }
  } catch (error) {
    console.error(`❌ [ADICIONAR] Erro ao adicionar usuário:`, error);
    throw error;
  }
}

// ===========================================
// REGISTRAR (CORRIGIDO)
// ===========================================
exports.registrar = async (req, res) => {
  try {
    console.log('📝 Registro recebido:', req.body);

    const { nome, email, telefone, cpf, chavePix, tipoChavePix, senha, codigoConvite } = req.body;

    // Validação de campos obrigatórios
    if (!nome || !email || !telefone || !cpf || !chavePix || !tipoChavePix || !senha) {
      return res.status(400).json({
        success: false,
        error: 'Todos os campos são obrigatórios'
      });
    }

    // Verificar se usuário já existe
    const existe = await User.findOne({ $or: [{ email }, { cpf }] });
    if (existe) {
      return res.status(400).json({ success: false, error: 'Usuário já existe' });
    }

    // Hash da senha
    const salt = await bcrypt.genSalt(10);
    const senhaHash = await bcrypt.hash(senha, salt);

    // Criar usuário
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

    // ===========================================
    // CASO 1: Usuário tem código de convite
    // ===========================================
    if (codigoConvite) {
      console.log(`\n🔗 [COM CONVITE] Código recebido: ${codigoConvite}`);

      indicador = await User.findOne({ codigoConvite });

      if (indicador) {
        console.log(`✅ [COM CONVITE] Indicador encontrado: ${indicador.nome}`);
        usuario.indicadoPor = indicador._id;

        await User.findByIdAndUpdate(indicador._id, {
          $push: { meusIndicados: usuario._id },
          $inc: { totalIndicacoes: 1 }
        });

        // Buscar rodada do indicador
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

              console.log(`✅ Usuário ${usuario.nome} adicionado como VERMELHO à rodada ${rodadaDoIndicador.nome}`);
              mensagemAuto = `Adicionado como VERMELHO na rodada ${rodadaDoIndicador.nome}`;

            } catch (error) {
              console.error('❌ Erro ao adicionar como vermelho:', error);
              mensagemAuto = `Erro ao adicionar na rodada: ${error.message}`;
            }
          }
          // Se a rodada NÃO tem estrutura (ainda em formação), adiciona como AMARELO
          else if (!temEstrutura) {
            console.log(`🟡 Adicionando ${usuario.nome} como AMARELO na rodada existente ${rodadaDoIndicador.nome}`);

            try {
              await RodadaService.adicionarParticipanteAmarelo(
                rodadaDoIndicador._id.toString(),
                usuario._id.toString(),
                indicador._id.toString()
              );

              rodadaAdicionada = rodadaDoIndicador.nome;
              corAdicionado = 'amarelo';
              rodadaIdAdicionada = rodadaDoIndicador._id;

              console.log(`✅ Usuário ${usuario.nome} adicionado como AMARELO na rodada ${rodadaDoIndicador.nome}`);
              mensagemAuto = `Adicionado como AMARELO na rodada ${rodadaDoIndicador.nome}`;

            } catch (error) {
              console.error('❌ Erro ao adicionar como amarelo:', error);
              mensagemAuto = `Erro ao adicionar na rodada: ${error.message}`;
            }
          }
          // Se tem estrutura mas está cheia de vermelhos
          else if (temEstrutura && vermelhosAtuais >= 8) {
            console.log(`⚠️ Rodada ${rodadaDoIndicador.nome} está cheia de vermelhos (${vermelhosAtuais}/8)`);
            mensagemAuto = `A rodada do seu convidante está completa. Uma nova rodada será criada para você.`;

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
                mensagemAuto = `Nova rodada ${novaRodada.nome} criada! Você foi adicionado como AMARELO.`;

                console.log(`✅ Usuário ${usuario.nome} adicionado como AMARELO na nova rodada ${novaRodada.nome}`);
              } catch (error) {
                console.error('❌ Erro ao adicionar como amarelo:', error);
                mensagemAuto = `Erro ao adicionar na rodada: ${error.message}`;
              }
            }
          }
        }
        // Se o indicador não tem nenhuma rodada, criar uma nova
        else {
          console.log(`🆕 Indicador ${indicador.nome} não tem rodada. Criando nova rodada...`);

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
              mensagemAuto = `Nova rodada ${novaRodada.nome} criada! Você foi adicionado como AMARELO.`;

              console.log(`✅ Usuário ${usuario.nome} adicionado como AMARELO na nova rodada ${novaRodada.nome}`);
            } catch (error) {
              console.error('❌ Erro ao adicionar como amarelo:', error);
              mensagemAuto = `Erro ao adicionar na rodada: ${error.message}`;
            }
          }
        }
      } else {
        console.log(`⚠️ [COM CONVITE] Código ${codigoConvite} não encontrado. Tratando como cadastro sem convite...`);
        // Código inválido - tratar como cadastro sem convite
        const { rodada, tipo } = await buscarRodadaDisponivelParaNovoUsuario();

        if (rodada) {
          try {
            await adicionarUsuarioRodada(rodada, usuario._id, tipo);
            rodadaAdicionada = rodada.nome;
            corAdicionado = tipo;
            rodadaIdAdicionada = rodada._id;
            mensagemAuto = `Adicionado como ${tipo.toUpperCase()} na rodada ${rodada.nome}`;
            console.log(`✅ Usuário ${usuario.nome} adicionado à rodada existente como ${tipo.toUpperCase()}`);
          } catch (error) {
            console.error('❌ Erro ao adicionar usuário à rodada:', error);
            mensagemAuto = `Erro ao adicionar na rodada: ${error.message}`;
          }
        } else if (tipo === 'nova') {
          const novaRodada = await RodadaService.criarRodada(usuario._id.toString());
          rodadaAdicionada = novaRodada.nome;
          corAdicionado = 'amarelo';
          rodadaIdAdicionada = novaRodada._id;
          mensagemAuto = `Nova rodada ${novaRodada.nome} criada para você!`;
          console.log(`✅ Nova rodada criada para ${usuario.nome}`);
        }
      }
    }

    // ===========================================
    // CASO 2: Usuário SEM código de convite (cadastro direto)
    // ===========================================
    else {
      console.log(`\n🚫 [SEM CONVITE] Usuário cadastrando sem código de convite`);

      const { rodada, tipo } = await buscarRodadaDisponivelParaNovoUsuario();

      if (rodada) {
        try {
          await adicionarUsuarioRodada(rodada, usuario._id, tipo);
          rodadaAdicionada = rodada.nome;
          corAdicionado = tipo;
          rodadaIdAdicionada = rodada._id;
          mensagemAuto = `Adicionado como ${tipo.toUpperCase()} na rodada ${rodada.nome}`;
          console.log(`✅ [SEM CONVITE] Usuário ${usuario.nome} adicionado à rodada existente como ${tipo.toUpperCase()}`);
        } catch (error) {
          console.error('❌ [SEM CONVITE] Erro ao adicionar usuário à rodada:', error);
          mensagemAuto = `Erro ao adicionar na rodada: ${error.message}`;

          // Fallback: criar nova rodada
          console.log(`🆕 [SEM CONVITE] Criando nova rodada como fallback...`);
          const novaRodada = await RodadaService.criarRodada(usuario._id.toString());
          rodadaAdicionada = novaRodada.nome;
          corAdicionado = 'amarelo';
          rodadaIdAdicionada = novaRodada._id;
          mensagemAuto = `Nova rodada ${novaRodada.nome} criada para você!`;
        }
      } else if (tipo === 'nova') {
        // Criar nova rodada para o usuário
        console.log(`🆕 [SEM CONVITE] Nenhuma rodada disponível. Criando nova rodada...`);
        const novaRodada = await RodadaService.criarRodada(usuario._id.toString());
        rodadaAdicionada = novaRodada.nome;
        corAdicionado = 'amarelo';
        rodadaIdAdicionada = novaRodada._id;
        mensagemAuto = `Nova rodada ${novaRodada.nome} criada para você!`;
        console.log(`✅ [SEM CONVITE] Nova rodada criada para ${usuario.nome}`);
      }
    }

    // Salvar usuário
    await usuario.save();
    console.log(`✅ Usuário ${usuario.nome} salvo com ID: ${usuario._id}`);

    // Gerar token
    const token = gerarToken(usuario._id);

    // Montar resposta
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
      const corTexto = corAdicionado === 'vermelho' ? 'VERMELHO' : corAdicionado === 'amarelo' ? 'AMARELO' : corAdicionado.toUpperCase();
      response.automatico = `Adicionado à rodada ${rodadaAdicionada} como ${corTexto}`;
      response.rodadaId = rodadaIdAdicionada;
    } else if (mensagemAuto) {
      response.automatico = mensagemAuto;
    }

    console.log(`\n✅ REGISTRO CONCLUÍDO COM SUCESSO!`);
    console.log(`   Usuário: ${usuario.nome}`);
    console.log(`   Rodada: ${rodadaAdicionada || 'Nenhuma'}`);
    console.log(`   Cor: ${corAdicionado || 'Nenhuma'}`);
    console.log(`${'='.repeat(60)}\n`);

    res.status(201).json(response);

  } catch (error) {
    console.error('❌ Erro no registro:', error);
    res.status(500).json({
      success: false,
      error: process.env.NODE_ENV === 'development' ? error.message : 'Erro interno no servidor'
    });
  }
};

// ===========================================
// LOGIN (mantido igual)
// ===========================================
exports.login = async (req, res) => {
  try {
    const { email, senha } = req.body;

    console.log('Tentativa de login:', { email });

    if (!email || !senha) {
      console.log('Campos faltando');
      return res.status(400).json({
        success: false,
        error: 'Email e senha são obrigatórios'
      });
    }

    const usuario = await User.findOne({ email });

    if (!usuario) {
      console.log('Usuário não encontrado:', email);
      return res.status(401).json({
        success: false,
        error: 'Email ou senha inválidos'
      });
    }

    const senhaCorreta = await bcrypt.compare(senha, usuario.senha);

    if (!senhaCorreta) {
      console.log('Senha incorreta para:', email);
      return res.status(401).json({
        success: false,
        error: 'Email ou senha inválidos'
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

// ===========================================
// GET ME (mantido igual)
// ===========================================
exports.getMe = async (req, res) => {
  try {
    const usuario = await User.findById(req.usuarioId)
      .select('-senha')
      .populate('indicadoPor', 'nome email')
      .populate('meusIndicados', 'nome email createdAt');

    if (!usuario) {
      return res.status(404).json({
        success: false,
        error: 'Usuário não encontrado'
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

// ===========================================
// FORGOT PASSWORD (mantido igual)
// ===========================================
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    console.log('Solicitação de recuperação de senha:', { email });

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email é obrigatório'
      });
    }

    const usuario = await User.findOne({ email });

    if (!usuario) {
      console.log('Usuário não encontrado para recuperação:', email);
      return res.status(200).json({
        success: true,
        message: 'Se o email existir, enviaremos um link de recuperação'
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
    };

    await transporter.sendMail(mailOptions);

    console.log('Email de recuperação enviado para:', email);

    res.json({
      success: true,
      message: 'Email de recuperação enviado com sucesso'
    });

  } catch (error) {
    console.error('Erro no forgotPassword:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao enviar email de recuperação. Tente novamente.'
    });
  }
};

// ===========================================
// RESET PASSWORD (mantido igual)
// ===========================================
exports.resetPassword = async (req, res) => {
  try {
    const { token, senha } = req.body;

    if (!token || !senha) {
      return res.status(400).json({
        success: false,
        error: 'Token e nova senha são obrigatórios'
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
        error: 'A senha deve conter pelo menos uma letra maiúscula'
      });
    }

    if (!/[0-9]/.test(senha)) {
      return res.status(400).json({
        success: false,
        error: 'A senha deve conter pelo menos um número'
      });
    }

    const usuario = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: new Date() }
    });

    if (!usuario) {
      return res.status(400).json({
        success: false,
        error: 'Token inválido ou expirado. Solicite um novo link de recuperação.'
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