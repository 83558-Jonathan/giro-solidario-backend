const Rodada = require('../models/Rodada');
const User = require('../models/User');
const Transacao = require('../models/Transacao');

// No topo do arquivo, antes da classe RodadaService
const pagamentosProcessadosService = new Map(); // Cache para controle de pagamentos processados

class RodadaService {

  // ===========================================
  // CRIAR NOVA RODADA
  // ===========================================
  async criarRodada(criadorId) {
    try {
      const ultimaRodada = await Rodada.findOne().sort({ numero: -1 });
      const novoNumero = ultimaRodada ? ultimaRodada.numero + 1 : 1;

      const criador = await User.findById(criadorId);
      if (!criador) throw new Error('Criador não encontrado');

      const rodada = new Rodada({
        numero: novoNumero,
        nome: `Rodada #${novoNumero}`,
        status: 'aguardando',
        participantes: [{
          usuario: criadorId,
          cor: 'amarelo',
          posicao: 1,
          dataEntrada: new Date(),
          depositoConfirmado: false
        }],
        totalDepositosConfirmados: 0,
        todosDepositaram: false,
        historicoMovimentacoes: []
      });

      await rodada.save();
      console.log(`✅ Rodada ${rodada.nome} criada com sucesso por ${criador.nome}`);
      console.log(`📊 Participante inicial: ${criador.nome} (amarelo) - 1/15`);

      return rodada;
    } catch (error) {
      console.error('❌ Erro ao criar rodada:', error);
      throw error;
    }
  }

  // ===========================================
  // ADICIONAR PARTICIPANTE AMARELO (rodada aguardando)
  // ===========================================
  async adicionarParticipanteAmarelo(rodadaId, usuarioId, indicadorId = null) {
    try {
      const rodada = await Rodada.findById(rodadaId);
      if (!rodada) throw new Error('Rodada não encontrada');

      if (rodada.status !== 'aguardando') {
        throw new Error('Só é possível adicionar participantes em rodadas que ainda não iniciaram');
      }

      if (rodada.participantes.length >= 15) {
        throw new Error('Rodada já está completa (15 participantes)');
      }

      const existe = rodada.participantes.find(
        p => p.usuario.toString() === usuarioId
      );
      if (existe) throw new Error('Usuário já está nesta rodada');

      const usuario = await User.findById(usuarioId);
      if (!usuario) throw new Error('Usuário não encontrado');

      rodada.participantes.push({
        usuario: usuarioId,
        cor: 'amarelo',
        posicao: rodada.participantes.length + 1,
        dataEntrada: new Date(),
        depositoConfirmado: false,
        indicadoPor: indicadorId || null
      });

      if (indicadorId) {
        await User.findByIdAndUpdate(usuarioId, { indicadoPor: indicadorId });
        await User.findByIdAndUpdate(indicadorId, {
          $inc: { totalIndicacoes: 1 },
          $push: { meusIndicados: usuarioId }
        });
      }

      await rodada.save();

      console.log(`✅ Participante ${usuario.nome} adicionado à ${rodada.nome} (amarelo)`);
      console.log(`📊 Progresso: ${rodada.participantes.length}/15 participantes`);

      if (rodada.participantes.length === 15) {
        console.log(`🎯 Rodada ${rodada.nome} completou 15 participantes! Iniciando...`);
        await this.iniciarRodada(rodadaId);
      }

      return rodada;
    } catch (error) {
      console.error('❌ Erro ao adicionar participante amarelo:', error);
      throw error;
    }
  }

