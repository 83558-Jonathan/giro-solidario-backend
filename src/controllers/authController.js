const User = require('../models/User');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const RodadaService = require('../services/rodadaService');

const gerarToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });
};

// REGISTRAR COM CRIAÇÃO AUTOMÁTICA DE RODADA
exports.registrar = async (req, res) => {
  try {
    console.log('📝 Registro recebido:', req.body);

    const { nome, email, telefone, cpf, chavePix, tipoChavePix, senha, codigoConvite } = req.body;

    // Validação básica
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

    // Criptografar senha
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

    // Gerar código de convite para o novo usuário
    usuario.codigoConvite = 'CONVITE-' + Math.random().toString(36).substring(2, 10).toUpperCase();

    let indicador = null;
    let rodadaAdicionada = null;
    let mensagemAuto = null;
    let corAdicionado = null;
    let rodadaIdAdicionada = null;

    // Se tiver código de convite, buscar quem indicou
    if (codigoConvite) {
      indicador = await User.findOne({ codigoConvite });

      if (indicador) {
        usuario.indicadoPor = indicador._id;

        // Atualizar indicador
        await User.findByIdAndUpdate(indicador._id, {
          $push: { meusIndicados: usuario._id },
          $inc: { totalIndicacoes: 1 }
        });
      }
    }

    // ===========================================
    // IMPORTANTE: SALVAR O USUÁRIO PRIMEIRO!
    // ===========================================
    await usuario.save();
    console.log(`✅ Usuário ${usuario.nome} criado com ID: ${usuario._id}`);

    // ===========================================
    // AGORA ADICIONAR À RODADA DO INDICADOR
    // ===========================================
    if (indicador) {
      // 1. Buscar rodada em andamento do indicador (que aceita vermelhos)
      let rodadaEmAndamento = await RodadaService.buscarRodadaParaNovoVermelho(indicador._id.toString());

      // 2. Se encontrou rodada em andamento com vagas para vermelho
      if (rodadaEmAndamento) {
        const vermelhosAtuais = rodadaEmAndamento.participantes.filter(p => p.cor === 'vermelho').length;

        if (vermelhosAtuais < 8) {
          console.log(`🔴 Adicionando ${usuario.nome} como VERMELHO na rodada ${rodadaEmAndamento.nome}`);

          try {
            // Adicionar como VERMELHO usando o serviço
            await RodadaService.adicionarParticipanteVermelho(
              rodadaEmAndamento._id.toString(),
              usuario._id.toString(),
              indicador._id.toString()
            );

            rodadaAdicionada = rodadaEmAndamento.nome;
            corAdicionado = 'vermelho';
            rodadaIdAdicionada = rodadaEmAndamento._id;

            console.log(`✅ Usuário ${usuario.nome} adicionado como VERMELHO à rodada ${rodadaEmAndamento.nome}`);
            mensagemAuto = `Adicionado como VERMELHO na rodada ${rodadaEmAndamento.nome}`;

          } catch (error) {
            console.error('❌ Erro ao adicionar como vermelho:', error);
            mensagemAuto = `Erro ao adicionar na rodada: ${error.message}`;
          }
        } else {
          console.log(`⚠️ Rodada ${rodadaEmAndamento.nome} já tem 8 vermelhos`);
          mensagemAuto = `A rodada do seu convidante já está completa. Você foi adicionado como AMARELO em uma nova rodada.`;
        }
      }

      // 3. Se não tem rodada em andamento com vagas, criar uma NOVA rodada
      if (!rodadaAdicionada) {
        console.log(`🆕 Criando nova rodada para o indicador ${indicador.nome}...`);

        // Criar nova rodada com o indicador como criador
        const novaRodada = await RodadaService.criarRodada(indicador._id.toString());

        // Adicionar o novo usuário como AMARELO nesta nova rodada
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

    const token = gerarToken(usuario._id);

    // Resposta final
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

    // Adicionar mensagens automáticas se houver
    if (rodadaAdicionada && corAdicionado) {
      const corTexto = corAdicionado === 'vermelho' ? '🔴 VERMELHO' : '🟡 AMARELO';
      response.automatico = `Adicionado à rodada ${rodadaAdicionada} como ${corTexto}`;
      response.rodadaId = rodadaIdAdicionada;
    } else if (mensagemAuto) {
      response.automatico = mensagemAuto;
    }

    res.status(201).json(response);

  } catch (error) {
    console.error('❌ Erro no registro:', error);
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

    if (!email || !senha) {
      return res.status(400).json({
        success: false,
        error: 'Email e senha são obrigatórios'
      });
    }

    const usuario = await User.findOne({ email });

    if (!usuario) {
      return res.status(401).json({ success: false, error: 'Credenciais inválidas' });
    }

    const senhaCorreta = await bcrypt.compare(senha, usuario.senha);

    if (!senhaCorreta) {
      return res.status(401).json({ success: false, error: 'Credenciais inválidas' });
    }

    const token = gerarToken(usuario._id);

    res.json({
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
    console.error('❌ Erro no login:', error);
    res.status(500).json({
      success: false,
      error: process.env.NODE_ENV === 'development' ? error.message : 'Erro interno no servidor'
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
        error: 'Usuário não encontrado'
      });
    }

    res.json({ success: true, data: usuario });
  } catch (error) {
    console.error('❌ Erro no getMe:', error);
    res.status(500).json({
      success: false,
      error: process.env.NODE_ENV === 'development' ? error.message : 'Erro interno no servidor'
    });
  }
};