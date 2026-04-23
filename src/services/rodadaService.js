const Rodada = require('../models/Rodada');
const User = require('../models/User');
const Transacao = require('../models/Transacao');

// No topo do arquivo, antes da classe RodadaService
const pagamentosProcessadosService = new Map(); // Cache para controle de pagamentos processados
const processandoRodadas = new Map(); // Cache para evitar processamento duplicado de rodadas

class RodadaService {

  // ===========================================
  // CRIAR NOVA RODADA
  // ===========================================
  async criarRodada(criadorId) {
    try {
      const ultimaRodada = await Rodada.findOne().sort({ numero: -1 });
      const novoNumero = ultimaRodada ? ultimaRodada.numero + 1 : 1;

      const criador = await User.findById(criadorId);
      if (!criador) throw new Error('Criador nao encontrado');

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
      console.log(`Rodada ${rodada.nome} criada com sucesso por ${criador.nome}`);
      console.log(`Participante inicial: ${criador.nome} (amarelo) - 1/15`);

      return rodada;
    } catch (error) {
      console.error('Erro ao criar rodada:', error);
      throw error;
    }
  }

  // ===========================================
  // VERIFICAR SE USUÁRIO JÁ ESTÁ EM ALGUMA RODADA ATIVA
  // ===========================================
  async usuarioEstaEmRodadaAtiva(usuarioId) {
    try {
      const rodadaAtiva = await Rodada.findOne({
        status: { $in: ['aguardando', 'em_andamento'] },
        'participantes.usuario': usuarioId
      });

      if (rodadaAtiva) {
        console.log(`[VERIFICACAO] Usuário ${usuarioId} já está na rodada ativa ${rodadaAtiva.nome} (status: ${rodadaAtiva.status})`);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Erro ao verificar rodada ativa:', error);
      return false;
    }
  }

  // ===========================================
  // ADICIONAR PARTICIPANTE AMARELO (rodada aguardando)
  // ===========================================
  async adicionarParticipanteAmarelo(rodadaId, usuarioId, indicadorId = null) {
    try {
      console.log(`[AMARELO] Tentando adicionar usuario ${usuarioId} a rodada ${rodadaId}`);

      // ✅ VERIFICAÇÃO GLOBAL: usuário já está em alguma rodada ativa?
      const estaEmRodadaAtiva = await this.usuarioEstaEmRodadaAtiva(usuarioId);
      if (estaEmRodadaAtiva) {
        console.error(`[AMARELO] Usuário ${usuarioId} já está em outra rodada ativa.`);
        throw new Error('Usuário já participa de uma rodada ativa. Aguarde a conclusão para entrar em outra.');
      }

      const rodada = await Rodada.findById(rodadaId);
      if (!rodada) throw new Error('Rodada nao encontrada');

      if (rodada.status !== 'aguardando') {
        throw new Error('So e possivel adicionar participantes em rodadas que ainda nao iniciaram');
      }

      if (rodada.participantes.length >= 15) {
        throw new Error('Rodada ja esta completa (15 participantes)');
      }

      const existe = rodada.participantes.find(
        p => p.usuario.toString() === usuarioId
      );
      if (existe) throw new Error('Usuario ja esta nesta rodada');

      const usuario = await User.findById(usuarioId);
      if (!usuario) throw new Error('Usuario nao encontrado');

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

      console.log(`Participante ${usuario.nome} adicionado a ${rodada.nome} (amarelo)`);
      console.log(`Progresso: ${rodada.participantes.length}/15 participantes`);

      if (rodada.participantes.length === 15) {
        console.log(`Rodada ${rodada.nome} completou 15 participantes! Iniciando...`);
        await this.iniciarRodada(rodadaId);
      }

      return rodada;
    } catch (error) {
      console.error('Erro ao adicionar participante amarelo:', error);
      throw error;
    }
  }

  // Adicionar participante como VERMELHO
  async adicionarParticipanteVermelho(rodadaId, usuarioId, indicadorId = null) {
    try {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`[VERMELHO] INICIANDO PROCESSO`);
      console.log(`${'='.repeat(60)}`);
      console.log(`   Rodada ID: ${rodadaId}`);
      console.log(`   Usuario ID: ${usuarioId}`);
      console.log(`   Indicador ID: ${indicadorId || 'nenhum'}`);

      // ✅ VERIFICAÇÃO GLOBAL: usuário já está em alguma rodada ativa?
      const estaEmRodadaAtiva = await this.usuarioEstaEmRodadaAtiva(usuarioId);
      if (estaEmRodadaAtiva) {
        console.log(`[VERMELHO] Usuário ${usuarioId} já está em outra rodada ativa.`);
        console.log(`   -> Colocando na fila de espera...`);
        await User.findByIdAndUpdate(usuarioId, { aguardandoVermelho: true });
        // Retorna a rodada sem adicionar, mas sem erro
        const rodada = await Rodada.findById(rodadaId);
        return rodada;
      }

      const rodada = await Rodada.findById(rodadaId);
      if (!rodada) {
        console.error(`[VERMELHO] Rodada nao encontrada: ${rodadaId}`);
        throw new Error('Rodada nao encontrada');
      }

      console.log(`\nDADOS DA RODADA:`);
      console.log(`   Nome: ${rodada.nome}`);
      console.log(`   Status: ${rodada.status}`);
      console.log(`   Participantes: ${rodada.participantes.length}/15`);
      console.log(`   Verde definido: ${rodada.verde ? 'SIM' : 'NAO'}`);
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
      console.log(`   Distribuicao de cores:`);
      console.log(`      Verde: ${cores.verde}`);
      console.log(`      Preto: ${cores.preto}`);
      console.log(`      Azul: ${cores.azul}`);
      console.log(`      Vermelho: ${cores.vermelho}`);
      console.log(`      Amarelo: ${cores.amarelo}`);

      // VERIFICAR SE A RODADA PODE RECEBER VERMELHOS
      const temEstrutura = rodada.verde && rodada.pretos && rodada.azuis;
      const podeReceberVermelho = rodada.status === 'em_andamento' ||
        (rodada.status === 'aguardando' && temEstrutura);

      console.log(`\nVERIFICANDO SE PODE RECEBER VERMELHO:`);
      console.log(`   Status: ${rodada.status}`);
      console.log(`   Tem estrutura (verde/pretos/azuis): ${temEstrutura ? 'SIM' : 'NAO'}`);
      console.log(`   Pode receber vermelho: ${podeReceberVermelho ? 'SIM' : 'NAO'}`);

      // Caso 1: Rodada nao pode receber vermelhos (esta em formacao)
      if (!podeReceberVermelho) {
        console.log(`\n[VERMELHO] Rodada NAO pode receber vermelhos!`);
        console.log(`   Motivo: ${rodada.status === 'aguardando' && !temEstrutura ? 'Rodada em formacao (aguardando completar 15 participantes)' : 'Status invalido'}`);
        console.log(`   -> Usuario sera marcado como AGUARDANDO vaga de vermelho (entra na fila)\n`);
        await User.findByIdAndUpdate(usuarioId, { aguardandoVermelho: true });
        return rodada;
      }

      // Verificar se ainda ha vagas para vermelhos (maximo 8)
      const vermelhosAtuais = rodada.participantes.filter(p => p.cor === 'vermelho').length;
      console.log(`\nVERIFICANDO VAGAS:`);
      console.log(`   Vermelhos atuais: ${vermelhosAtuais}/8`);
      console.log(`   Vagas disponiveis: ${8 - vermelhosAtuais}`);

      // CORRECAO: Se nao ha vagas, apenas marca como aguardando (entra na fila)
      if (vermelhosAtuais >= 8) {
        console.log(`[VERMELHO] Rodada ja possui 8 vermelhos!`);
        console.log(`   -> Usuario sera marcado como AGUARDANDO vaga de vermelho (entra na fila)`);
        await User.findByIdAndUpdate(usuarioId, { aguardandoVermelho: true });
        return rodada;
      }

      // Verificar se usuario ja esta na rodada
      const existe = rodada.participantes.find(
        p => p.usuario.toString() === usuarioId
      );
      if (existe) {
        console.error(`[VERMELHO] Usuario ${usuarioId} ja esta nesta rodada`);
        throw new Error('Usuario ja esta nesta rodada');
      }

      // Buscar usuario
      console.log(`\nBUSCANDO USUARIO...`);
      const usuario = await User.findById(usuarioId);
      if (!usuario) {
        console.error(`[VERMELHO] Usuario nao encontrado: ${usuarioId}`);
        throw new Error(`Usuario nao encontrado: ${usuarioId}`);
      }
      console.log(`Usuario encontrado: ${usuario.nome} (${usuario.email})`);

      // Adicionar como vermelho
      console.log(`\nADICIONANDO PARTICIPANTE...`);
      const novaPosicao = rodada.participantes.length + 1;
      console.log(`   Posicao: ${novaPosicao}`);
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
        console.log(`   Atualizando indicacao...`);
        await User.findByIdAndUpdate(usuarioId, { indicadoPor: indicadorId });
        await User.findByIdAndUpdate(indicadorId, {
          $inc: { totalIndicacoes: 1 },
          $push: { meusIndicados: usuarioId }
        });
        console.log(`   Indicacao registrada para ${indicadorId}`);
      }

      // Verificar se completou 15 participantes
      console.log(`\nVERIFICANDO COMPLETUDE DA RODADA:`);
      console.log(`   Participantes agora: ${rodada.participantes.length}/15`);

      if (rodada.participantes.length === 15) {
        console.log(`Rodada ${rodada.nome} completou 15 participantes!`);

        // Se estava aguardando, agora inicia
        if (rodada.status === 'aguardando') {
          console.log(`   Status antes: aguardando`);
          rodada.status = 'em_andamento';
          console.log(`   Status depois: em_andamento`);
        }

        await rodada.save();
        console.log(`   Rodada salva`);

        // Criar transacoes para todos os vermelhos
        console.log(`   Criando transacoes para ${rodada.vermelhos.length} vermelhos...`);
        await this.criarTransacoesParaVermelhos(rodadaId);
        console.log(`   Transacoes criadas`);
      } else {
        await rodada.save();
        console.log(`   Rodada salva (ainda faltam ${15 - rodada.participantes.length} participantes)`);
      }

      console.log(`\n[VERMELHO] PROCESSO CONCLUIDO COM SUCESSO!`);
      console.log(`   Usuario: ${usuario.nome}`);
      console.log(`   Rodada: ${rodada.nome}`);
      console.log(`   Status rodada: ${rodada.status}`);
      console.log(`   Total participantes: ${rodada.participantes.length}/15`);
      console.log(`   Total vermelhos: ${rodada.vermelhos.length}/8`);
      console.log(`${'='.repeat(60)}\n`);

      return rodada;
    } catch (error) {
      console.error(`\n[VERMELHO] ERRO:`);
      console.error(`   Mensagem: ${error.message}`);
      console.error(`   Stack: ${error.stack}`);
      console.log(`${'='.repeat(60)}\n`);
      throw error;
    }
  }

  // ===========================================
  // CRIAR TRANSACAO INDIVIDUAL PARA VERMELHO
  // ===========================================
  async criarTransacaoParaVermelho(rodadaId, vermelhoId) {
    try {
      const rodada = await Rodada.findById(rodadaId);
      if (!rodada) throw new Error('Rodada nao encontrada');

      const verdeId = rodada.verde;
      if (!verdeId) throw new Error('Verde nao definido na rodada');

      const transacao = new Transacao({
        tipo: 'deposito',
        pagador: vermelhoId,
        recebedor: verdeId,
        valor: 125,
        rodada: rodadaId,
        status: 'pendente'
      });

      await transacao.save();

      // Associar transacao ao participante
      const participante = rodada.participantes.find(p => p.usuario.toString() === vermelhoId.toString());
      if (participante) {
        participante.transacaoId = transacao._id;
        await rodada.save();
      }

      console.log(`Transacao criada para vermelho ${vermelhoId} pagar ao verde ${verdeId}`);
      return transacao;
    } catch (error) {
      console.error('Erro ao criar transacao para vermelho:', error);
      throw error;
    }
  }

  // Iniciar rodada (distribuir cores)
  async iniciarRodada(rodadaId) {
    try {
      const rodada = await Rodada.findById(rodadaId);
      if (!rodada) throw new Error('Rodada nao encontrada');

      if (rodada.participantes.length !== 15) {
        throw new Error(`Rodada precisa ter 15 participantes (tem ${rodada.participantes.length})`);
      }

      if (rodada.status !== 'aguardando') {
        throw new Error(`Rodada ja esta ${rodada.status}`);
      }

      console.log(`Iniciando rodada ${rodada.nome}...`);

      // Embaralhar participantes para distribuicao aleatoria
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

      // Registrar historico
      shuffled.forEach(p => {
        rodada.historicoMovimentacoes.push({
          usuario: p.usuario,
          corAnterior: 'amarelo',
          corNova: p.cor,
          observacao: 'Inicio da rodada',
          data: new Date()
        });
      });

      rodada.status = 'em_andamento';
      rodada.dataInicio = new Date();
      rodada.participantes = shuffled;

      await rodada.save();

      console.log(`Rodada ${rodada.nome} iniciada com sucesso!`);
      console.log(`   Verde: ${shuffled[0].usuario}`);
      console.log(`   Pretos: 2`);
      console.log(`   Azuis: 4`);
      console.log(`   Vermelhos: 8`);

      // ===========================================
      // CRIAR TRANSACOES PARA TODOS OS VERMELHOS
      // ===========================================
      await this.criarTransacoesParaVermelhos(rodadaId);

      return rodada;
    } catch (error) {
      console.error('Erro ao iniciar rodada:', error);
      throw error;
    }
  }

  // ===========================================
  // CRIAR TRANSACOES INICIAIS (8 vermelhos)
  // ===========================================
  async criarTransacoesIniciais(rodadaId) {
    try {
      const rodada = await Rodada.findById(rodadaId);
      if (!rodada) throw new Error('Rodada nao encontrada');

      const transacoes = [];
      const verde = rodada.verde;
      const valor = 125;
      const vermelhos = rodada.vermelhos || [];

      if (!verde) throw new Error('Verde nao definido');
      if (vermelhos.length === 0) throw new Error('Vermelhos nao definidos');

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

      console.log(`${transacoes.length} transacoes criadas para rodada ${rodada.nome}`);
      return transacoes;
    } catch (error) {
      console.error('Erro ao criar transacoes:', error);
      throw error;
    }
  }

  // ===========================================
  // CONFIRMAR DEPOSITO
  // ===========================================
  async confirmarDeposito(transacaoId, comprovanteUrl, confirmadoPorId) {
    try {
      // VERIFICAR SE JA FOI PROCESSADO RECENTEMENTE
      if (pagamentosProcessadosService.has(transacaoId)) {
        const processadoEm = pagamentosProcessadosService.get(transacaoId);
        const segundosDesdeProcessamento = (Date.now() - processadoEm) / 1000;
        console.log(`[confirmarDeposito] Pagamento ${transacaoId} ja foi processado ha ${segundosDesdeProcessamento.toFixed(1)}s. Ignorando.`);
        return { transacao: null, todosDepositaram: false, jaProcessado: true };
      }

      pagamentosProcessadosService.set(transacaoId, Date.now());

      // Limpar do cache apos 10 minutos
      setTimeout(() => {
        if (pagamentosProcessadosService.has(transacaoId)) {
          pagamentosProcessadosService.delete(transacaoId);
          console.log(`[confirmarDeposito] Cache do pagamento ${transacaoId} removido apos 10 minutos`);
        }
      }, 10 * 60 * 1000);

      console.log(`[confirmarDeposito] Iniciando confirmacao de deposito para transacao: ${transacaoId}`);

      // BUSCAR TRANSACAO
      const transacao = await Transacao.findById(transacaoId);
      if (!transacao) {
        console.error(`[confirmarDeposito] Transacao nao encontrada: ${transacaoId}`);
        pagamentosProcessadosService.delete(transacaoId);
        throw new Error('Transacao nao encontrada');
      }

      console.log(`[confirmarDeposito] Transacao encontrada:`, {
        id: transacao._id,
        pagador: transacao.pagador,
        status: transacao.status,
        rodada: transacao.rodada
      });

      // VERIFICACAO DE DUPLICIDADE POR STATUS
      if (transacao.status !== 'pendente') {
        console.log(`[confirmarDeposito] Transacao ${transacaoId} ja foi processada. Status atual: ${transacao.status}`);
        pagamentosProcessadosService.delete(transacaoId);
        return { transacao, todosDepositaram: false, jaProcessado: true };
      }

      // ATUALIZAR TRANSACAO
      transacao.status = 'confirmado';
      transacao.comprovante = comprovanteUrl;
      transacao.dataConfirmacao = new Date();
      transacao.confirmadoPor = confirmadoPorId;

      await transacao.save();
      console.log(`[confirmarDeposito] Transacao ${transacaoId} atualizada para status: confirmado`);

      // BUSCAR RODADA
      const rodada = await Rodada.findById(transacao.rodada);
      if (!rodada) {
        console.error(`[confirmarDeposito] Rodada nao encontrada: ${transacao.rodada}`);
        pagamentosProcessadosService.delete(transacaoId);
        throw new Error('Rodada nao encontrada');
      }

      console.log(`[confirmarDeposito] Rodada encontrada: ${rodada.nome} (${rodada.status})`);

      // ENCONTRAR PARTICIPANTE
      const participante = rodada.participantes.find(
        p => p.usuario.toString() === transacao.pagador.toString()
      );

      if (!participante) {
        console.error(`[confirmarDeposito] Participante nao encontrado na rodada para usuario: ${transacao.pagador}`);
        pagamentosProcessadosService.delete(transacaoId);
        throw new Error('Participante nao encontrado na rodada');
      }

      console.log(`[confirmarDeposito] Participante encontrado: cor=${participante.cor}, depositoConfirmado antes=${participante.depositoConfirmado}`);

      // VERIFICAR SE PARTICIPANTE JA ESTA PAGO
      if (participante.depositoConfirmado === true) {
        console.log(`[confirmarDeposito] Participante ${participante.usuario} ja estava marcado como pago. Ignorando.`);
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

      console.log(`[confirmarDeposito] Progresso pagamentos: ${vermelhosPagos.length}/${vermelhos.length}`);

      await rodada.save();
      console.log(`[confirmarDeposito] Participante atualizado e rodada salva`);

      // VERIFICAR SE TODOS PAGARAM
      let todosDepositaram = false;
      if (vermelhosPagos.length === vermelhos.length && vermelhos.length > 0) {
        console.log(`[confirmarDeposito] TODOS OS ${vermelhos.length} VERMELHOS PAGARAM!`);

        if (!rodada.todosDepositaram) {
          rodada.todosDepositaram = true;
          rodada.dataTodosDepositaram = new Date();
          await rodada.save();
          console.log(`[confirmarDeposito] Rodada marcada como "todos depositaram"`);
        }

        todosDepositaram = true;

        console.log(`[confirmarDeposito] Chamando avancarRodada...`);
        await this.avancarRodada(rodada._id);
        console.log(`[confirmarDeposito] avancarRodada concluido`);
      }

      console.log(`[confirmarDeposito] Processo concluido com sucesso para transacao ${transacaoId}`);

      return {
        transacao,
        todosDepositaram,
        progresso: `${vermelhosPagos.length}/${vermelhos.length}`,
        jaProcessado: false
      };

    } catch (error) {
      console.error('[confirmarDeposito] Erro ao confirmar deposito:', error);
      console.error('[confirmarDeposito] Stack trace:', error.stack);

      if (transacaoId) {
        pagamentosProcessadosService.delete(transacaoId);
      }

      throw error;
    }
  }

  // Criar transacoes para TODOS os vermelhos da rodada (quando a rodada estiver completa)
  async criarTransacoesParaVermelhos(rodadaId) {
    try {
      const rodada = await Rodada.findById(rodadaId);
      if (!rodada) throw new Error('Rodada nao encontrada');

      const verdeId = rodada.verde;
      if (!verdeId) throw new Error('Verde nao definido na rodada');

      const vermelhos = rodada.vermelhos || [];
      if (vermelhos.length === 0) {
        console.log(`Nenhum vermelho para criar transacoes na rodada ${rodada.nome}`);
        return [];
      }

      console.log(`Criando ${vermelhos.length} transacoes para a rodada ${rodada.nome}...`);

      const transacoes = [];
      for (const vermelhoId of vermelhos) {
        // Verificar se ja existe transacao para este vermelho
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

          // Associar transacao ao participante
          const participante = rodada.participantes.find(
            p => p.usuario.toString() === vermelhoId.toString()
          );
          if (participante) {
            participante.transacaoId = transacao._id;
          }

          console.log(`   Transacao criada para vermelho ${vermelhoId}`);
        }
      }

      if (transacoes.length > 0) {
        await rodada.save();
      }

      console.log(`${transacoes.length} transacoes criadas para rodada ${rodada.nome}`);
      return transacoes;
    } catch (error) {
      console.error('Erro ao criar transacoes para vermelhos:', error);
      throw error;
    }
  }

  // ===========================================
  // VERIFICAR SE TODOS DEPOSITARAM
  // ===========================================
  async verificarTodosDepositos(rodadaId) {
    try {
      console.log(`[DEBUG] Verificando depositos da rodada: ${rodadaId}`);

      const rodada = await Rodada.findById(rodadaId);
      if (!rodada) {
        console.error(`[DEBUG] Rodada nao encontrada: ${rodadaId}`);
        throw new Error('Rodada nao encontrada');
      }

      console.log(`[DEBUG] Rodada: ${rodada.nome}, Status: ${rodada.status}`);

      const vermelhos = rodada.participantes.filter(p => p.cor === 'vermelho');
      const vermelhosPagos = vermelhos.filter(v => v.depositoConfirmado === true);
      const todosDepositaram = vermelhosPagos.length === vermelhos.length && vermelhos.length > 0;

      console.log(`[DEBUG] Vermelhos: ${vermelhos.length}, Pagos: ${vermelhosPagos.length}, Todos pagaram: ${todosDepositaram}`);

      vermelhos.forEach(v => {
        console.log(`   Vermelho: ${v.usuario} - Pago: ${v.depositoConfirmado}`);
      });

      if (todosDepositaram && !rodada.todosDepositaram) {
        console.log(`[DEBUG] TODOS DEPOSITARAM! Avancando rodada...`);
        rodada.todosDepositaram = true;
        rodada.dataTodosDepositaram = new Date();
        rodada.totalDepositosConfirmados = vermelhosPagos.length;
        await rodada.save();
        console.log(`[DEBUG] Rodada atualizada com todosDepositaram=true`);

        console.log(`[DEBUG] Chamando avancarRodada...`);
        await this.avancarRodada(rodadaId);
        console.log(`[DEBUG] avancarRodada concluido`);
      } else {
        if (rodada.totalDepositosConfirmados !== vermelhosPagos.length) {
          rodada.totalDepositosConfirmados = vermelhosPagos.length;
          await rodada.save();
          console.log(`[DEBUG] Atualizado totalDepositosConfirmados: ${vermelhosPagos.length}`);
        } else {
          console.log(`[DEBUG] Nenhuma mudanca no total de depositos`);
        }
      }

      return todosDepositaram;
    } catch (error) {
      console.error('Erro ao verificar depositos:', error);
      throw error;
    }
  }

  // ===========================================
  // AVANCAR RODADA - PROMOVER CORES E GERAR NOVAS RODADAS (CORRIGIDO)
  // ===========================================
  async avancarRodada(rodadaId) {
    // PREVENIR PROCESSAMENTO DUPLICADO
    if (processandoRodadas.has(rodadaId)) {
      console.log(`[avancarRodada] Rodada ${rodadaId} ja esta sendo processada. Ignorando.`);
      return null;
    }
    processandoRodadas.set(rodadaId, Date.now());

    setTimeout(() => {
      if (processandoRodadas.has(rodadaId)) {
        processandoRodadas.delete(rodadaId);
        console.log(`[avancarRodada] Cache da rodada ${rodadaId} removido (timeout)`);
      }
    }, 30 * 1000);

    try {
      console.log(`[DEBUG] INICIANDO avancarRodada para: ${rodadaId}`);

      const rodada = await Rodada.findById(rodadaId);
      if (!rodada) {
        console.error(`[DEBUG] Rodada nao encontrada: ${rodadaId}`);
        throw new Error('Rodada nao encontrada');
      }

      console.log(`[DEBUG] Rodada: ${rodada.nome}, Status atual: ${rodada.status}`);

      if (rodada.status === 'concluida') {
        console.log(`[DEBUG] Rodada ${rodada.nome} ja esta concluida. Ignorando.`);
        return rodada;
      }

      if (rodada.status !== 'em_andamento') {
        console.error(`[DEBUG] Rodada nao esta em andamento. Status: ${rodada.status}`);
        throw new Error('Rodada nao esta em andamento');
      }

      // ===========================================
      // 1. VERIFICAR SE TODOS OS VERMELHOS PAGARAM
      // ===========================================
      const vermelhos = rodada.participantes.filter(p => p.cor === 'vermelho');
      const vermelhosPagos = vermelhos.filter(v => v.depositoConfirmado === true);

      if (vermelhosPagos.length !== 8) {
        console.log(`[DEBUG] Apenas ${vermelhosPagos.length}/8 vermelhos pagaram. Aguardando...`);
        return rodada;
      }

      console.log(`[DEBUG] Todos os 8 vermelhos pagaram! Prosseguindo com avanco...`);

      // ===========================================
      // 2. SALVAR O VERDE ATUAL (vai ganhar premio)
      // ===========================================
      const verdeAtual = rodada.participantes.find(p => p.cor === 'verde');
      console.log(`[DEBUG] Verde atual que ganhou R$ 900: ${verdeAtual?.usuario}`);

      // ===========================================
      // 3. PROMOVER CORES (dentro da rodada)
      // ===========================================
      console.log(`[DEBUG] Promovendo cores...`);

      let contador = {
        vermelho_para_azul: 0,
        azul_para_preto: 0,
        preto_para_verde: 0,
        verde_para_concluido: 0
      };

      rodada.participantes.forEach(p => {
        if (p.cor === 'vermelho') {
          p.cor = 'azul';
          contador.vermelho_para_azul++;
          console.log(`   vermelho->azul ${p.usuario}`);
        } else if (p.cor === 'azul') {
          p.cor = 'preto';
          contador.azul_para_preto++;
          console.log(`   azul->preto ${p.usuario}`);
        } else if (p.cor === 'preto') {
          p.cor = 'verde';
          contador.preto_para_verde++;
          console.log(`   preto->verde ${p.usuario}`);
        } else if (p.cor === 'verde') {
          p.cor = 'concluido';
          contador.verde_para_concluido++;
          console.log(`   verde->concluido ${p.usuario} (ganhou R$ 900)`);
        }
      });

      console.log(`[DEBUG] Resumo promocao:`);
      console.log(`   vermelho->azul: ${contador.vermelho_para_azul}`);
      console.log(`   azul->preto: ${contador.azul_para_preto}`);
      console.log(`   preto->verde: ${contador.preto_para_verde}`);
      console.log(`   verde->concluido: ${contador.verde_para_concluido}`);

      // ===========================================
      // 4. SEPARAR PARTICIPANTES POR COR APOS PROMOCAO
      // ===========================================
      const novosVerdes = rodada.participantes.filter(p => p.cor === 'verde');
      const novosPretos = rodada.participantes.filter(p => p.cor === 'preto');
      const novosAzuis = rodada.participantes.filter(p => p.cor === 'azul');
      const concluidos = rodada.participantes.filter(p => p.cor === 'concluido');

      console.log(`[DEBUG] Apos promocao:`);
      console.log(`   Verdes: ${novosVerdes.length}`);
      console.log(`   Pretos: ${novosPretos.length}`);
      console.log(`   Azuis: ${novosAzuis.length}`);
      console.log(`   Concluidos: ${concluidos.length}`);

      // Validar quantidade de verdes
      if (novosVerdes.length !== 2) {
        console.error(`[DEBUG] ERRO: Numero de verdes insuficiente: ${novosVerdes.length}. Esperado: 2`);
        console.log(`[DEBUG] Nao sera possivel gerar novas rodadas.`);
        await rodada.save();
        return rodada;
      }

      // ===========================================
      // 5. CRIAR 2 NOVAS RODADAS COM OS PARTICIPANTES PROMOVIDOS
      // ===========================================
      console.log(`[DEBUG] 2 verdes encontrados! Gerando novas rodadas...`);

      const verdesIds = novosVerdes.map(v => v.usuario);
      const pretosIds = novosPretos.map(p => p.usuario);
      const azuisIds = novosAzuis.map(a => a.usuario);

      // Dividir em dois grupos
      const grupo1Pretos = pretosIds.slice(0, 2);
      const grupo2Pretos = pretosIds.slice(2, 4);
      const grupo1Azuis = azuisIds.slice(0, 4);
      const grupo2Azuis = azuisIds.slice(4, 8);

      const proximoNumero = await this.getProximoNumeroRodada();

      console.log(`[DEBUG] Criando rodada #${proximoNumero}...`);
      const novaRodada1 = await this.criarRodadaAvancada(
        proximoNumero,
        verdesIds[0],
        grupo1Pretos,
        grupo1Azuis,
        rodada._id
      );

      console.log(`[DEBUG] Criando rodada #${proximoNumero + 1}...`);
      const novaRodada2 = await this.criarRodadaAvancada(
        proximoNumero + 1,
        verdesIds[1],
        grupo2Pretos,
        grupo2Azuis,
        rodada._id
      );

      rodada.rodadasGeradas = [novaRodada1._id, novaRodada2._id];
      console.log(`[DEBUG] Rodadas geradas com sucesso!`);

      // ===========================================
      // 6. ALOCAR USUARIOS DA FILA DE ESPERA COMO VERMELHOS
      // ===========================================
      console.log(`\n[ALOCACAO] Buscando usuarios aguardando vaga de vermelho...`);

      const usuariosAguardando = await User.find({ aguardandoVermelho: true }).sort({ createdAt: 1 });

      if (usuariosAguardando.length > 0) {
        console.log(`   Encontrados ${usuariosAguardando.length} usuario(s) aguardando`);

        let index = 0;
        const novasRodadas = [novaRodada1, novaRodada2];
        const usuariosAlocados = new Set();

        for (const rodadaNova of novasRodadas) {
          const vermelhosAtuais = rodadaNova.participantes.filter(p => p.cor === 'vermelho').length;
          const vagasRestantes = 8 - vermelhosAtuais;

          console.log(`\n   Rodada ${rodadaNova.nome}: ${vermelhosAtuais}/8 vermelhos, ${vagasRestantes} vagas`);

          for (let vaga = 0; vaga < vagasRestantes && index < usuariosAguardando.length; vaga++) {
            const usuario = usuariosAguardando[index];

            if (usuariosAlocados.has(usuario._id.toString())) {
              console.log(`      Usuario ${usuario.nome} já foi alocado neste processo. Pulando...`);
              index++;
              continue;
            }

            const usuarioJaNaRodada = rodadaNova.participantes.some(
              p => p.usuario.toString() === usuario._id.toString()
            );

            if (usuarioJaNaRodada) {
              console.log(`      Usuario ${usuario.nome} JA esta na rodada ${rodadaNova.nome}. Pulando...`);
              usuariosAlocados.add(usuario._id.toString());
              index++;
              continue;
            }

            const estaEmOutraRodada = await this.usuarioEstaEmRodadaAtiva(usuario._id.toString());
            if (estaEmOutraRodada) {
              console.log(`      Usuario ${usuario.nome} está em outra rodada ativa. Removendo da fila...`);
              usuario.aguardandoVermelho = false;
              await usuario.save();
              usuariosAlocados.add(usuario._id.toString());
              index++;
              continue;
            }

            console.log(`\n   Processando usuario ${index + 1}/${usuariosAguardando.length}: ${usuario.nome}`);

            const rodadaAmarela = await Rodada.findOne({
              'participantes.usuario': usuario._id,
              'participantes.cor': 'amarelo'
            });

            if (rodadaAmarela) {
              rodadaAmarela.participantes = rodadaAmarela.participantes.filter(
                p => p.usuario.toString() !== usuario._id.toString()
              );
              await rodadaAmarela.save();
              console.log(`      Removido da rodada amarela ${rodadaAmarela.nome}`);
            }

            try {
              await this.adicionarParticipanteVermelho(rodadaNova._id.toString(), usuario._id.toString(), null);
              console.log(`      Alocado como VERMELHO na rodada ${rodadaNova.nome}`);

              usuario.aguardandoVermelho = false;
              await usuario.save();

              usuariosAlocados.add(usuario._id.toString());
              index++;
            } catch (error) {
              console.error(`      Erro ao alocar ${usuario.nome}:`, error.message);
              index++;
            }
          }

          if (index >= usuariosAguardando.length) break;
        }

        console.log(`\n[ALOCACAO] ${usuariosAlocados.size} usuario(s) alocados como VERMELHOS`);
        if (usuariosAguardando.length - usuariosAlocados.size > 0) {
          console.log(`   ${usuariosAguardando.length - usuariosAlocados.size} usuario(s) ainda aguardando`);
        }
      } else {
        console.log(`   Nenhum usuario aguardando vaga de vermelho`);
      }

      // ===========================================
      // 7. FINALIZAR RODADA ORIGINAL COMO CONCLUÍDA
      // ===========================================
      console.log(`\n[FINALIZACAO] Finalizando rodada original como concluída...`);

      // Registrar no histórico a conclusão da rodada e quem ganhou
      rodada.historicoMovimentacoes.push({
        usuario: verdeAtual.usuario,
        corAnterior: 'verde',
        corNova: 'concluido',
        observacao: `✅ RODADA CONCLUÍDA! Prêmio de R$ 900 disponível para saque.`,
        data: new Date()
      });

      rodada.status = 'concluida';
      rodada.dataFim = new Date();

      await rodada.save();

      console.log(`[FINALIZACAO] Rodada ${rodada.nome} concluída com sucesso!`);
      console.log(`   🏆 Verde vencedor: ${verdeAtual?.nome} ganhou R$ 900`);
      console.log(`   Participantes mantidos no histórico: ${rodada.participantes.length}`);
      console.log(`   Novas rodadas geradas: ${rodada.rodadasGeradas.length}`);

      return rodada;

    } catch (error) {
      console.error('Erro ao avancar rodada:', error);
      console.error('Stack trace:', error.stack);
      throw error;
    } finally {
      processandoRodadas.delete(rodadaId);
      console.log(`[avancarRodada] Cache da rodada ${rodadaId} removido`);
    }
  }

  // Metodo auxiliar para criar rodada avancada
  async criarRodadaAvancada(numero, verdeId, pretosIds, azuisIds, rodadaOrigemId) {
    try {
      const rodada = new Rodada({
        numero: numero,
        nome: `Rodada #${numero}`,
        status: 'aguardando',
        participantes: [],
        totalDepositosConfirmados: 0,
        todosDepositaram: false,
        historicoMovimentacoes: [],
        rodadaOrigem: rodadaOrigemId
      });

      // Adicionar verde (ja esta na posicao correta)
      rodada.participantes.push({
        usuario: verdeId,
        cor: 'verde',
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
      rodada.vermelhos = [];

      await rodada.save();

      console.log(`Rodada avancada ${rodada.nome} criada com ${rodada.participantes.length} participantes`);
      console.log(`   Verde: 1`);
      console.log(`   Pretos: ${pretosIds.length}`);
      console.log(`   Azuis: ${azuisIds.length}`);
      console.log(`   Vermelhos: 0 (aguardando novos convidados)`);
      console.log(`   Status: AGUARDANDO (precisa de mais ${15 - rodada.participantes.length} participantes)`);

      return rodada;
    } catch (error) {
      console.error('Erro ao criar rodada avancada:', error);
      throw error;
    }
  }

  // ===========================================
  // UTILITARIOS
  // ===========================================
  async getProximoNumeroRodada() {
    try {
      const ultimaRodada = await Rodada.findOne().sort({ numero: -1 });
      return ultimaRodada ? ultimaRodada.numero + 1 : 1;
    } catch (error) {
      console.error('Erro ao obter proximo numero:', error);
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
      console.error('Erro ao buscar rodada ativa:', error);
      return null;
    }
  }

  // Buscar rodada do usuario que aceita novos vermelhos
  async buscarRodadaParaNovoVermelho(usuarioId) {
    try {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`[buscarRodadaParaNovoVermelho] INICIANDO BUSCA`);
      console.log(`${'='.repeat(60)}`);
      console.log(`   Usuario ID: ${usuarioId}`);

      const user = await User.findById(usuarioId);
      console.log(`   Usuario: ${user?.nome || 'nao encontrado'}`);

      // Buscar rodadas do usuario que estao em 'em_andamento' ou 'aguardando'
      const rodadasDoUsuario = await Rodada.find({
        'participantes.usuario': usuarioId,
        status: { $in: ['em_andamento', 'aguardando'] }
      }).sort({ numero: -1 });

      console.log(`\nRODADAS ENCONTRADAS: ${rodadasDoUsuario.length}`);

      if (rodadasDoUsuario.length === 0) {
        console.log(`   Nenhuma rodada encontrada para o usuario`);
        console.log(`${'='.repeat(60)}\n`);
        return null;
      }

      // PRIORIDADE 1: Rodadas que JA TEM estrutura e podem receber vermelho (em_andamento ou aguardando com estrutura)
      for (const rodada of rodadasDoUsuario) {
        const vermelhosAtuais = rodada.participantes.filter(p => p.cor === 'vermelho').length;
        const temEstrutura = !!(rodada.verde && rodada.pretos && rodada.azuis);

        // Pode receber vermelho se: 
        // 1. Esta em_andamento, OU
        // 2. Esta aguardando mas ja tem estrutura (rodadas avancadas)
        const podeReceberVermelho = rodada.status === 'em_andamento' ||
          (rodada.status === 'aguardando' && temEstrutura);

        console.log(`\n   Analisando rodada ${rodada.nome}:`);
        console.log(`      - Status: ${rodada.status}`);
        console.log(`      - Tem estrutura: ${temEstrutura ? 'SIM' : 'NAO'}`);
        console.log(`      - Pode receber vermelho: ${podeReceberVermelho ? 'SIM' : 'NAO'}`);
        console.log(`      - Vermelhos atuais: ${vermelhosAtuais}/8`);
        console.log(`      - Total participantes: ${rodada.participantes.length}/15`);

        if (vermelhosAtuais < 8 && podeReceberVermelho) {
          console.log(`   Rodada ${rodada.nome} SELECIONADA! (tem estrutura e ${8 - vermelhosAtuais} vagas)`);
          return rodada;
        } else if (vermelhosAtuais >= 8 && podeReceberVermelho) {
          console.log(`   Rodada ${rodada.nome} tem estrutura mas esta cheia (${vermelhosAtuais}/8 vermelhos)`);
        } else if (!podeReceberVermelho && temEstrutura) {
          console.log(`   Rodada ${rodada.nome} tem estrutura mas status invalido: ${rodada.status}`);
        }
      }

      // PRIORIDADE 2: Se nao encontrou rodada com estrutura, retorna a rodada mais recente (em formacao)
      // Isso faz o convidado ser adicionado como AMARELO na mesma rodada, nao criar uma nova
      const rodadaMaisRecente = rodadasDoUsuario[0];
      const vermelhosAtuais = rodadaMaisRecente.participantes.filter(p => p.cor === 'vermelho').length;
      const temEstrutura = !!(rodadaMaisRecente.verde && rodadaMaisRecente.pretos && rodadaMaisRecente.azuis);

      console.log(`\n   Nenhuma rodada com estrutura e vagas encontrada`);
      console.log(`   -> Usando rodada mais recente: ${rodadaMaisRecente.nome}`);
      console.log(`   -> Status: ${rodadaMaisRecente.status}`);
      console.log(`   -> Tem estrutura: ${temEstrutura ? 'SIM' : 'NAO'}`);
      console.log(`   -> Vermelhos: ${vermelhosAtuais}/8`);
      console.log(`   -> Convidado sera adicionado como ${temEstrutura ? 'VERMELHO' : 'AMARELO'} nesta rodada`);
      console.log(`${'='.repeat(60)}\n`);

      return rodadaMaisRecente;
    } catch (error) {
      console.error('Erro ao buscar rodada para novo vermelho:', error);
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
      console.error('Erro ao buscar rodada para convite:', error);
      return null;
    }
  }

  async garantirRodadaParaUsuario(usuarioId) {
    try {
      let rodada = await this.buscarRodadaAtivaDoUsuario(usuarioId);
      if (!rodada) {
        console.log(`Criando rodada automatica para usuario ${usuarioId}`);
        rodada = await this.criarRodada(usuarioId);
      }
      return rodada;
    } catch (error) {
      console.error('Erro ao garantir rodada:', error);
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
      console.error('Erro ao buscar historico:', error);
      throw error;
    }
  }

  async verificarStatusUsuario(usuarioId) {
    try {
      const usuario = await User.findById(usuarioId);
      const rodadaAtiva = await this.buscarRodadaAtivaDoUsuario(usuarioId);
      const rodadaEmAndamento = await this.buscarRodadaParaNovoVermelho(usuarioId);
      const historico = await this.buscarHistoricoUsuario(usuarioId);

      const rodadasConcluidas = historico.filter(r =>
        r.status === 'concluida' &&
        r.participantes.some(p => p.usuario.toString() === usuarioId.toString() && p.cor === 'concluido')
      );

      const totalGanho = rodadasConcluidas.length * 900;

      // CALCULO CORRETO: Esta na fila de espera apenas se:
      // 1. Tem a flag aguardandoVermelho = true
      // 2. NAO esta em nenhuma rodada ativa (aguardando)
      // 3. NAO esta em nenhuma rodada em andamento
      const naFilaEspera = (usuario?.aguardandoVermelho === true) && !rodadaAtiva && !rodadaEmAndamento;

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
        historico: historico,
        aguardandoVermelho: usuario?.aguardandoVermelho || false,
        naFilaEspera: naFilaEspera
      };
    } catch (error) {
      console.error('Erro ao verificar status:', error);
      throw error;
    }
  }

  // ===========================================
  // VERIFICAR E AVANCAR SE TODOS PAGARAM
  // ===========================================
  async verificarEAvancarSeNecessario(rodadaId) {
    try {
      console.log(`[AUTO] Verificando rodada ${rodadaId} para avanco automatico...`);

      const rodada = await Rodada.findById(rodadaId);
      if (!rodada) {
        console.error(`[AUTO] Rodada nao encontrada: ${rodadaId}`);
        return false;
      }

      // Se ja esta concluida, nao faz nada
      if (rodada.status === 'concluida') {
        console.log(`[AUTO] Rodada ${rodada.nome} ja esta concluida.`);
        return true;
      }

      // Se nao esta em andamento, nao avanca
      if (rodada.status !== 'em_andamento') {
        console.log(`[AUTO] Rodada ${rodada.nome} nao esta em andamento (status: ${rodada.status})`);
        return false;
      }

      // Contar vermelhos pagos
      const vermelhos = rodada.participantes.filter(p => p.cor === 'vermelho');
      const vermelhosPagos = vermelhos.filter(v => v.depositoConfirmado === true);
      const todosPagos = vermelhosPagos.length === vermelhos.length && vermelhos.length > 0;

      console.log(`[AUTO] Rodada ${rodada.nome}: ${vermelhosPagos.length}/${vermelhos.length} vermelhos pagos`);

      // Se todos pagaram e ainda nao avancou, FORCAR AVANCO!
      if (todosPagos && !rodada.todosDepositaram) {
        console.log(`[AUTO] DETECTADO: Todos pagaram mas rodada nao avancou! Forcando avanco...`);

        rodada.todosDepositaram = true;
        rodada.dataTodosDepositaram = new Date();
        await rodada.save();

        await this.avancarRodada(rodadaId);
        console.log(`[AUTO] Rodada ${rodada.nome} avancada com sucesso!`);
        return true;
      }

      // Se ja esta marcada como todos depositaram mas nao avancou
      if (rodada.todosDepositaram && rodada.status === 'em_andamento') {
        console.log(`[AUTO] Rodada marcada como todos depositaram mas ainda em andamento! Forcando avanco...`);
        await this.avancarRodada(rodadaId);
        console.log(`[AUTO] Rodada ${rodada.nome} avancada com sucesso!`);
        return true;
      }

      console.log(`[AUTO] Rodada ${rodada.nome} OK - Aguardando mais ${vermelhos.length - vermelhosPagos.length} pagamentos`);
      return false;

    } catch (error) {
      console.error('[AUTO] Erro ao verificar e avancar:', error);
      return false;
    }
  }

  // ===========================================
  // JOGAR NOVAMENTE (usuario que ganhou quer voltar como vermelho)
  // ===========================================
  async jogarNovamente(usuarioId) {
    try {
      console.log(`\n[REENTRADA] Usuario ${usuarioId} quer jogar novamente`);

      const usuario = await User.findById(usuarioId);
      if (!usuario) {
        throw new Error('Usuario nao encontrado');
      }

      // Verificar se o usuario tem algum premio pendente
      const SolicitacaoSaque = require('../models/SolicitacaoSaque');
      const solicitacaoPendente = await SolicitacaoSaque.findOne({
        usuario: usuarioId,
        status: { $in: ['pendente', 'aprovado'] }
      });

      if (solicitacaoPendente) {
        throw new Error('Voce tem um saque pendente de aprovacao. Aguarde a aprovacao para jogar novamente.');
      }

      // Verificar se ja esta em alguma rodada
      const rodadaAtiva = await this.buscarRodadaAtivaDoUsuario(usuarioId);
      const rodadaEmAndamento = await this.buscarRodadaParaNovoVermelho(usuarioId);

      if (rodadaAtiva || rodadaEmAndamento) {
        throw new Error('Voce ja esta participando de uma rodada ativa');
      }

      // Buscar rodada com vaga para vermelho
      let rodadaParaEntrar = await Rodada.findOne({
        status: 'em_andamento',
        $expr: {
          $lt: [
            { $size: { $filter: { input: '$participantes', as: 'p', cond: { $eq: ['$$p.cor', 'vermelho'] } } } },
            8
          ]
        }
      }).sort({ createdAt: 1 });

      // Se nao tem rodada com vaga, buscar rodada aguardando com estrutura
      if (!rodadaParaEntrar) {
        rodadaParaEntrar = await Rodada.findOne({
          status: 'aguardando',
          verde: { $ne: null },
          pretos: { $ne: [] },
          azuis: { $ne: [] },
          $expr: {
            $lt: [
              { $size: { $filter: { input: '$participantes', as: 'p', cond: { $eq: ['$$p.cor', 'vermelho'] } } } },
              8
            ]
          }
        }).sort({ createdAt: 1 });
      }

      if (rodadaParaEntrar) {
        // Adicionar como vermelho na rodada existente
        console.log(`   Usuario sera adicionado como VERMELHO na rodada ${rodadaParaEntrar.nome}`);
        await this.adicionarParticipanteVermelho(rodadaParaEntrar._id.toString(), usuarioId, null);
        return {
          success: true,
          message: `Voce foi adicionado como VERMELHO na ${rodadaParaEntrar.nome}!`,
          rodadaId: rodadaParaEntrar._id,
          cor: 'vermelho'
        };
      }

      // Se nao tem rodada disponivel, colocar na fila de espera
      console.log(`   Nenhuma rodada disponivel. Usuario sera colocado na FILA DE ESPERA`);
      usuario.aguardandoVermelho = true;
      await usuario.save();

      return {
        success: true,
        message: 'Nenhuma rodada disponivel no momento. Voce foi colocado na FILA DE ESPERA e sera avisado quando houver vaga.',
        cor: 'amarelo',
        aguardando: true
      };

    } catch (error) {
      console.error('Erro ao jogar novamente:', error);
      throw error;
    }
  }

}

module.exports = new RodadaService();