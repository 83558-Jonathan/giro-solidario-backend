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

        // --- REGRA: ADICIONAR À RODADA DO INDICADOR ---

        const db = mongoose.connection.db;

        // 1. Buscar rodada em andamento do indicador (que aceita vermelhos)
        let rodadaEmAndamento = await db.collection('rodadas').findOne({
          status: 'em_andamento',
          'participantes.usuario': indicador._id
        });

        // Verificar se a rodada em andamento ainda tem vagas para vermelhos (máximo 8)
        let vagasVermelho = false;
        if (rodadaEmAndamento) {
          const vermelhosAtuais = rodadaEmAndamento.participantes?.filter(p => p.cor === 'vermelho').length || 0;
          vagasVermelho = vermelhosAtuais < 8;
        }

        // 2. Buscar rodada aguardando do indicador
        let rodadaAguardando = null;
        if (!rodadaEmAndamento || !vagasVermelho) {
          rodadaAguardando = await db.collection('rodadas').findOne({
            status: 'aguardando',
            'participantes.usuario': indicador._id
          });
        }

        // 3. Se o indicador não tem nenhuma rodada, criar uma para ele
        if (!rodadaEmAndamento && !rodadaAguardando) {
          console.log(`🆕 Indicador ${indicador.nome} não tem rodada. Criando rodada automática...`);

          const novaRodada = await RodadaService.criarRodada(indicador._id.toString());
          rodadaAguardando = novaRodada;

          console.log(`✅ Rodada ${novaRodada.nome} criada automaticamente para ${indicador.nome}`);
          mensagemAuto = `Rodada ${novaRodada.nome} criada para você e seu convidado!`;
        }

        // 4. Adicionar o novo usuário à rodada apropriada
        let rodadaParaAdicionar = null;
        let tipoAdicao = null;

        // PRIORIDADE 1: Rodada em andamento com vagas para vermelho
        if (rodadaEmAndamento && vagasVermelho) {
          rodadaParaAdicionar = rodadaEmAndamento;
          tipoAdicao = 'vermelho';
          console.log(`🔴 Nova rodada em andamento encontrada para ${indicador.nome}, adicionando como VERMELHO`);
        }
        // PRIORIDADE 2: Rodada aguardando (entra como amarelo)
        else if (rodadaAguardando) {
          rodadaParaAdicionar = rodadaAguardando;
          tipoAdicao = 'amarelo';
          console.log(`🟡 Rodada aguardando encontrada para ${indicador.nome}, adicionando como AMARELO`);
        }

        if (rodadaParaAdicionar) {
          // Verificar se a rodada não está cheia
          const limiteMaximo = tipoAdicao === 'vermelho' ? 8 : 15;
          const participantesAtuais = rodadaParaAdicionar.participantes?.length || 0;
          const vermelhosAtuais = rodadaParaAdicionar.participantes?.filter(p => p.cor === 'vermelho').length || 0;

          let podeAdicionar = false;
          if (tipoAdicao === 'vermelho') {
            podeAdicionar = vermelhosAtuais < 8;
          } else {
            podeAdicionar = participantesAtuais < 15;
          }

          if (!podeAdicionar) {
            console.log(`⚠️ Rodada ${rodadaParaAdicionar.nome} não tem mais vagas para ${tipoAdicao}!`);
            mensagemAuto = `A rodada do seu convidante está cheia. Crie sua própria rodada!`;
          } else {
            // Verificar se o usuário já não está na rodada
            const jaExiste = rodadaParaAdicionar.participantes?.find(
              p => p.usuario.toString() === usuario._id.toString()
            );

            if (!jaExiste) {
              // Adicionar novo participante com a cor correta
              const participante = {
                usuario: usuario._id,
                cor: tipoAdicao,
                posicao: (rodadaParaAdicionar.participantes?.length || 0) + 1,
                dataEntrada: new Date(),
                depositoConfirmado: false,
                indicadoPor: indicador._id
              };

              // Atualizar arrays de cores conforme o tipo
              const updateQuery = { $push: { participantes: participante } };

              if (tipoAdicao === 'vermelho') {
                updateQuery.$push.vermelhos = usuario._id;
              } else if (tipoAdicao === 'amarelo') {
                // Amarelos não têm array específico
              }

              await db.collection('rodadas').updateOne(
                { _id: rodadaParaAdicionar._id },
                updateQuery
              );

              console.log(`✅ Usuário ${usuario.nome} adicionado à rodada ${rodadaParaAdicionar.nome} como ${tipoAdicao.toUpperCase()}`);
              rodadaAdicionada = rodadaParaAdicionar.nome;
              corAdicionado = tipoAdicao;

              // Se adicionou como vermelho, criar transação de depósito
              if (tipoAdicao === 'vermelho') {
                try {
                  await RodadaService.criarTransacaoParaVermelho(
                    rodadaParaAdicionar._id.toString(),
                    usuario._id.toString()
                  );
                  console.log(`💰 Transação criada para novo vermelho ${usuario.nome}`);
                } catch (transError) {
                  console.error('❌ Erro ao criar transação:', transError);
                }
              }

              // Se for amarelo e completou 15, iniciar rodada automaticamente
              if (tipoAdicao === 'amarelo' && (participantesAtuais + 1) >= 15) {
                console.log(`🎯 Rodada ${rodadaParaAdicionar.nome} completou 15 participantes! Iniciando...`);
                setTimeout(() => {
                  RodadaService.iniciarRodada(rodadaParaAdicionar._id.toString())
                    .then(() => console.log(`✅ Rodada ${rodadaParaAdicionar.nome} iniciada!`))
                    .catch(err => console.error('❌ Erro ao iniciar rodada:', err));
                }, 100);
              }
            } else {
              console.log(`⚠️ Usuário ${usuario.nome} já está na rodada ${rodadaParaAdicionar.nome}`);
            }
          }
        }
        // --- FIM DA REGRA ---
      }
    }

    await usuario.save();

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

    // Validação básica
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