  // Adicionar participante como VERMELHO
  async adicionarParticipanteVermelho(rodadaId, usuarioId, indicadorId = null) {
    try {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`🔴 [VERMELHO] INICIANDO PROCESSO`);
      console.log(`${'='.repeat(60)}`);
      console.log(`   Rodada ID: ${rodadaId}`);
      console.log(`   Usuário ID: ${usuarioId}`);
      console.log(`   Indicador ID: ${indicadorId || 'nenhum'}`);

      const rodada = await Rodada.findById(rodadaId);
      if (!rodada) {
        console.error(`❌ [VERMELHO] Rodada não encontrada: ${rodadaId}`);
        throw new Error('Rodada não encontrada');
      }

      console.log(`\n📊 DADOS DA RODADA:`);
      console.log(`   Nome: ${rodada.nome}`);
      console.log(`   Status: ${rodada.status}`);
      console.log(`   Participantes: ${rodada.participantes.length}/15`);
      console.log(`   Verde definido: ${rodada.verde ? 'SIM' : 'NÃO'}`);
      console.log(`   Pretos: ${rodada.pretos?.length || 0}`);
      console.log(`   Azuis: ${rodada.azuis?.length || 0}`);
      console.log(`   Vermelhos: ${rodada.vermelhos?.length || 0}`);

      // Contar participantes por cor
      const cores = {
        verde: rodada.participantes.filter(p => p.cor === 'verde').length,
        preto: rodada.participantes.filter(p => p.cor === 'preto').length,
        azul: rodada.participantes.filter(p => p.cor === 'azul').length,
        vermelho: rodada.participantes.filter(p => p.cor === 'vermelho').length,
        amarelo: rodada.participantes.filter(p => p.cor === 'amarelo').length
      };
      console.log(`   Distribuição de cores:`);
      console.log(`      🟢 Verde: ${cores.verde}`);
      console.log(`      ⚫ Preto: ${cores.preto}`);
      console.log(`      🔵 Azul: ${cores.azul}`);
      console.log(`      🔴 Vermelho: ${cores.vermelho}`);
      console.log(`      🟡 Amarelo: ${cores.amarelo}`);

      // VERIFICAR SE A RODADA PODE RECEBER VERMELHOS
      const temEstrutura = rodada.verde && rodada.pretos && rodada.azuis;
      const podeReceberVermelho = rodada.status === 'em_andamento' ||
        (rodada.status === 'aguardando' && temEstrutura);

      console.log(`\n🔍 VERIFICANDO SE PODE RECEBER VERMELHO:`);
      console.log(`   Status: ${rodada.status}`);
      console.log(`   Tem estrutura (verde/pretos/azuis): ${temEstrutura ? 'SIM' : 'NÃO'}`);
      console.log(`   Pode receber vermelho: ${podeReceberVermelho ? 'SIM' : 'NÃO'}`);

      if (!podeReceberVermelho) {
        console.log(`\n⚠️ [VERMELHO] Rodada NÃO pode receber vermelhos!`);
        console.log(`   Motivo: ${rodada.status === 'aguardando' && !temEstrutura ? 'Rodada em formação (aguardando completar 15 participantes)' : 'Status inválido'}`);
        console.log(`   → Será adicionado como AMARELO na rodada ${rodada.nome}\n`);

        // Em vez de lançar erro, chama adicionarParticipanteAmarelo
        return await this.adicionarParticipanteAmarelo(rodadaId, usuarioId, indicadorId);
      }

      // Verificar se ainda há vagas para vermelhos (máximo 8)
      const vermelhosAtuais = rodada.participantes.filter(p => p.cor === 'vermelho').length;
      console.log(`\n📊 VERIFICANDO VAGAS:`);
      console.log(`   Vermelhos atuais: ${vermelhosAtuais}/8`);
      console.log(`   Vagas disponíveis: ${8 - vermelhosAtuais}`);

      if (vermelhosAtuais >= 8) {
        console.error(`❌ [VERMELHO] Rodada já possui 8 vermelhos`);
        throw new Error('Esta rodada já possui 8 vermelhos. Aguarde a próxima rodada.');
      }

      // Verificar se usuário já está na rodada
      const existe = rodada.participantes.find(
        p => p.usuario.toString() === usuarioId
      );
      if (existe) {
        console.error(`❌ [VERMELHO] Usuário ${usuarioId} já está nesta rodada`);
        throw new Error('Usuário já está nesta rodada');
      }

      // Buscar usuário
      console.log(`\n👤 BUSCANDO USUÁRIO...`);
      const usuario = await User.findById(usuarioId);
      if (!usuario) {
        console.error(`❌ [VERMELHO] Usuário não encontrado: ${usuarioId}`);
        throw new Error(`Usuário não encontrado: ${usuarioId}`);
      }
      console.log(`✅ Usuário encontrado: ${usuario.nome} (${usuario.email})`);

      // Adicionar como vermelho
      console.log(`\n➕ ADICIONANDO PARTICIPANTE...`);
      const novaPosicao = rodada.participantes.length + 1;
      console.log(`   Posição: ${novaPosicao}`);
      console.log(`   Cor: VERMELHO`);

      rodada.participantes.push({
        usuario: usuarioId,
        cor: 'vermelho',
        posicao: novaPosicao,
        dataEntrada: new Date(),
        depositoConfirmado: false,
        indicadoPor: indicadorId || null
      });

      // Atualizar array de vermelhos da rodada
      rodada.vermelhos.push(usuarioId);
      console.log(`   Vermelhos agora: ${rodada.vermelhos.length}/8`);

      if (indicadorId) {
        console.log(`   Atualizando indicação...`);
        await User.findByIdAndUpdate(usuarioId, { indicadoPor: indicadorId });
        await User.findByIdAndUpdate(indicadorId, {
          $inc: { totalIndicacoes: 1 },
          $push: { meusIndicados: usuarioId }
        });
        console.log(`   ✅ Indicação registrada para ${indicadorId}`);
      }

      // Verificar se completou 15 participantes
      console.log(`\n🎯 VERIFICANDO COMPLETUDE DA RODADA:`);
      console.log(`   Participantes agora: ${rodada.participantes.length}/15`);

      if (rodada.participantes.length === 15) {
        console.log(`🎉 Rodada ${rodada.nome} completou 15 participantes!`);

        // Se estava aguardando, agora inicia
        if (rodada.status === 'aguardando') {
          console.log(`   Status antes: aguardando`);
          rodada.status = 'em_andamento';
          console.log(`   Status depois: em_andamento`);
        }

        await rodada.save();
        console.log(`   ✅ Rodada salva`);

        // Criar transações para todos os vermelhos
        console.log(`   💰 Criando transações para ${rodada.vermelhos.length} vermelhos...`);
        await this.criarTransacoesParaVermelhos(rodadaId);
        console.log(`   ✅ Transações criadas`);
      } else {
        await rodada.save();
        console.log(`   ✅ Rodada salva (ainda faltam ${15 - rodada.participantes.length} participantes)`);
      }

      console.log(`\n✅ [VERMELHO] PROCESSO CONCLUÍDO COM SUCESSO!`);
      console.log(`   Usuário: ${usuario.nome}`);
      console.log(`   Rodada: ${rodada.nome}`);
      console.log(`   Status rodada: ${rodada.status}`);
      console.log(`   Total participantes: ${rodada.participantes.length}/15`);
      console.log(`   Total vermelhos: ${rodada.vermelhos.length}/8`);
      console.log(`${'='.repeat(60)}\n`);

      return rodada;
    } catch (error) {
      console.error(`\n❌ [VERMELHO] ERRO:`);
      console.error(`   Mensagem: ${error.message}`);
      console.error(`   Stack: ${error.stack}`);
      console.log(`${'='.repeat(60)}\n`);
      throw error;
    }
  }

  // Adicionar participante como AMARELO (rodada aguardando)
  async adicionarParticipanteAmarelo(rodadaId, usuarioId, indicadorId = null) {
    try {
      console.log(`🔍 [AMARELO] Tentando adicionar usuário ${usuarioId} à rodada ${rodadaId}`);

      const rodada = await Rodada.findById(rodadaId);
      if (!rodada) {
        console.error(`❌ [AMARELO] Rodada não encontrada: ${rodadaId}`);
        throw new Error('Rodada não encontrada');
      }

      if (rodada.status !== 'aguardando') {
        console.error(`❌ [AMARELO] Rodada não está aguardando. Status: ${rodada.status}`);
        throw new Error('Só é possível adicionar participantes em rodadas que ainda não iniciaram');
      }

      if (rodada.participantes.length >= 15) {
        console.error(`❌ [AMARELO] Rodada já está completa`);
        throw new Error('Rodada já está completa (15 participantes)');
      }

      const existe = rodada.participantes.find(
        p => p.usuario.toString() === usuarioId
      );
      if (existe) {
        console.error(`❌ [AMARELO] Usuário ${usuarioId} já está nesta rodada`);
        throw new Error('Usuário já está nesta rodada');
      }

      console.log(`🔍 [AMARELO] Buscando usuário ${usuarioId}...`);
      const usuario = await User.findById(usuarioId);
      if (!usuario) {
        console.error(`❌ [AMARELO] Usuário não encontrado: ${usuarioId}`);
        throw new Error(`Usuário não encontrado: ${usuarioId}`);
      }
      console.log(`✅ [AMARELO] Usuário encontrado: ${usuario.nome}`);

      rodada.participantes.push({
        usuario: usuarioId,
        cor: 'amarelo',
        posicao: rodada.participantes.length + 1,
        dataEntrada: new Date(),
        depositoConfirmado: false,
        indicadoPor: indicadorId || null
      });

      if (indicadorId) {
        await User.findByIdAndUpdate(usuarioId, { indicadoPor: indicadorId });
        await User.findByIdAndUpdate(indicadorId, {
          $inc: { totalIndicacoes: 1 },
          $push: { meusIndicados: usuarioId }
        });
      }

      await rodada.save();

      console.log(`✅ Participante ${usuario.nome} adicionado à ${rodada.nome} (amarelo)`);
      console.log(`📊 Progresso: ${rodada.participantes.length}/15 participantes`);

      // VERIFICAR SE COMPLETOU 15 PARTICIPANTES
      if (rodada.participantes.length === 15) {
        console.log(`🎯 Rodada ${rodada.nome} completou 15 participantes! Iniciando...`);
        await this.iniciarRodada(rodadaId);
      }

      return rodada;
    } catch (error) {
      console.error('❌ Erro ao adicionar participante amarelo:', error);
      throw error;
    }
  }

  // ===========================================
  // CRIAR TRANSAÇÃO INDIVIDUAL PARA VERMELHO
  // ===========================================
  async criarTransacaoParaVermelho(rodadaId, vermelhoId) {
    try {
      const rodada = await Rodada.findById(rodadaId);
      if (!rodada) throw new Error('Rodada não encontrada');

      const verdeId = rodada.verde;
      if (!verdeId) throw new Error('Verde não definido na rodada');

      const transacao = new Transacao({
        tipo: 'deposito',
        pagador: vermelhoId,
        recebedor: verdeId,
        valor: 125,
        rodada: rodadaId,
        status: 'pendente'
      });

      await transacao.save();

      // Associar transação ao participante
      const participante = rodada.participantes.find(p => p.usuario.toString() === vermelhoId.toString());
      if (participante) {
        participante.transacaoId = transacao._id;
        await rodada.save();
      }

      console.log(`💰 Transação criada para vermelho ${vermelhoId} pagar ao verde ${verdeId}`);
      return transacao;
    } catch (error) {
      console.error('❌ Erro ao criar transação para vermelho:', error);
      throw error;
    }
  }

  // Iniciar rodada (distribuir cores)
  async iniciarRodada(rodadaId) {
    try {
      const rodada = await Rodada.findById(rodadaId);
      if (!rodada) throw new Error('Rodada não encontrada');

      if (rodada.participantes.length !== 15) {
        throw new Error(`Rodada precisa ter 15 participantes (tem ${rodada.participantes.length})`);
      }

      if (rodada.status !== 'aguardando') {
        throw new Error(`Rodada já está ${rodada.status}`);
      }

      console.log(`🚀 Iniciando rodada ${rodada.nome}...`);

      // Embaralhar participantes para distribuição aleatória
      const shuffled = [...rodada.participantes].sort(() => Math.random() - 0.5);

      // Distribuir cores: 1 verde, 2 pretos, 4 azuis, 8 vermelhos
      shuffled[0].cor = 'verde';
      shuffled[1].cor = 'preto';
      shuffled[2].cor = 'preto';
      for (let i = 3; i < 7; i++) shuffled[i].cor = 'azul';
      for (let i = 7; i < 15; i++) shuffled[i].cor = 'vermelho';

      // Atualizar listas de cores
      rodada.verde = shuffled[0].usuario;
      rodada.pretos = [shuffled[1].usuario, shuffled[2].usuario];
      rodada.azuis = shuffled.slice(3, 7).map(p => p.usuario);
      rodada.vermelhos = shuffled.slice(7, 15).map(p => p.usuario);

      // Registrar histórico
      shuffled.forEach(p => {
        rodada.historicoMovimentacoes.push({
          usuario: p.usuario,
          corAnterior: 'amarelo',
          corNova: p.cor,
          observacao: 'Início da rodada',
          data: new Date()
        });
      });

      rodada.status = 'em_andamento';
      rodada.dataInicio = new Date();
      rodada.participantes = shuffled;

      await rodada.save();

      console.log(`✅ Rodada ${rodada.nome} iniciada com sucesso!`);
      console.log(`   🟢 Verde: ${shuffled[0].usuario}`);
      console.log(`   ⚫ Pretos: 2`);
      console.log(`   🔵 Azuis: 4`);
      console.log(`   🔴 Vermelhos: 8`);

      // ===========================================
      // CRIAR TRANSAÇÕES PARA TODOS OS VERMELHOS
      // ===========================================
      await this.criarTransacoesParaVermelhos(rodadaId);

      return rodada;
    } catch (error) {
      console.error('❌ Erro ao iniciar rodada:', error);
      throw error;
    }
  }

  // ===========================================
  // CRIAR TRANSAÇÕES INICIAIS (8 vermelhos)
  // ===========================================
  async criarTransacoesIniciais(rodadaId) {
    try {
      const rodada = await Rodada.findById(rodadaId);
      if (!rodada) throw new Error('Rodada não encontrada');

      const transacoes = [];
      const verde = rodada.verde;
      const valor = 125;
      const vermelhos = rodada.vermelhos || [];

      if (!verde) throw new Error('Verde não definido');
      if (vermelhos.length === 0) throw new Error('Vermelhos não definidos');

      for (const vermelhoId of vermelhos) {
        const existe = await Transacao.findOne({
          pagador: vermelhoId,
          rodada: rodadaId
        });

        if (!existe) {
          const transacao = new Transacao({
            tipo: 'deposito',
            pagador: vermelhoId,
            recebedor: verde,
            valor: valor,
            rodada: rodadaId,
            status: 'pendente'
          });

          await transacao.save();
          transacoes.push(transacao);

          const participante = rodada.participantes.find(
            p => p.usuario.toString() === vermelhoId.toString()
          );
          if (participante) {
            participante.transacaoId = transacao._id;
          }
        }
      }

      if (transacoes.length > 0) {
        await rodada.save();
      }

      console.log(`✅ ${transacoes.length} transações criadas para rodada ${rodada.nome}`);
      return transacoes;
    } catch (error) {
      console.error('❌ Erro ao criar transações:', error);
      throw error;
    }
  }

  // ===========================================
  // CONFIRMAR DEPÓSITO
  // ===========================================
  async confirmarDeposito(transacaoId, comprovanteUrl, confirmadoPorId) {
    try {
      // VERIFICAR SE JÁ FOI PROCESSADO RECENTEMENTE
      if (pagamentosProcessadosService.has(transacaoId)) {
        const processadoEm = pagamentosProcessadosService.get(transacaoId);
        const segundosDesdeProcessamento = (Date.now() - processadoEm) / 1000;
        console.log(`⚠️ [confirmarDeposito] Pagamento ${transacaoId} já foi processado há ${segundosDesdeProcessamento.toFixed(1)}s. Ignorando.`);
        return { transacao: null, todosDepositaram: false, jaProcessado: true };
      }

      pagamentosProcessadosService.set(transacaoId, Date.now());

      // Limpar do cache após 10 minutos
      setTimeout(() => {
        if (pagamentosProcessadosService.has(transacaoId)) {
          pagamentosProcessadosService.delete(transacaoId);
          console.log(`🧹 [confirmarDeposito] Cache do pagamento ${transacaoId} removido após 10 minutos`);
        }
      }, 10 * 60 * 1000);

      console.log(`🔍 [confirmarDeposito] Iniciando confirmação de depósito para transação: ${transacaoId}`);

      // BUSCAR TRANSAÇÃO
      const transacao = await Transacao.findById(transacaoId);
      if (!transacao) {
        console.error(`❌ [confirmarDeposito] Transação não encontrada: ${transacaoId}`);
        pagamentosProcessadosService.delete(transacaoId);
        throw new Error('Transação não encontrada');
      }

      console.log(`📝 [confirmarDeposito] Transação encontrada:`, {
        id: transacao._id,
        pagador: transacao.pagador,
        status: transacao.status,
        rodada: transacao.rodada
      });

      // VERIFICAÇÃO DE DUPLICIDADE POR STATUS
      if (transacao.status !== 'pendente') {
        console.log(`⚠️ [confirmarDeposito] Transação ${transacaoId} já foi processada. Status atual: ${transacao.status}`);
        pagamentosProcessadosService.delete(transacaoId);
        return { transacao, todosDepositaram: false, jaProcessado: true };
      }

      // ATUALIZAR TRANSAÇÃO
      transacao.status = 'confirmado';
      transacao.comprovante = comprovanteUrl;
      transacao.dataConfirmacao = new Date();
      transacao.confirmadoPor = confirmadoPorId;

      await transacao.save();
      console.log(`✅ [confirmarDeposito] Transação ${transacaoId} atualizada para status: confirmado`);

      // BUSCAR RODADA
      const rodada = await Rodada.findById(transacao.rodada);
      if (!rodada) {
        console.error(`❌ [confirmarDeposito] Rodada não encontrada: ${transacao.rodada}`);
        pagamentosProcessadosService.delete(transacaoId);
        throw new Error('Rodada não encontrada');
      }

      console.log(`📊 [confirmarDeposito] Rodada encontrada: ${rodada.nome} (${rodada.status})`);

      // ENCONTRAR PARTICIPANTE
      const participante = rodada.participantes.find(
        p => p.usuario.toString() === transacao.pagador.toString()
      );

      if (!participante) {
        console.error(`❌ [confirmarDeposito] Participante não encontrado na rodada para usuário: ${transacao.pagador}`);
        pagamentosProcessadosService.delete(transacaoId);
        throw new Error('Participante não encontrado na rodada');
      }

      console.log(`👤 [confirmarDeposito] Participante encontrado: cor=${participante.cor}, depositoConfirmado antes=${participante.depositoConfirmado}`);

      // VERIFICAR SE PARTICIPANTE JÁ ESTÁ PAGO
      if (participante.depositoConfirmado === true) {
        console.log(`⚠️ [confirmarDeposito] Participante ${participante.usuario} já estava marcado como pago. Ignorando.`);
        pagamentosProcessadosService.delete(transacaoId);
        return { transacao, todosDepositaram: false, jaProcessado: true };
      }

      // MARCAR PARTICIPANTE COMO PAGO
      participante.depositoConfirmado = true;
      participante.dataDeposito = new Date();
      participante.comprovantePix = comprovanteUrl;

      // CONTAR VERMELHOS PAGOS
      const vermelhos = rodada.participantes.filter(p => p.cor === 'vermelho');
      const vermelhosPagos = vermelhos.filter(v => v.depositoConfirmado === true);

      rodada.totalDepositosConfirmados = vermelhosPagos.length;

      console.log(`📊 [confirmarDeposito] Progresso pagamentos: ${vermelhosPagos.length}/${vermelhos.length}`);

      await rodada.save();
      console.log(`✅ [confirmarDeposito] Participante atualizado e rodada salva`);

      // VERIFICAR SE TODOS PAGARAM
      let todosDepositaram = false;
      if (vermelhosPagos.length === vermelhos.length && vermelhos.length > 0) {
        console.log(`🎉 [confirmarDeposito] TODOS OS ${vermelhos.length} VERMELHOS PAGARAM!`);

        if (!rodada.todosDepositaram) {
          rodada.todosDepositaram = true;
          rodada.dataTodosDepositaram = new Date();
          await rodada.save();
          console.log(`✅ [confirmarDeposito] Rodada marcada como "todos depositaram"`);
        }

        todosDepositaram = true;

        console.log(`🚀 [confirmarDeposito] Chamando avancarRodada...`);
        await this.avancarRodada(rodada._id);
        console.log(`✅ [confirmarDeposito] avancarRodada concluído`);
      }

      console.log(`✅ [confirmarDeposito] Processo concluído com sucesso para transação ${transacaoId}`);

      return {
        transacao,
        todosDepositaram,
        progresso: `${vermelhosPagos.length}/${vermelhos.length}`,
        jaProcessado: false
      };

    } catch (error) {
      console.error('❌ [confirmarDeposito] Erro ao confirmar depósito:', error);
      console.error('❌ [confirmarDeposito] Stack trace:', error.stack);

      if (transacaoId) {
        pagamentosProcessadosService.delete(transacaoId);
      }

      throw error;
    }
  }

  // Criar transações para TODOS os vermelhos da rodada (quando a rodada estiver completa)
  async criarTransacoesParaVermelhos(rodadaId) {
    try {
      const rodada = await Rodada.findById(rodadaId);
      if (!rodada) throw new Error('Rodada não encontrada');

      const verdeId = rodada.verde;
      if (!verdeId) throw new Error('Verde não definido na rodada');

      const vermelhos = rodada.vermelhos || [];
      if (vermelhos.length === 0) {
        console.log(`⚠️ Nenhum vermelho para criar transações na rodada ${rodada.nome}`);
        return [];
      }

      console.log(`💰 Criando ${vermelhos.length} transações para a rodada ${rodada.nome}...`);

      const transacoes = [];
      for (const vermelhoId of vermelhos) {
        // Verificar se já existe transação para este vermelho
        const existe = await Transacao.findOne({
          pagador: vermelhoId,
          rodada: rodadaId
        });

        if (!existe) {
          const transacao = new Transacao({
            tipo: 'deposito',
            pagador: vermelhoId,
            recebedor: verdeId,
            valor: 125,
            rodada: rodadaId,
            status: 'pendente'
          });

          await transacao.save();
          transacoes.push(transacao);

          // Associar transação ao participante
          const participante = rodada.participantes.find(
            p => p.usuario.toString() === vermelhoId.toString()
          );
          if (participante) {
            participante.transacaoId = transacao._id;
          }

          console.log(`   ✅ Transação criada para vermelho ${vermelhoId}`);
        }
      }

      if (transacoes.length > 0) {
        await rodada.save();
      }

      console.log(`✅ ${transacoes.length} transações criadas para rodada ${rodada.nome}`);
      return transacoes;
    } catch (error) {
      console.error('❌ Erro ao criar transações para vermelhos:', error);
      throw error;
    }
  }

  // ===========================================
  // VERIFICAR SE TODOS DEPOSITARAM
  // ===========================================
  async verificarTodosDepositos(rodadaId) {
    try {
      console.log(`🔍 [DEBUG] Verificando depósitos da rodada: ${rodadaId}`);

      const rodada = await Rodada.findById(rodadaId);
      if (!rodada) {
        console.error(`❌ [DEBUG] Rodada não encontrada: ${rodadaId}`);
        throw new Error('Rodada não encontrada');
      }

      console.log(`📊 [DEBUG] Rodada: ${rodada.nome}, Status: ${rodada.status}`);

      const vermelhos = rodada.participantes.filter(p => p.cor === 'vermelho');
      const vermelhosPagos = vermelhos.filter(v => v.depositoConfirmado === true);
      const todosDepositaram = vermelhosPagos.length === vermelhos.length && vermelhos.length > 0;

      console.log(`📊 [DEBUG] Vermelhos: ${vermelhos.length}, Pagos: ${vermelhosPagos.length}, Todos pagaram: ${todosDepositaram}`);

      vermelhos.forEach(v => {
        console.log(`   🔴 Vermelho: ${v.usuario} - Pago: ${v.depositoConfirmado}`);
      });

      if (todosDepositaram && !rodada.todosDepositaram) {
        console.log(`🎉 [DEBUG] TODOS DEPOSITARAM! Avançando rodada...`);
        rodada.todosDepositaram = true;
        rodada.dataTodosDepositaram = new Date();
        rodada.totalDepositosConfirmados = vermelhosPagos.length;
        await rodada.save();
        console.log(`✅ [DEBUG] Rodada atualizada com todosDepositaram=true`);

        console.log(`🚀 [DEBUG] Chamando avancarRodada...`);
        await this.avancarRodada(rodadaId);
        console.log(`✅ [DEBUG] avancarRodada concluído`);
      } else {
        if (rodada.totalDepositosConfirmados !== vermelhosPagos.length) {
          rodada.totalDepositosConfirmados = vermelhosPagos.length;
          await rodada.save();
          console.log(`📊 [DEBUG] Atualizado totalDepositosConfirmados: ${vermelhosPagos.length}`);
        } else {
          console.log(`📊 [DEBUG] Nenhuma mudança no total de depósitos`);
        }
      }

      return todosDepositaram;
    } catch (error) {
      console.error('❌ Erro ao verificar depósitos:', error);
      throw error;
    }
  }

  // ===========================================
  // AVANÇAR RODADA - PROMOVER CORES E GERAR NOVAS RODADAS
  // ===========================================
  async avancarRodada(rodadaId) {
    try {
      console.log(`🚀 [DEBUG] INICIANDO avancarRodada para: ${rodadaId}`);

      const rodada = await Rodada.findById(rodadaId);
      if (!rodada) {
        console.error(`❌ [DEBUG] Rodada não encontrada: ${rodadaId}`);
        throw new Error('Rodada não encontrada');
      }

      console.log(`📊 [DEBUG] Rodada: ${rodada.nome}, Status atual: ${rodada.status}`);

      if (rodada.status === 'concluida') {
        console.log(`⚠️ [DEBUG] Rodada ${rodada.nome} já está concluída. Ignorando.`);
        return rodada;
      }

      if (rodada.status !== 'em_andamento') {
        console.error(`❌ [DEBUG] Rodada não está em andamento. Status: ${rodada.status}`);
        throw new Error('Rodada não está em andamento');
      }

      console.log(`🔄 [DEBUG] Promovendo cores...`);

      // Salvar o verde atual antes de promover
      const verdeAtual = rodada.participantes.find(p => p.cor === 'verde');
      console.log(`💰 [DEBUG] Verde atual que receberá R$ 900: ${verdeAtual?.usuario}`);

      // Contadores para debug
      let contador = {
        vermelho_para_azul: 0,
        azul_para_preto: 0,
        preto_para_verde: 0,
        verde_para_concluido: 0
      };

      // PROMOVER CORES
      rodada.participantes.forEach(p => {
        if (p.cor === 'vermelho') {
          p.cor = 'azul';
          contador.vermelho_para_azul++;
          console.log(`   🔴→🔵 ${p.usuario}`);
        } else if (p.cor === 'azul') {
          p.cor = 'preto';
          contador.azul_para_preto++;
          console.log(`   🔵→⚫ ${p.usuario}`);
        } else if (p.cor === 'preto') {
          p.cor = 'verde';
          contador.preto_para_verde++;
          console.log(`   ⚫→🟢 ${p.usuario}`);
        } else if (p.cor === 'verde') {
          p.cor = 'concluido';
          contador.verde_para_concluido++;
          console.log(`   🟢→✅ ${p.usuario} (concluído)`);
        }
      });

      console.log(`📊 [DEBUG] Resumo promoção:`);
      console.log(`   🔴→🔵: ${contador.vermelho_para_azul}`);
      console.log(`   🔵→⚫: ${contador.azul_para_preto}`);
      console.log(`   ⚫→🟢: ${contador.preto_para_verde}`);
      console.log(`   🟢→✅: ${contador.verde_para_concluido}`);

      // Atualizar listas de cores após promoção
      const novosVerdes = rodada.participantes.filter(p => p.cor === 'verde');
      const novosPretos = rodada.participantes.filter(p => p.cor === 'preto');
      const novosAzuis = rodada.participantes.filter(p => p.cor === 'azul');
      const concluidos = rodada.participantes.filter(p => p.cor === 'concluido');

      console.log(`📊 [DEBUG] Após promoção:`);
      console.log(`   🟢 Verdes: ${novosVerdes.length}`);
      console.log(`   ⚫ Pretos: ${novosPretos.length}`);
      console.log(`   🔵 Azuis: ${novosAzuis.length}`);
      console.log(`   ✅ Concluídos: ${concluidos.length}`);

      // PAGAMENTO DO VERDE ANTIGO (R$ 900)
      // VERDE NÃO RECEBE AUTOMATICAMENTE - Apenas marca que o prêmio está pendente
      if (verdeAtual) {
        console.log(`💰 [DEBUG] Prêmio de R$ 900 disponível para o verde: ${verdeAtual.usuario}`);
        console.log(`   ⏳ Aguardando o verde clicar em "Sacar" para receber o prêmio`);
        // A rodada já foi marcada como concluída, o prêmio será pago via endpoint /sacar-premio
      }

      // GERAÇÃO DE NOVAS RODADAS
      // Quando temos 2 verdes, a rodada é concluída e gera 2 novas rodadas
      if (novosVerdes.length === 2) {
        console.log(`🎯 [DEBUG] 2 verdes encontrados! Gerando novas rodadas...`);

        rodada.status = 'concluida';
        rodada.dataFim = new Date();

        const verdesIds = novosVerdes.map(v => v.usuario);
        const pretosIds = novosPretos.map(p => p.usuario);
        const azuisIds = novosAzuis.map(a => a.usuario);

        console.log(`   🟢 Verdes para novas rodadas: ${verdesIds.join(', ')}`);
        console.log(`   ⚫ Pretos para distribuir: ${pretosIds.length}`);
        console.log(`   🔵 Azuis para distribuir: ${azuisIds.length}`);

        // Dividir os participantes em dois grupos
        // Cada nova rodada terá: 1 verde, 2 pretos (metade), 4 azuis (metade)
        const grupo1Pretos = pretosIds.slice(0, 2);
        const grupo2Pretos = pretosIds.slice(2, 4);
        const grupo1Azuis = azuisIds.slice(0, 4);
        const grupo2Azuis = azuisIds.slice(4, 8);

        // Obter próximo número da rodada
        const proximoNumero = await this.getProximoNumeroRodada();

        console.log(`🔨 [DEBUG] Criando rodada #${proximoNumero}...`);
        const novaRodada1 = await this.criarRodadaAvancada(
          proximoNumero,
          verdesIds[0],
          grupo1Pretos,
          grupo1Azuis,
          rodada._id
        );
        console.log(`✅ [DEBUG] Rodada #${proximoNumero} criada: ${novaRodada1._id}`);
        console.log(`   🟢 Verde: ${verdesIds[0]}`);
        console.log(`   ⚫ Pretos: ${grupo1Pretos.length}`);
        console.log(`   🔵 Azuis: ${grupo1Azuis.length}`);
        console.log(`   🔴 Vermelhos: 0 (AGUARDANDO NOVOS PARTICIPANTES)`);

        console.log(`🔨 [DEBUG] Criando rodada #${proximoNumero + 1}...`);
        const novaRodada2 = await this.criarRodadaAvancada(
          proximoNumero + 1,
          verdesIds[1],
          grupo2Pretos,
          grupo2Azuis,
          rodada._id
        );
        console.log(`✅ [DEBUG] Rodada #${proximoNumero + 1} criada: ${novaRodada2._id}`);
        console.log(`   🟢 Verde: ${verdesIds[1]}`);
        console.log(`   ⚫ Pretos: ${grupo2Pretos.length}`);
        console.log(`   🔵 Azuis: ${grupo2Azuis.length}`);
        console.log(`   🔴 Vermelhos: 0 (AGUARDANDO NOVOS PARTICIPANTES)`);

        rodada.rodadasGeradas = [novaRodada1._id, novaRodada2._id];

        console.log(`✅ [DEBUG] Rodadas geradas com sucesso!`);

        // ===========================================
        // 🔥 NOVA FUNCIONALIDADE: ALOCAR USUÁRIOS AGUARDANDO COMO VERMELHOS
        // ===========================================
        console.log(`\n🟡 [ALOCACAO] Buscando usuários aguardando vaga de vermelho...`);

        // Buscar usuários que estão aguardando vaga de vermelho (mais antigos primeiro)
        const usuariosAguardando = await User.find({ aguardandoVermelho: true }).sort({ createdAt: 1 });

        if (usuariosAguardando.length > 0) {
          console.log(`   📋 Encontrados ${usuariosAguardando.length} usuário(s) aguardando`);

          let index = 0;
          const vagasPorRodada = 8;
          const novasRodadas = [novaRodada1, novaRodada2];

          for (const rodadaNova of novasRodadas) {
            for (let vaga = 0; vaga < vagasPorRodada && index < usuariosAguardando.length; vaga++) {
              const usuario = usuariosAguardando[index];

              console.log(`\n   🔄 Processando usuário ${index + 1}/${usuariosAguardando.length}: ${usuario.nome}`);

              // 1. Remover o usuário da rodada amarela onde ele está
              const rodadaAmarela = await Rodada.findOne({
                'participantes.usuario': usuario._id,
                'participantes.cor': 'amarelo',
                status: 'aguardando'
              });

              if (rodadaAmarela) {
                const participanteAmarelo = rodadaAmarela.participantes.find(p => p.usuario.toString() === usuario._id.toString());
                if (participanteAmarelo) {
                  rodadaAmarela.participantes = rodadaAmarela.participantes.filter(p => p.usuario.toString() !== usuario._id.toString());
                  await rodadaAmarela.save();
                  console.log(`      🟡 Removido da rodada amarela ${rodadaAmarela.nome}`);
                }
              }

              // 2. Adicionar o usuário como VERMELHO na nova rodada
              await this.adicionarParticipanteVermelho(rodadaNova._id.toString(), usuario._id.toString(), null);

              // 3. Remover a flag de aguardando
              usuario.aguardandoVermelho = false;
              await usuario.save();

              console.log(`      🔴 Alocado como VERMELHO na rodada ${rodadaNova.nome}`);

              index++;
            }

            if (index >= usuariosAguardando.length) break;
          }

          const totalAlocados = Math.min(usuariosAguardando.length, 16); // máximo 16 vagas (8 por rodada)
          const restantes = usuariosAguardando.length - totalAlocados;

          console.log(`\n✅ [ALOCACAO] ${totalAlocados} usuário(s) alocados como VERMELHOS`);
          if (restantes > 0) {
            console.log(`   ⏳ ${restantes} usuário(s) ainda aguardando para próximas rodadas`);
          }
        } else {
          console.log(`   ✅ Nenhum usuário aguardando vaga de vermelho`);
        }

      } else {
        console.log(`⚠️ [DEBUG] Número de verdes insuficiente: ${novosVerdes.length}. Esperado: 2`);
      }

      // Atualizar arrays de cores na rodada
      rodada.verde = novosVerdes.length > 0 ? novosVerdes[0].usuario : null;
      rodada.pretos = novosPretos.map(p => p.usuario);
      rodada.azuis = novosAzuis.map(p => p.usuario);
      rodada.vermelhos = []; // Todos os vermelhos foram promovidos para azul

      await rodada.save();
      console.log(`✅ [DEBUG] Rodada ${rodada.nome} avançada com sucesso! Novo status: ${rodada.status}`);
      console.log(`📊 [DEBUG] Rodadas geradas: ${rodada.rodadasGeradas.length}`);

      return rodada;
    } catch (error) {
      console.error('❌ Erro ao avançar rodada:', error);
      console.error('❌ Stack trace:', error.stack);
      throw error;
    }
  }

  // Método auxiliar para criar rodada avançada
  async criarRodadaAvancada(numero, verdeId, pretosIds, azuisIds, rodadaOrigemId) {
    try {
      const rodada = new Rodada({
        numero: numero,
        nome: `Rodada #${numero}`,
        status: 'aguardando', // <-- ALTERADO: começa AGUARDANDO, não em_andamento
        participantes: [],
        totalDepositosConfirmados: 0,
        todosDepositaram: false,
        historicoMovimentacoes: [],
        rodadaOrigem: rodadaOrigemId
      });

      // Adicionar verde (já está na posição correta)
      rodada.participantes.push({
        usuario: verdeId,
        cor: 'verde',  // Mantém como verde porque é a cor inicial
        posicao: 1,
        dataEntrada: new Date(),
        depositoConfirmado: false
      });

      // Adicionar pretos
      pretosIds.forEach(id => {
        rodada.participantes.push({
          usuario: id,
          cor: 'preto',
          posicao: rodada.participantes.length + 1,
          dataEntrada: new Date(),
          depositoConfirmado: false
        });
      });

      // Adicionar azuis
      azuisIds.forEach(id => {
        rodada.participantes.push({
          usuario: id,
          cor: 'azul',
          posicao: rodada.participantes.length + 1,
          dataEntrada: new Date(),
          depositoConfirmado: false
        });
      });

      // Atualizar listas de cores
      rodada.verde = verdeId;
      rodada.pretos = pretosIds;
      rodada.azuis = azuisIds;
      rodada.vermelhos = []; // Vermelhos serão adicionados depois quando novos usuários entrarem

      await rodada.save();

      console.log(`✅ Rodada avançada ${rodada.nome} criada com ${rodada.participantes.length} participantes`);
      console.log(`   🟢 Verde: 1`);
      console.log(`   ⚫ Pretos: ${pretosIds.length}`);
      console.log(`   🔵 Azuis: ${azuisIds.length}`);
      console.log(`   🔴 Vermelhos: 0 (aguardando novos convidados)`);
      console.log(`   📌 Status: AGUARDANDO (precisa de mais ${15 - rodada.participantes.length} participantes)`);

      return rodada;
    } catch (error) {
      console.error('❌ Erro ao criar rodada avançada:', error);
      throw error;
    }
  }

  // ===========================================
  // UTILITÁRIOS
  // ===========================================
  async getProximoNumeroRodada() {
    try {
      const ultimaRodada = await Rodada.findOne().sort({ numero: -1 });
      return ultimaRodada ? ultimaRodada.numero + 1 : 1;
    } catch (error) {
      console.error('❌ Erro ao obter próximo número:', error);
      return 1;
    }
  }

  async buscarRodadaAtivaDoUsuario(usuarioId) {
    try {
      const rodada = await Rodada.findOne({
        status: 'aguardando',
        'participantes.usuario': usuarioId
      });
      return rodada;
    } catch (error) {
      console.error('❌ Erro ao buscar rodada ativa:', error);
      return null;
    }
  }

  // Buscar rodada do usuário que aceita novos vermelhos
  async buscarRodadaParaNovoVermelho(usuarioId) {
    try {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`🔍 [buscarRodadaParaNovoVermelho] INICIANDO BUSCA`);
      console.log(`${'='.repeat(60)}`);
      console.log(`   Usuário ID: ${usuarioId}`);

      const user = await User.findById(usuarioId);
      console.log(`   Usuário: ${user?.nome || 'não encontrado'}`);

      // Buscar rodadas do usuário que estão em 'em_andamento' ou 'aguardando'
      const rodadasDoUsuario = await Rodada.find({
        'participantes.usuario': usuarioId,
        status: { $in: ['em_andamento', 'aguardando'] }
      }).sort({ numero: -1 });

      console.log(`\n📊 RODADAS ENCONTRADAS: ${rodadasDoUsuario.length}`);

      if (rodadasDoUsuario.length === 0) {
        console.log(`   ❌ Nenhuma rodada encontrada para o usuário`);
        console.log(`${'='.repeat(60)}\n`);
        return null;
      }

      // 🔥 PRIORIDADE 1: Rodadas que JÁ TEM estrutura e podem receber vermelho (em_andamento ou aguardando com estrutura)
      for (const rodada of rodadasDoUsuario) {
        const vermelhosAtuais = rodada.participantes.filter(p => p.cor === 'vermelho').length;
        const temEstrutura = !!(rodada.verde && rodada.pretos && rodada.azuis);

        // Pode receber vermelho se: 
        // 1. Está em_andamento, OU
        // 2. Está aguardando mas já tem estrutura (rodadas avançadas)
        const podeReceberVermelho = rodada.status === 'em_andamento' ||
          (rodada.status === 'aguardando' && temEstrutura);

        console.log(`\n   🔎 Analisando rodada ${rodada.nome}:`);
        console.log(`      - Status: ${rodada.status}`);
        console.log(`      - Tem estrutura: ${temEstrutura ? 'SIM' : 'NÃO'}`);
        console.log(`      - Pode receber vermelho: ${podeReceberVermelho ? 'SIM' : 'NÃO'}`);
        console.log(`      - Vermelhos atuais: ${vermelhosAtuais}/8`);
        console.log(`      - Total participantes: ${rodada.participantes.length}/15`);

        if (vermelhosAtuais < 8 && podeReceberVermelho) {
          console.log(`   ✅ Rodada ${rodada.nome} SELECIONADA! (tem estrutura e ${8 - vermelhosAtuais} vagas)`);
          return rodada;
        } else if (vermelhosAtuais >= 8 && podeReceberVermelho) {
          console.log(`   ⚠️ Rodada ${rodada.nome} tem estrutura mas está cheia (${vermelhosAtuais}/8 vermelhos)`);
        } else if (!podeReceberVermelho && temEstrutura) {
          console.log(`   ⚠️ Rodada ${rodada.nome} tem estrutura mas status inválido: ${rodada.status}`);
        }
      }

      // 🔥 PRIORIDADE 2: Se não encontrou rodada com estrutura, retorna a rodada mais recente (em formação)
      // Isso faz o convidado ser adicionado como AMARELO na mesma rodada, não criar uma nova
      const rodadaMaisRecente = rodadasDoUsuario[0];
      const vermelhosAtuais = rodadaMaisRecente.participantes.filter(p => p.cor === 'vermelho').length;
      const temEstrutura = !!(rodadaMaisRecente.verde && rodadaMaisRecente.pretos && rodadaMaisRecente.azuis);

      console.log(`\n   ⚠️ Nenhuma rodada com estrutura e vagas encontrada`);
      console.log(`   → Usando rodada mais recente: ${rodadaMaisRecente.nome}`);
      console.log(`   → Status: ${rodadaMaisRecente.status}`);
      console.log(`   → Tem estrutura: ${temEstrutura ? 'SIM' : 'NÃO'}`);
      console.log(`   → Vermelhos: ${vermelhosAtuais}/8`);
      console.log(`   → Convidado será adicionado como ${temEstrutura ? 'VERMELHO' : 'AMARELO'} nesta rodada`);
      console.log(`${'='.repeat(60)}\n`);

      return rodadaMaisRecente;
    } catch (error) {
      console.error('❌ Erro ao buscar rodada para novo vermelho:', error);
      return null;
    }
  }

  async buscarRodadaParaConvite(usuarioId) {
    try {
      const rodadaDoUsuario = await this.buscarRodadaParaNovoVermelho(usuarioId);
      if (rodadaDoUsuario) {
        return rodadaDoUsuario;
      }

      const rodadaComVagas = await Rodada.findOne({
        status: 'em_andamento',
        'participantes.0': { $exists: true }
      }).sort({ numero: -1 });

      if (rodadaComVagas) {
        const vermelhosAtuais = rodadaComVagas.participantes.filter(p => p.cor === 'vermelho').length;
        if (vermelhosAtuais < 8) {
          return rodadaComVagas;
        }
      }

      return null;
    } catch (error) {
      console.error('❌ Erro ao buscar rodada para convite:', error);
      return null;
    }
  }

  async garantirRodadaParaUsuario(usuarioId) {
    try {
      let rodada = await this.buscarRodadaAtivaDoUsuario(usuarioId);
      if (!rodada) {
        console.log(`🆕 Criando rodada automática para usuário ${usuarioId}`);
        rodada = await this.criarRodada(usuarioId);
      }
      return rodada;
    } catch (error) {
      console.error('❌ Erro ao garantir rodada:', error);
      throw error;
    }
  }

  async buscarHistoricoUsuario(usuarioId) {
    try {
      const rodadas = await Rodada.find({
        'participantes.usuario': usuarioId
      }).sort({ numero: -1 });
      return rodadas;
    } catch (error) {
      console.error('❌ Erro ao buscar histórico:', error);
      throw error;
    }
  }

  async verificarStatusUsuario(usuarioId) {
    try {
      const rodadaAtiva = await this.buscarRodadaAtivaDoUsuario(usuarioId);
      const rodadaEmAndamento = await this.buscarRodadaParaNovoVermelho(usuarioId);
      const historico = await this.buscarHistoricoUsuario(usuarioId);

      const rodadasConcluidas = historico.filter(r =>
        r.status === 'concluida' &&
        r.participantes.some(p => p.usuario.toString() === usuarioId.toString() && p.cor === 'concluido')
      );

      const totalGanho = rodadasConcluidas.length * 900;

      return {
        temRodadaAtiva: !!rodadaAtiva,
        temRodadaEmAndamento: !!rodadaEmAndamento,
        rodadaAtiva: rodadaAtiva ? {
          id: rodadaAtiva._id,
          numero: rodadaAtiva.numero,
          cor: rodadaAtiva.participantes.find(p => p.usuario.toString() === usuarioId.toString())?.cor
        } : null,
        rodadaEmAndamento: rodadaEmAndamento ? {
          id: rodadaEmAndamento._id,
          numero: rodadaEmAndamento.numero,
          cor: rodadaEmAndamento.participantes.find(p => p.usuario.toString() === usuarioId.toString())?.cor,
          vagasVermelho: 8 - (rodadaEmAndamento.participantes.filter(p => p.cor === 'vermelho').length)
        } : null,
        rodadasConcluidas: rodadasConcluidas.length,
        totalGanho: totalGanho,
        historico: historico
      };
    } catch (error) {
      console.error('❌ Erro ao verificar status:', error);
      throw error;
    }
  }

  // ===========================================
  // VERIFICAR E AVANÇAR SE TODOS PAGARAM
  // ===========================================
  async verificarEAvancarSeNecessario(rodadaId) {
    try {
      console.log(`🔍 [AUTO] Verificando rodada ${rodadaId} para avanço automático...`);

      const rodada = await Rodada.findById(rodadaId);
      if (!rodada) {
        console.error(`❌ [AUTO] Rodada não encontrada: ${rodadaId}`);
        return false;
      }

      // Se já está concluída, não faz nada
      if (rodada.status === 'concluida') {
        console.log(`✅ [AUTO] Rodada ${rodada.nome} já está concluída.`);
        return true;
      }

      // Se não está em andamento, não avança
      if (rodada.status !== 'em_andamento') {
        console.log(`⏸️ [AUTO] Rodada ${rodada.nome} não está em andamento (status: ${rodada.status})`);
        return false;
      }

      // Contar vermelhos pagos
      const vermelhos = rodada.participantes.filter(p => p.cor === 'vermelho');
      const vermelhosPagos = vermelhos.filter(v => v.depositoConfirmado === true);
      const todosPagos = vermelhosPagos.length === vermelhos.length && vermelhos.length > 0;

      console.log(`📊 [AUTO] Rodada ${rodada.nome}: ${vermelhosPagos.length}/${vermelhos.length} vermelhos pagos`);

      // Se todos pagaram e ainda não avançou, FORÇAR AVANÇO!
      if (todosPagos && !rodada.todosDepositaram) {
        console.log(`🎉 [AUTO] DETECTADO: Todos pagaram mas rodada não avançou! Forçando avanço...`);

        rodada.todosDepositaram = true;
        rodada.dataTodosDepositaram = new Date();
        await rodada.save();

        await this.avancarRodada(rodadaId);
        console.log(`✅ [AUTO] Rodada ${rodada.nome} avançada com sucesso!`);
        return true;
      }

      // Se já está marcada como todos depositaram mas não avançou
      if (rodada.todosDepositaram && rodada.status === 'em_andamento') {
        console.log(`⚠️ [AUTO] Rodada marcada como todos depositaram mas ainda em andamento! Forçando avanço...`);
        await this.avancarRodada(rodadaId);
        console.log(`✅ [AUTO] Rodada ${rodada.nome} avançada com sucesso!`);
        return true;
      }

      console.log(`✅ [AUTO] Rodada ${rodada.nome} OK - Aguardando mais ${vermelhos.length - vermelhosPagos.length} pagamentos`);
      return false;

    } catch (error) {
      console.error('❌ [AUTO] Erro ao verificar e avançar:', error);
      return false;
    }
  }

}

module.exports = new RodadaService();