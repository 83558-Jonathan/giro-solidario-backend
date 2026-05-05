const Rodada = require("../models/Rodada");
const User = require("../models/User");
const Transacao = require("../models/Transacao");

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
      if (!criador) throw new Error("Criador nao encontrado");

      const rodada = new Rodada({
        numero: novoNumero,
        nome: `Rodada #${novoNumero}`,
        status: "aguardando",
        participantes: [
          {
            usuario: criadorId,
            cor: "amarelo",
            posicao: 1,
            dataEntrada: new Date(),
            depositoConfirmado: false,
          },
        ],
        totalDepositosConfirmados: 0,
        todosDepositaram: false,
        historicoMovimentacoes: [],
      });

      await rodada.save();
      console.log(
        `Rodada ${rodada.nome} criada com sucesso por ${criador.nome}`,
      );
      console.log(`Participante inicial: ${criador.nome} (amarelo) - 1/15`);

      return rodada;
    } catch (error) {
      console.error("Erro ao criar rodada:", error);
      throw error;
    }
  }

  // ===========================================
  // VERIFICAR SE USUÁRIO JÁ ESTÁ EM ALGUMA RODADA ATIVA
  // ===========================================
  async usuarioEstaEmRodadaAtiva(usuarioId) {
    try {
      const rodadaAtiva = await Rodada.findOne({
        status: { $in: ["aguardando", "em_andamento"] },
        "participantes.usuario": usuarioId,
        "participantes.cor": { $ne: "concluido" }, // 🔥 IGNORAR participantes concluídos
      });

      if (rodadaAtiva) {
        console.log(
          `[VERIFICACAO] Usuário ${usuarioId} já está na rodada ativa ${rodadaAtiva.nome} (status: ${rodadaAtiva.status})`,
        );
        return true;
      }
      return false;
    } catch (error) {
      console.error("Erro ao verificar rodada ativa:", error);
      return false;
    }
  }

  // ===========================================
  // ADICIONAR PARTICIPANTE AMARELO (rodada aguardando)
  // ===========================================
  async adicionarParticipanteAmarelo(rodadaId, usuarioId, indicadorId = null) {
    try {
      console.log(
        `[AMARELO] Tentando adicionar usuario ${usuarioId} a rodada ${rodadaId}`,
      );

      // ✅ VERIFICAÇÃO GLOBAL: usuário já está em alguma rodada ativa?
      const estaEmRodadaAtiva = await this.usuarioEstaEmRodadaAtiva(usuarioId);
      if (estaEmRodadaAtiva) {
        console.error(
          `[AMARELO] Usuário ${usuarioId} já está em outra rodada ativa.`,
        );
        throw new Error(
          "Usuário já participa de uma rodada ativa. Aguarde a conclusão para entrar em outra.",
        );
      }

      const rodada = await Rodada.findById(rodadaId);
      if (!rodada) throw new Error("Rodada nao encontrada");

      if (rodada.status !== "aguardando") {
        throw new Error(
          "So e possivel adicionar participantes em rodadas que ainda nao iniciaram",
        );
      }

      if (rodada.participantes.length >= 15) {
        throw new Error("Rodada ja esta completa (15 participantes)");
      }

      const existe = rodada.participantes.find(
        (p) => p.usuario.toString() === usuarioId,
      );
      if (existe) throw new Error("Usuario ja esta nesta rodada");

      const usuario = await User.findById(usuarioId);
      if (!usuario) throw new Error("Usuario nao encontrado");

      rodada.participantes.push({
        usuario: usuarioId,
        cor: "amarelo",
        posicao: rodada.participantes.length + 1,
        dataEntrada: new Date(),
        depositoConfirmado: false,
        indicadoPor: indicadorId || null,
      });

      if (indicadorId) {
        await User.findByIdAndUpdate(usuarioId, { indicadoPor: indicadorId });
        await User.findByIdAndUpdate(indicadorId, {
          $inc: { totalIndicacoes: 1 },
          $push: { meusIndicados: usuarioId },
        });
      }

      await rodada.save();

      console.log(
        `Participante ${usuario.nome} adicionado a ${rodada.nome} (amarelo)`,
      );
      console.log(`Progresso: ${rodada.participantes.length}/15 participantes`);

      if (rodada.participantes.length === 15) {
        console.log(
          `Rodada ${rodada.nome} completou 15 participantes! Iniciando...`,
        );
        await this.iniciarRodada(rodadaId);
      }

      return rodada;
    } catch (error) {
      console.error("Erro ao adicionar participante amarelo:", error);
      throw error;
    }
  }

  // Adicionar participante como VERMELHO
  async adicionarParticipanteVermelho(rodadaId, usuarioId, indicadorId = null) {
    try {
      console.log(`\n${"=".repeat(60)}`);
      console.log(`[VERMELHO] INICIANDO PROCESSO`);
      console.log(`${"=".repeat(60)}`);
      console.log(`   Rodada ID: ${rodadaId}`);
      console.log(`   Usuario ID: ${usuarioId}`);
      console.log(`   Indicador ID: ${indicadorId || "nenhum"}`);

      // ✅ VERIFICAÇÃO GLOBAL: usuário já está em alguma rodada ativa?
      const estaEmRodadaAtiva = await this.usuarioEstaEmRodadaAtiva(usuarioId);
      if (estaEmRodadaAtiva) {
        console.log(
          `[VERMELHO] Usuário ${usuarioId} já está em outra rodada ativa.`,
        );
        console.log(`   -> Colocando na fila de espera...`);
        await User.findByIdAndUpdate(usuarioId, { aguardandoVermelho: true });
        const rodada = await Rodada.findById(rodadaId);
        return rodada;
      }

      const rodada = await Rodada.findById(rodadaId);
      if (!rodada) {
        console.error(`[VERMELHO] Rodada nao encontrada: ${rodadaId}`);
        throw new Error("Rodada nao encontrada");
      }

      console.log(`\nDADOS DA RODADA:`);
      console.log(`   Nome: ${rodada.nome}`);
      console.log(`   Status: ${rodada.status}`);
      console.log(`   Participantes: ${rodada.participantes.length}/15`);
      console.log(`   Verde definido: ${rodada.verde ? "SIM" : "NAO"}`);
      console.log(`   Pretos: ${rodada.pretos?.length || 0}`);
      console.log(`   Azuis: ${rodada.azuis?.length || 0}`);
      console.log(`   Vermelhos: ${rodada.vermelhos?.length || 0}`);

      const cores = {
        verde: rodada.participantes.filter((p) => p.cor === "verde").length,
        preto: rodada.participantes.filter((p) => p.cor === "preto").length,
        azul: rodada.participantes.filter((p) => p.cor === "azul").length,
        vermelho: rodada.participantes.filter((p) => p.cor === "vermelho")
          .length,
        amarelo: rodada.participantes.filter((p) => p.cor === "amarelo").length,
      };
      console.log(`   Distribuicao de cores:`);
      console.log(`      Verde: ${cores.verde}`);
      console.log(`      Preto: ${cores.preto}`);
      console.log(`      Azul: ${cores.azul}`);
      console.log(`      Vermelho: ${cores.vermelho}`);
      console.log(`      Amarelo: ${cores.amarelo}`);

      const temEstrutura = rodada.verde && rodada.pretos && rodada.azuis;
      const podeReceberVermelho =
        rodada.status === "em_andamento" ||
        (rodada.status === "aguardando" && temEstrutura);

      console.log(`\nVERIFICANDO SE PODE RECEBER VERMELHO:`);
      console.log(`   Status: ${rodada.status}`);
      console.log(`   Tem estrutura: ${temEstrutura ? "SIM" : "NAO"}`);
      console.log(
        `   Pode receber vermelho: ${podeReceberVermelho ? "SIM" : "NAO"}`,
      );

      if (!podeReceberVermelho) {
        console.log(`\n[VERMELHO] Rodada NAO pode receber vermelhos!`);
        console.log(
          `   -> Usuario sera marcado como AGUARDANDO vaga de vermelho\n`,
        );
        await User.findByIdAndUpdate(usuarioId, { aguardandoVermelho: true });
        return rodada;
      }

      const vermelhosAtuais = rodada.participantes.filter(
        (p) => p.cor === "vermelho",
      ).length;
      console.log(`\nVERIFICANDO VAGAS:`);
      console.log(`   Vermelhos atuais: ${vermelhosAtuais}/8`);

      if (vermelhosAtuais >= 8) {
        console.log(`[VERMELHO] Rodada ja possui 8 vermelhos!`);
        console.log(
          `   -> Usuario sera marcado como AGUARDANDO vaga de vermelho`,
        );
        await User.findByIdAndUpdate(usuarioId, { aguardandoVermelho: true });
        return rodada;
      }

      const existe = rodada.participantes.find(
        (p) => p.usuario.toString() === usuarioId,
      );
      if (existe) {
        console.error(`[VERMELHO] Usuario ${usuarioId} ja esta nesta rodada`);
        throw new Error("Usuario ja esta nesta rodada");
      }

      console.log(`\nBUSCANDO USUARIO...`);
      const usuario = await User.findById(usuarioId);
      if (!usuario) {
        console.error(`[VERMELHO] Usuario nao encontrado: ${usuarioId}`);
        throw new Error(`Usuario nao encontrado: ${usuarioId}`);
      }
      console.log(`Usuario encontrado: ${usuario.nome} (${usuario.email})`);

      console.log(`\nADICIONANDO PARTICIPANTE...`);
      const novaPosicao = rodada.participantes.length + 1;

      rodada.participantes.push({
        usuario: usuarioId,
        cor: "vermelho",
        posicao: novaPosicao,
        dataEntrada: new Date(),
        depositoConfirmado: false,
        indicadoPor: indicadorId || null,
      });

      rodada.vermelhos.push(usuarioId);
      console.log(`   Vermelhos agora: ${rodada.vermelhos.length}/8`);

      if (indicadorId) {
        console.log(`   Atualizando indicacao...`);
        await User.findByIdAndUpdate(usuarioId, { indicadoPor: indicadorId });
        await User.findByIdAndUpdate(indicadorId, {
          $inc: { totalIndicacoes: 1 },
          $push: { meusIndicados: usuarioId },
        });
      }

      console.log(`\nVERIFICANDO COMPLETUDE DA RODADA:`);
      console.log(`   Participantes agora: ${rodada.participantes.length}/15`);

      // ===========================================
      // 🔥 CORREÇÃO AQUI - Bloco modificado
      // ===========================================
      if (rodada.participantes.length === 15) {
        console.log(`Rodada ${rodada.nome} completou 15 participantes!`);

        // Verificar se a rodada JÁ TEM estrutura (caso de rodadas filhas de progressão)
        const temEstruturaPreDefinida = !!(
          rodada.verde &&
          rodada.pretos &&
          rodada.azuis
        );
        const estavaAguardando = rodada.status === "aguardando";

        if (estavaAguardando) {
          console.log(`   Status antes: aguardando`);
          rodada.status = "em_andamento";
          console.log(`   Status depois: em_andamento`);
        }

        await rodada.save();
        console.log(`   Rodada salva`);
        console.log(
          `   Tinha estrutura pré-definida: ${temEstruturaPreDefinida ? "SIM" : "NAO"}`,
        );

        // 🔥🔥🔥 CORREÇÃO PRINCIPAL 🔥🔥🔥
        // Se a rodada já tem estrutura (veio da progressão), criar transações AGORA
        if (temEstruturaPreDefinida) {
          console.log(
            `   ✅ Rodada com estrutura pré-definida! Criando transações para os ${rodada.vermelhos?.length || 8} vermelhos...`,
          );
          await this.criarTransacoesParaVermelhos(rodadaId);
        } else {
          console.log(
            `   ⚠️ Transacoes serao criadas quando a rodada for iniciada (distribuicao de cores)`,
          );
        }
      } else {
        await rodada.save();
        console.log(
          `   Rodada salva (faltam ${15 - rodada.participantes.length} participantes)`,
        );
      }

      console.log(`\n[VERMELHO] PROCESSO CONCLUIDO COM SUCESSO!`);
      console.log(`   Usuario: ${usuario.nome}`);
      console.log(`   Rodada: ${rodada.nome}`);
      console.log(`   Status rodada: ${rodada.status}`);
      console.log(`   Total participantes: ${rodada.participantes.length}/15`);
      console.log(`   Total vermelhos: ${rodada.vermelhos.length}/8`);
      console.log(`${"=".repeat(60)}\n`);

      return rodada;
    } catch (error) {
      console.error(`\n[VERMELHO] ERRO:`);
      console.error(`   Mensagem: ${error.message}`);
      console.error(`   Stack: ${error.stack}`);
      console.log(`${"=".repeat(60)}\n`);
      throw error;
    }
  }

  // ===========================================
  // CRIAR TRANSACAO INDIVIDUAL PARA VERMELHO (VALOR CORRETO: R$ 150)
  // ===========================================
  async criarTransacaoParaVermelho(rodadaId, vermelhoId) {
    try {
      const rodada = await Rodada.findById(rodadaId);
      if (!rodada) throw new Error("Rodada nao encontrada");

      const verdeId = rodada.verde;
      if (!verdeId) throw new Error("Verde nao definido na rodada");

      // ✅ VALOR CORRETO: R$ 150,00
      const valor = 150;

      const transacao = new Transacao({
        tipo: "deposito",
        pagador: vermelhoId,
        recebedor: verdeId,
        valor: valor,
        rodada: rodadaId,
        status: "pendente",
      });

      await transacao.save();

      // Associar transacao ao participante
      const participante = rodada.participantes.find(
        (p) => p.usuario.toString() === vermelhoId.toString(),
      );
      if (participante) {
        participante.transacaoId = transacao._id;
        await rodada.save();
      }

      console.log(
        `Transacao criada para vermelho ${vermelhoId} pagar ao verde ${verdeId} (R$ ${valor})`,
      );
      return transacao;
    } catch (error) {
      console.error("Erro ao criar transacao para vermelho:", error);
      throw error;
    }
  }

  // Iniciar rodada (distribuir cores)
  async iniciarRodada(rodadaId) {
    try {
      const rodada = await Rodada.findById(rodadaId);
      if (!rodada) throw new Error("Rodada nao encontrada");

      if (rodada.participantes.length !== 15) {
        throw new Error(
          `Rodada precisa ter 15 participantes (tem ${rodada.participantes.length})`,
        );
      }

      if (rodada.status !== "aguardando") {
        throw new Error(`Rodada ja esta ${rodada.status}`);
      }

      console.log(`Iniciando rodada ${rodada.nome}...`);

      // Embaralhar participantes para distribuicao aleatoria
      const shuffled = [...rodada.participantes].sort(
        () => Math.random() - 0.5,
      );

      // Distribuir cores: 1 verde, 2 pretos, 4 azuis, 8 vermelhos
      shuffled[0].cor = "verde";
      shuffled[1].cor = "preto";
      shuffled[2].cor = "preto";
      for (let i = 3; i < 7; i++) shuffled[i].cor = "azul";
      for (let i = 7; i < 15; i++) shuffled[i].cor = "vermelho";

      // Atualizar listas de cores
      rodada.verde = shuffled[0].usuario;
      rodada.pretos = [shuffled[1].usuario, shuffled[2].usuario];
      rodada.azuis = shuffled.slice(3, 7).map((p) => p.usuario);
      rodada.vermelhos = shuffled.slice(7, 15).map((p) => p.usuario);

      // Registrar historico
      shuffled.forEach((p) => {
        rodada.historicoMovimentacoes.push({
          usuario: p.usuario,
          corAnterior: "amarelo",
          corNova: p.cor,
          observacao: "Inicio da rodada",
          data: new Date(),
        });
      });

      rodada.status = "em_andamento";
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
      console.error("Erro ao iniciar rodada:", error);
      throw error;
    }
  }

  // ===========================================
  // CRIAR TRANSACOES INICIAIS (8 vermelhos) - VALOR CORRETO
  // ===========================================
  async criarTransacoesIniciais(rodadaId) {
    try {
      const rodada = await Rodada.findById(rodadaId);
      if (!rodada) throw new Error("Rodada nao encontrada");

      const transacoes = [];
      const verde = rodada.verde;
      const valor = 150;
      const vermelhos = rodada.participantes.filter(
        (p) => p.cor === "vermelho",
      );

      if (!verde) throw new Error("Verde nao definido");
      if (vermelhos.length === 0) throw new Error("Vermelhos nao definidos");

      for (const vermelhoId of vermelhos) {
        const existe = await Transacao.findOne({
          pagador: vermelhoId,
          rodada: rodadaId,
        });

        if (!existe) {
          const transacao = new Transacao({
            tipo: "deposito",
            pagador: vermelhoId,
            recebedor: verde,
            valor: valor,
            rodada: rodadaId,
            status: "pendente",
          });

          await transacao.save();
          transacoes.push(transacao);

          const participante = rodada.participantes.find(
            (p) => p.usuario.toString() === vermelhoId.toString(),
          );
          if (participante) {
            participante.transacaoId = transacao._id;
          }
        }
      }

      if (transacoes.length > 0) {
        await rodada.save();
      }

      console.log(
        `${transacoes.length} transacoes criadas para rodada ${rodada.nome} (R$ ${valor} cada)`,
      );
      return transacoes;
    } catch (error) {
      console.error("Erro ao criar transacoes:", error);
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
        console.log(
          `[confirmarDeposito] Pagamento ${transacaoId} ja foi processado ha ${segundosDesdeProcessamento.toFixed(1)}s. Ignorando.`,
        );
        return { transacao: null, todosDepositaram: false, jaProcessado: true };
      }

      pagamentosProcessadosService.set(transacaoId, Date.now());

      // Limpar do cache apos 10 minutos
      setTimeout(
        () => {
          if (pagamentosProcessadosService.has(transacaoId)) {
            pagamentosProcessadosService.delete(transacaoId);
            console.log(
              `[confirmarDeposito] Cache do pagamento ${transacaoId} removido apos 10 minutos`,
            );
          }
        },
        10 * 60 * 1000,
      );

      console.log(
        `[confirmarDeposito] Iniciando confirmacao de deposito para transacao: ${transacaoId}`,
      );

      // BUSCAR TRANSACAO
      const transacao = await Transacao.findById(transacaoId);
      if (!transacao) {
        console.error(
          `[confirmarDeposito] Transacao nao encontrada: ${transacaoId}`,
        );
        pagamentosProcessadosService.delete(transacaoId);
        throw new Error("Transacao nao encontrada");
      }

      console.log(`[confirmarDeposito] Transacao encontrada:`, {
        id: transacao._id,
        pagador: transacao.pagador,
        status: transacao.status,
        rodada: transacao.rodada,
      });

      // VERIFICACAO DE DUPLICIDADE POR STATUS
      if (transacao.status !== "pendente") {
        console.log(
          `[confirmarDeposito] Transacao ${transacaoId} ja foi processada. Status atual: ${transacao.status}`,
        );
        pagamentosProcessadosService.delete(transacaoId);
        return { transacao, todosDepositaram: false, jaProcessado: true };
      }

      // ATUALIZAR TRANSACAO
      transacao.status = "confirmado";
      transacao.comprovante = comprovanteUrl;
      transacao.dataConfirmacao = new Date();
      transacao.confirmadoPor = confirmadoPorId;

      await transacao.save();
      console.log(
        `[confirmarDeposito] Transacao ${transacaoId} atualizada para status: confirmado`,
      );

      // BUSCAR RODADA
      const rodada = await Rodada.findById(transacao.rodada);
      if (!rodada) {
        console.error(
          `[confirmarDeposito] Rodada nao encontrada: ${transacao.rodada}`,
        );
        pagamentosProcessadosService.delete(transacaoId);
        throw new Error("Rodada nao encontrada");
      }

      console.log(
        `[confirmarDeposito] Rodada encontrada: ${rodada.nome} (${rodada.status})`,
      );

      // ENCONTRAR PARTICIPANTE
      const participante = rodada.participantes.find(
        (p) => p.usuario.toString() === transacao.pagador.toString(),
      );

      if (!participante) {
        console.error(
          `[confirmarDeposito] Participante nao encontrado na rodada para usuario: ${transacao.pagador}`,
        );
        pagamentosProcessadosService.delete(transacaoId);
        throw new Error("Participante nao encontrado na rodada");
      }

      console.log(
        `[confirmarDeposito] Participante encontrado: cor=${participante.cor}, depositoConfirmado antes=${participante.depositoConfirmado}`,
      );

      // VERIFICAR SE PARTICIPANTE JA ESTA PAGO
      if (participante.depositoConfirmado === true) {
        console.log(
          `[confirmarDeposito] Participante ${participante.usuario} ja estava marcado como pago. Ignorando.`,
        );
        pagamentosProcessadosService.delete(transacaoId);
        return { transacao, todosDepositaram: false, jaProcessado: true };
      }

      // MARCAR PARTICIPANTE COMO PAGO
      participante.depositoConfirmado = true;
      participante.dataDeposito = new Date();
      participante.comprovantePix = comprovanteUrl;

      // CONTAR VERMELHOS PAGOS
      const vermelhos = rodada.participantes.filter(
        (p) => p.cor === "vermelho",
      );
      const vermelhosPagos = vermelhos.filter(
        (v) => v.depositoConfirmado === true,
      );

      rodada.totalDepositosConfirmados = vermelhosPagos.length;

      console.log(
        `[confirmarDeposito] Progresso pagamentos: ${vermelhosPagos.length}/${vermelhos.length}`,
      );

      await rodada.save();
      console.log(`[confirmarDeposito] Participante atualizado e rodada salva`);

      // VERIFICAR SE TODOS PAGARAM
      let todosDepositaram = false;
      if (vermelhosPagos.length === vermelhos.length && vermelhos.length > 0) {
        console.log(
          `[confirmarDeposito] TODOS OS ${vermelhos.length} VERMELHOS PAGARAM!`,
        );

        if (!rodada.todosDepositaram) {
          rodada.todosDepositaram = true;
          rodada.dataTodosDepositaram = new Date();
          await rodada.save();
          console.log(
            `[confirmarDeposito] Rodada marcada como "todos depositaram"`,
          );
        }

        todosDepositaram = true;

        console.log(`[confirmarDeposito] Chamando avancarRodada...`);
        await this.avancarRodada(rodada._id);
        console.log(`[confirmarDeposito] avancarRodada concluido`);
      }

      console.log(
        `[confirmarDeposito] Processo concluido com sucesso para transacao ${transacaoId}`,
      );

      return {
        transacao,
        todosDepositaram,
        progresso: `${vermelhosPagos.length}/${vermelhos.length}`,
        jaProcessado: false,
      };
    } catch (error) {
      console.error("[confirmarDeposito] Erro ao confirmar deposito:", error);
      console.error("[confirmarDeposito] Stack trace:", error.stack);

      if (transacaoId) {
        pagamentosProcessadosService.delete(transacaoId);
      }

      throw error;
    }
  }

  // ===========================================
  // CRIAR TRANSACOES PARA VERMELHOS (VALOR CORRETO: R$ 150)
  // ===========================================
  async criarTransacoesParaVermelhos(rodadaId) {
    try {
      const rodada = await Rodada.findById(rodadaId);
      if (!rodada) throw new Error("Rodada nao encontrada");

      const verdeId = rodada.verde;
      if (!verdeId) throw new Error("Verde nao definido na rodada");

      // 🔥 CORREÇÃO: Buscar vermelhos pelos participantes, NÃO pelo array vermelhos
      const vermelhos = rodada.participantes.filter(
        (p) => p.cor === "vermelho",
      );

      if (vermelhos.length === 0) {
        console.log(
          `Nenhum vermelho para criar transacoes na rodada ${rodada.nome}`,
        );
        return [];
      }

      console.log(
        `Criando ${vermelhos.length} transacoes para a rodada ${rodada.nome}...`,
      );

      const transacoes = [];
      const valor = 150; // ✅ VALOR CORRETO: R$ 150,00

      for (const participante of vermelhos) {
        const vermelhoId = participante.usuario;

        // Verificar se ja existe transacao para este vermelho
        const existe = await Transacao.findOne({
          pagador: vermelhoId,
          rodada: rodadaId,
        });

        if (!existe) {
          const transacao = new Transacao({
            tipo: "deposito",
            pagador: vermelhoId,
            recebedor: verdeId,
            valor: valor,
            rodada: rodadaId,
            status: "pendente",
          });

          await transacao.save();
          transacoes.push(transacao);

          // Associar transacao ao participante
          participante.transacaoId = transacao._id;

          // Garantir que o array vermelhos também tenha o ID (para consistência)
          if (!rodada.vermelhos.includes(vermelhoId)) {
            rodada.vermelhos.push(vermelhoId);
          }

          console.log(
            `   Transacao criada para vermelho ${vermelhoId} (R$ ${valor})`,
          );
        }
      }

      if (transacoes.length > 0) {
        await rodada.save();
      }

      console.log(
        `${transacoes.length} transacoes criadas para rodada ${rodada.nome}`,
      );
      return transacoes;
    } catch (error) {
      console.error("Erro ao criar transacoes para vermelhos:", error);
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
        throw new Error("Rodada nao encontrada");
      }

      console.log(`[DEBUG] Rodada: ${rodada.nome}, Status: ${rodada.status}`);

      const vermelhos = rodada.participantes.filter(
        (p) => p.cor === "vermelho",
      );
      const vermelhosPagos = vermelhos.filter(
        (v) => v.depositoConfirmado === true,
      );
      const todosDepositaram =
        vermelhosPagos.length === vermelhos.length && vermelhos.length > 0;

      console.log(
        `[DEBUG] Vermelhos: ${vermelhos.length}, Pagos: ${vermelhosPagos.length}, Todos pagaram: ${todosDepositaram}`,
      );

      vermelhos.forEach((v) => {
        console.log(
          `   Vermelho: ${v.usuario} - Pago: ${v.depositoConfirmado}`,
        );
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
          console.log(
            `[DEBUG] Atualizado totalDepositosConfirmados: ${vermelhosPagos.length}`,
          );
        } else {
          console.log(`[DEBUG] Nenhuma mudanca no total de depositos`);
        }
      }

      return todosDepositaram;
    } catch (error) {
      console.error("Erro ao verificar depositos:", error);
      throw error;
    }
  }

  // ===========================================
  // ALOCAR FILA EM TODAS AS RODADAS COM VAGAS
  // ===========================================
  async alocarFilaEmTodasRodadas() {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`[ALOCAR FILA TOTAL] Verificando todas as rodadas com vagas`);
    console.log(`${"=".repeat(60)}`);

    // Buscar TODAS as rodadas que podem receber vermelhos
    const rodadasComVagas = await Rodada.find({
      status: { $in: ["aguardando", "em_andamento"] },
      $expr: {
        $lt: [
          {
            $size: {
              $filter: {
                input: "$participantes",
                as: "p",
                cond: { $eq: ["$$p.cor", "vermelho"] },
              },
            },
          },
          8,
        ],
      },
    }).sort({ createdAt: 1 });

    if (rodadasComVagas.length === 0) {
      console.log(`   Nenhuma rodada com vaga para vermelho`);
      return 0;
    }

    // Calcular TOTAL de vagas disponíveis
    let totalVagas = 0;
    for (const rodada of rodadasComVagas) {
      const vermelhosAtuais = rodada.participantes.filter(
        (p) => p.cor === "vermelho",
      ).length;
      const vagas = 8 - vermelhosAtuais;
      totalVagas += vagas;
      console.log(`   ${rodada.nome}: ${vagas} vagas (${vermelhosAtuais}/8)`);
    }

    // Buscar TODOS os usuários na fila (ordem FIFO)
    const filaUsuarios = await User.find({ aguardandoVermelho: true }).sort({
      posicaoFila: 1,
    });

    if (filaUsuarios.length === 0) {
      console.log(`   Nenhum usuário na fila`);
      return 0;
    }

    console.log(`\n   Total de vagas disponíveis: ${totalVagas}`);
    console.log(`   Usuários na fila: ${filaUsuarios.length}`);
    console.log(
      `   Serão alocados: ${Math.min(totalVagas, filaUsuarios.length)} usuários`,
    );

    let alocados = 0;
    let indexFila = 0;

    // Percorrer TODAS as rodadas com vagas
    for (const rodada of rodadasComVagas) {
      let vagasRestantes =
        8 - rodada.participantes.filter((p) => p.cor === "vermelho").length;

      console.log(`\n   Processando ${rodada.nome}: ${vagasRestantes} vagas`);

      while (vagasRestantes > 0 && indexFila < filaUsuarios.length) {
        const usuario = filaUsuarios[indexFila];

        console.log(
          `      Alocando Pos ${usuario.posicaoFila}: ${usuario.nome}`,
        );

        // Verificar consistência
        const usuarioAtual = await User.findById(usuario._id);
        if (!usuarioAtual.aguardandoVermelho) {
          console.log(`         ⚠️ Usuário não está mais na fila. Pulando...`);
          indexFila++;
          continue;
        }

        const emRodadaAtiva = await this.usuarioEstaEmRodadaAtiva(usuario._id);
        if (emRodadaAtiva) {
          console.log(
            `         ⚠️ Usuário já está em rodada ativa. Removendo da fila...`,
          );
          usuarioAtual.aguardandoVermelho = false;
          usuarioAtual.posicaoFila = null;
          usuarioAtual.dataEntradaFila = null;
          await usuarioAtual.save();
          indexFila++;
          continue;
        }

        // Verificar se já está nesta rodada
        const usuarioJaNaRodada = rodada.participantes.some(
          (p) => p.usuario.toString() === usuario._id.toString(),
        );

        if (usuarioJaNaRodada) {
          console.log(
            `         ⚠️ Usuário já está nesta rodada. Removendo da fila...`,
          );
          usuarioAtual.aguardandoVermelho = false;
          usuarioAtual.posicaoFila = null;
          usuarioAtual.dataEntradaFila = null;
          await usuarioAtual.save();
          indexFila++;
          continue;
        }

        try {
          // Adicionar como VERMELHO
          await this.adicionarParticipanteVermelho(
            rodada._id.toString(),
            usuario._id.toString(),
            null,
          );

          // 🔥 VERIFICAR SE TEM SALDO PARA PAGAR AUTOMATICAMENTE
          const usuarioAlocado = await User.findById(usuario._id);
          if (usuarioAlocado && (usuarioAlocado.saldoPremio || 0) >= 150) {
            const transacao = await Transacao.findOne({
              pagador: usuario._id,
              rodada: rodada._id,
              status: "pendente",
            });

            if (transacao) {
              transacao.status = "confirmado";
              transacao.dataConfirmacao = new Date();
              transacao.metadata = {
                ...(transacao.metadata || {}),
                pagoComSaldo: true,
                alocadoDaFila: true,
                valorDescontado: 150,
              };
              await transacao.save();

              const rodadaAtualizada = await Rodada.findById(rodada._id);
              const participante = rodadaAtualizada.participantes.find(
                (p) => p.usuario.toString() === usuario._id.toString(),
              );
              if (participante) {
                participante.depositoConfirmado = true;
                participante.dataDeposito = new Date();
                participante.comprovantePix = "PAGO_COM_SALDO_FILA";
              }

              const vermelhos = rodadaAtualizada.participantes.filter(
                (p) => p.cor === "vermelho",
              );
              const vermelhosPagos = vermelhos.filter(
                (v) => v.depositoConfirmado === true,
              );
              rodadaAtualizada.totalDepositosConfirmados =
                vermelhosPagos.length;
              await rodadaAtualizada.save();

              const novoSaldo = (usuarioAlocado.saldoPremio || 0) - 150;
              await User.findByIdAndUpdate(usuario._id, {
                $set: { saldoPremio: novoSaldo },
              });

              console.log(
                `   💰 Usuário ${usuario.nome} pagou automaticamente com saldo da fila. Restante: R$ ${novoSaldo}`,
              );

              if (vermelhosPagos.length === vermelhos.length) {
                await this.verificarEAvancarSeNecessario(rodada._id);
              }
            }
          }

          // Remover da fila
          usuarioAtual.aguardandoVermelho = false;
          usuarioAtual.posicaoFila = null;
          usuarioAtual.dataEntradaFila = null;
          await usuarioAtual.save();

          console.log(`         ✅ Alocado como VERMELHO na ${rodada.nome}`);
          alocados++;
          indexFila++;
          vagasRestantes--;
        } catch (error) {
          console.error(
            `         ❌ Erro ao alocar ${usuario.nome}:`,
            error.message,
          );
          indexFila++;
        }
      }

      if (indexFila >= filaUsuarios.length) {
        console.log(`   Fim da fila alcançado`);
        break;
      }
    }

    const restantes = await User.countDocuments({ aguardandoVermelho: true });
    console.log(`\n✅ ALOCAÇÃO TOTAL CONCLUÍDA: ${alocados} usuários alocados`);
    console.log(`   Restam na fila: ${restantes} (aguardando próximas vagas)`);
    console.log(`${"=".repeat(60)}\n`);

    return alocados;
  }

  // ===========================================
  // AVANCAR RODADA - PROMOVER CORES E GERAR NOVAS RODADAS
  // ===========================================
  async avancarRodada(rodadaId) {
    // PREVENIR PROCESSAMENTO DUPLICADO
    if (processandoRodadas.has(rodadaId)) {
      console.log(
        `[avancarRodada] Rodada ${rodadaId} ja esta sendo processada. Ignorando.`,
      );
      return null;
    }
    processandoRodadas.set(rodadaId, Date.now());

    setTimeout(() => {
      if (processandoRodadas.has(rodadaId)) {
        processandoRodadas.delete(rodadaId);
        console.log(
          `[avancarRodada] Cache da rodada ${rodadaId} removido (timeout)`,
        );
      }
    }, 30 * 1000);

    try {
      console.log(`[DEBUG] INICIANDO avancarRodada para: ${rodadaId}`);

      const rodada = await Rodada.findById(rodadaId);
      if (!rodada) {
        console.error(`[DEBUG] Rodada nao encontrada: ${rodadaId}`);
        throw new Error("Rodada nao encontrada");
      }

      console.log(
        `[DEBUG] Rodada: ${rodada.nome}, Status atual: ${rodada.status}`,
      );

      // ✅ VERIFICAÇÃO: Se já está concluída, não faz nada
      if (rodada.status === "concluida") {
        console.log(
          `[DEBUG] Rodada ${rodada.nome} ja esta concluida. Ignorando.`,
        );
        return rodada;
      }

      if (rodada.status !== "em_andamento") {
        console.error(
          `[DEBUG] Rodada nao esta em andamento. Status: ${rodada.status}`,
        );
        throw new Error("Rodada nao esta em andamento");
      }

      // ✅ VERIFICAÇÃO CRÍTICA: Se já gerou rodadas, NÃO processa novamente
      if (rodada.rodadasGeradas && rodada.rodadasGeradas.length > 0) {
        console.log(
          `[DEBUG] Rodada ${rodada.nome} ja gerou ${rodada.rodadasGeradas.length} rodadas. Ignorando.`,
        );
        return rodada;
      }

      // ===========================================
      // 1. VERIFICAR SE TODOS OS VERMELHOS PAGARAM
      // ===========================================
      const vermelhos = rodada.participantes.filter(
        (p) => p.cor === "vermelho",
      );
      const vermelhosPagos = vermelhos.filter(
        (v) => v.depositoConfirmado === true,
      );

      if (vermelhosPagos.length !== 8) {
        console.log(
          `[DEBUG] Apenas ${vermelhosPagos.length}/8 vermelhos pagaram. Aguardando...`,
        );
        return rodada;
      }

      console.log(
        `[DEBUG] Todos os 8 vermelhos pagaram! Prosseguindo com avanco...`,
      );

      // ===========================================
      // 2. SALVAR O VERDE ATUAL (vai ganhar premio)
      // ===========================================
      const verdeAtual = rodada.participantes.find((p) => p.cor === "verde");
      console.log(
        `[DEBUG] Verde atual que ganhou R$ 1000: ${verdeAtual?.usuario}`,
      );

      // ===========================================
      // 3. PROMOVER CORES (dentro da rodada)
      // ===========================================
      console.log(`[DEBUG] Promovendo cores...`);

      for (const p of rodada.participantes) {
        if (p.cor === "vermelho") {
          p.cor = "azul";
          console.log(`   vermelho->azul ${p.usuario}`);
        } else if (p.cor === "azul") {
          p.cor = "preto";
          console.log(`   azul->preto ${p.usuario}`);
        } else if (p.cor === "preto") {
          p.cor = "verde";
          console.log(`   preto->verde ${p.usuario}`);
        } else if (p.cor === "verde") {
          p.cor = "concluido";
          console.log(`   verde->concluido ${p.usuario} (ganhou R$ 1000)`);

          // 🔥 🔥 🔥 CORREÇÃO ADICIONADA 🔥 🔥 🔥
          // Adicionar saldo ao usuário que ganhou o prêmio
          try {
            await User.findByIdAndUpdate(p.usuario, {
              $inc: {
                saldoPremio: 1000,
                totalGanho: 1000,
              },
            });
            console.log(
              `   💰 Prêmio de R$ 1.000 creditado ao usuário ${p.usuario}`,
            );
          } catch (err) {
            console.error(`   ❌ Erro ao creditar prêmio: ${err.message}`);
          }
          // =========================================
        }
      }

      // ===========================================
      // 4. SEPARAR PARTICIPANTES POR COR APOS PROMOCAO
      // ===========================================
      const novosVerdes = rodada.participantes.filter((p) => p.cor === "verde");
      const novosPretos = rodada.participantes.filter((p) => p.cor === "preto");
      const novosAzuis = rodada.participantes.filter((p) => p.cor === "azul");

      console.log(
        `[DEBUG] Apos promocao: Verdes: ${novosVerdes.length}, Pretos: ${novosPretos.length}, Azuis: ${novosAzuis.length}`,
      );

      // Validar quantidade de verdes (devem ser 2)
      if (novosVerdes.length !== 2) {
        console.error(
          `[DEBUG] ERRO: Numero de verdes insuficiente: ${novosVerdes.length}. Esperado: 2`,
        );
        await rodada.save();
        return rodada;
      }

      // ===========================================
      // 5. CRIAR 2 NOVAS RODADAS (APENAS 2!)
      // ===========================================
      console.log(`[DEBUG] 2 verdes encontrados! Gerando 2 novas rodadas...`);

      const verdesIds = novosVerdes.map((v) => v.usuario);
      const pretosIds = novosPretos.map((p) => p.usuario);
      const azuisIds = novosAzuis.map((a) => a.usuario);

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
        rodada._id,
      );

      console.log(`[DEBUG] Criando rodada #${proximoNumero + 1}...`);
      const novaRodada2 = await this.criarRodadaAvancada(
        proximoNumero + 1,
        verdesIds[1],
        grupo2Pretos,
        grupo2Azuis,
        rodada._id,
      );

      // ✅ MARCAR QUE AS RODADAS FORAM GERADAS (evita duplicação)
      rodada.rodadasGeradas = [novaRodada1._id, novaRodada2._id];
      console.log(`[DEBUG] Rodadas geradas com sucesso!`);

      // ===========================================
      // 6. ALOCAR USUARIOS DA FILA DE ESPERA
      // ===========================================
      await this.alocarFilaEmTodasRodadas();

      // ===========================================
      // 7. FINALIZAR RODADA ORIGINAL COMO CONCLUÍDA
      // ===========================================
      console.log(
        `\n[FINALIZACAO] Finalizando rodada original como concluída...`,
      );

      rodada.historicoMovimentacoes.push({
        usuario: verdeAtual.usuario,
        corAnterior: "verde",
        corNova: "concluido",
        observacao: `✅ RODADA CONCLUÍDA! Prêmio de R$ 1000 disponível para saque.`,
        data: new Date(),
      });

      rodada.status = "concluida";
      rodada.dataFim = new Date();
      rodada.premioVerdePago = false;

      await rodada.save();

      console.log(`[FINALIZACAO] Rodada ${rodada.nome} concluída com sucesso!`);
      console.log(`   🏆 Verde vencedor ganhou R$ 1000`);
      console.log(`   Novas rodadas geradas: ${rodada.rodadasGeradas.length}`);

      return rodada;
    } catch (error) {
      console.error("Erro ao avancar rodada:", error);
      console.error("Stack trace:", error.stack);
      throw error;
    } finally {
      processandoRodadas.delete(rodadaId);
      console.log(`[avancarRodada] Cache da rodada ${rodadaId} removido`);
    }
  }

  // Metodo auxiliar para criar rodada avancada
  async criarRodadaAvancada(
    numero,
    verdeId,
    pretosIds,
    azuisIds,
    rodadaOrigemId,
  ) {
    try {
      const rodada = new Rodada({
        numero: numero,
        nome: `Rodada #${numero}`,
        status: "aguardando",
        participantes: [],
        totalDepositosConfirmados: 0,
        todosDepositaram: false,
        historicoMovimentacoes: [],
        rodadaOrigem: rodadaOrigemId,
      });

      // Adicionar verde (ja esta na posicao correta)
      rodada.participantes.push({
        usuario: verdeId,
        cor: "verde",
        posicao: 1,
        dataEntrada: new Date(),
        depositoConfirmado: false,
      });

      // Adicionar pretos
      pretosIds.forEach((id) => {
        rodada.participantes.push({
          usuario: id,
          cor: "preto",
          posicao: rodada.participantes.length + 1,
          dataEntrada: new Date(),
          depositoConfirmado: false,
        });
      });

      // Adicionar azuis
      azuisIds.forEach((id) => {
        rodada.participantes.push({
          usuario: id,
          cor: "azul",
          posicao: rodada.participantes.length + 1,
          dataEntrada: new Date(),
          depositoConfirmado: false,
        });
      });

      // Atualizar listas de cores
      rodada.verde = verdeId;
      rodada.pretos = pretosIds;
      rodada.azuis = azuisIds;
      rodada.vermelhos = [];

      await rodada.save();

      console.log(
        `Rodada avancada ${rodada.nome} criada com ${rodada.participantes.length} participantes`,
      );
      console.log(`   Verde: 1`);
      console.log(`   Pretos: ${pretosIds.length}`);
      console.log(`   Azuis: ${azuisIds.length}`);
      console.log(`   Vermelhos: 0 (aguardando novos convidados)`);
      console.log(
        `   Status: AGUARDANDO (precisa de mais ${15 - rodada.participantes.length} participantes)`,
      );

      return rodada;
    } catch (error) {
      console.error("Erro ao criar rodada avancada:", error);
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
      console.error("Erro ao obter proximo numero:", error);
      return 1;
    }
  }

  // ===========================================
  // BUSCAR RODADA ATIVA DO USUARIO (IGNORA CONCLUIDOS)
  // ===========================================
  async buscarRodadaAtivaDoUsuario(usuarioId) {
    try {
      // 🔥 CORREÇÃO COMPLETA: Ignorar participantes com cor "concluido"
      // e também garantir que a rodada não está concluída
      const rodada = await Rodada.findOne({
        status: { $in: ["aguardando", "em_andamento"] },
        "participantes.usuario": usuarioId,
        "participantes.cor": { $ne: "concluido" },
      });

      if (rodada) {
        console.log(
          `[buscarRodadaAtivaDoUsuario] Usuário ${usuarioId} encontrado na rodada ${rodada.nome} com cor ${rodada.participantes.find((p) => p.usuario.toString() === usuarioId)?.cor}`,
        );
      }

      return rodada;
    } catch (error) {
      console.error("Erro ao buscar rodada ativa:", error);
      return null;
    }
  }

  // Buscar rodada do usuario que aceita novos vermelhos
  async buscarRodadaParaNovoVermelho(usuarioId) {
    try {
      console.log(`\n${"=".repeat(60)}`);
      console.log(`[buscarRodadaParaNovoVermelho] INICIANDO BUSCA`);
      console.log(`${"=".repeat(60)}`);
      console.log(`   Usuario ID: ${usuarioId}`);

      const user = await User.findById(usuarioId);
      console.log(`   Usuario: ${user?.nome || "nao encontrado"}`);

      // Buscar rodadas do usuario que estao em 'em_andamento' ou 'aguardando'
      const rodadasDoUsuario = await Rodada.find({
        "participantes.usuario": usuarioId,
        status: { $in: ["em_andamento", "aguardando"] },
      }).sort({ numero: -1 });

      console.log(`\nRODADAS ENCONTRADAS: ${rodadasDoUsuario.length}`);

      if (rodadasDoUsuario.length === 0) {
        console.log(`   Nenhuma rodada encontrada para o usuario`);
        console.log(`${"=".repeat(60)}\n`);
        return null;
      }

      // PRIORIDADE 1: Rodadas que JA TEM estrutura e podem receber vermelho (em_andamento ou aguardando com estrutura)
      for (const rodada of rodadasDoUsuario) {
        const vermelhosAtuais = rodada.participantes.filter(
          (p) => p.cor === "vermelho",
        ).length;
        const temEstrutura = !!(rodada.verde && rodada.pretos && rodada.azuis);

        // Pode receber vermelho se:
        // 1. Esta em_andamento, OU
        // 2. Esta aguardando mas ja tem estrutura (rodadas avancadas)
        const podeReceberVermelho =
          rodada.status === "em_andamento" ||
          (rodada.status === "aguardando" && temEstrutura);

        console.log(`\n   Analisando rodada ${rodada.nome}:`);
        console.log(`      - Status: ${rodada.status}`);
        console.log(`      - Tem estrutura: ${temEstrutura ? "SIM" : "NAO"}`);
        console.log(
          `      - Pode receber vermelho: ${podeReceberVermelho ? "SIM" : "NAO"}`,
        );
        console.log(`      - Vermelhos atuais: ${vermelhosAtuais}/8`);
        console.log(
          `      - Total participantes: ${rodada.participantes.length}/15`,
        );

        if (vermelhosAtuais < 8 && podeReceberVermelho) {
          console.log(
            `   Rodada ${rodada.nome} SELECIONADA! (tem estrutura e ${8 - vermelhosAtuais} vagas)`,
          );
          return rodada;
        } else if (vermelhosAtuais >= 8 && podeReceberVermelho) {
          console.log(
            `   Rodada ${rodada.nome} tem estrutura mas esta cheia (${vermelhosAtuais}/8 vermelhos)`,
          );
        } else if (!podeReceberVermelho && temEstrutura) {
          console.log(
            `   Rodada ${rodada.nome} tem estrutura mas status invalido: ${rodada.status}`,
          );
        }
      }

      // PRIORIDADE 2: Se nao encontrou rodada com estrutura, retorna a rodada mais recente (em formacao)
      // Isso faz o convidado ser adicionado como AMARELO na mesma rodada, nao criar uma nova
      const rodadaMaisRecente = rodadasDoUsuario[0];
      const vermelhosAtuais = rodadaMaisRecente.participantes.filter(
        (p) => p.cor === "vermelho",
      ).length;
      const temEstrutura = !!(
        rodadaMaisRecente.verde &&
        rodadaMaisRecente.pretos &&
        rodadaMaisRecente.azuis
      );

      console.log(`\n   Nenhuma rodada com estrutura e vagas encontrada`);
      console.log(
        `   -> Usando rodada mais recente: ${rodadaMaisRecente.nome}`,
      );
      console.log(`   -> Status: ${rodadaMaisRecente.status}`);
      console.log(`   -> Tem estrutura: ${temEstrutura ? "SIM" : "NAO"}`);
      console.log(`   -> Vermelhos: ${vermelhosAtuais}/8`);
      console.log(
        `   -> Convidado sera adicionado como ${temEstrutura ? "VERMELHO" : "AMARELO"} nesta rodada`,
      );
      console.log(`${"=".repeat(60)}\n`);

      return rodadaMaisRecente;
    } catch (error) {
      console.error("Erro ao buscar rodada para novo vermelho:", error);
      return null;
    }
  }

  async buscarRodadaParaConvite(usuarioId) {
    try {
      const rodadaDoUsuario =
        await this.buscarRodadaParaNovoVermelho(usuarioId);
      if (rodadaDoUsuario) {
        return rodadaDoUsuario;
      }

      const rodadaComVagas = await Rodada.findOne({
        status: "em_andamento",
        "participantes.0": { $exists: true },
      }).sort({ numero: -1 });

      if (rodadaComVagas) {
        const vermelhosAtuais = rodadaComVagas.participantes.filter(
          (p) => p.cor === "vermelho",
        ).length;
        if (vermelhosAtuais < 8) {
          return rodadaComVagas;
        }
      }

      return null;
    } catch (error) {
      console.error("Erro ao buscar rodada para convite:", error);
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
      console.error("Erro ao garantir rodada:", error);
      throw error;
    }
  }

  async buscarHistoricoUsuario(usuarioId) {
    try {
      const rodadas = await Rodada.find({
        "participantes.usuario": usuarioId,
      }).sort({ numero: -1 });
      return rodadas;
    } catch (error) {
      console.error("Erro ao buscar historico:", error);
      throw error;
    }
  }

  async verificarStatusUsuario(usuarioId) {
    try {
      const usuario = await User.findById(usuarioId);
      const rodadaAtiva = await this.buscarRodadaAtivaDoUsuario(usuarioId);
      const rodadaEmAndamento =
        await this.buscarRodadaParaNovoVermelho(usuarioId);
      const historico = await this.buscarHistoricoUsuario(usuarioId);

      const rodadasConcluidas = historico.filter(
        (r) =>
          r.status === "concluida" &&
          r.participantes.some(
            (p) =>
              p.usuario.toString() === usuarioId.toString() &&
              p.cor === "concluido",
          ),
      );

      const totalGanho = rodadasConcluidas.length * 1000;

      // CALCULO CORRETO: Esta na fila de espera apenas se:
      // 1. Tem a flag aguardandoVermelho = true
      // 2. NAO esta em nenhuma rodada ativa (aguardando)
      // 3. NAO esta em nenhuma rodada em andamento
      const naFilaEspera =
        usuario?.aguardandoVermelho === true &&
        !rodadaAtiva &&
        !rodadaEmAndamento;

      return {
        temRodadaAtiva: !!rodadaAtiva,
        temRodadaEmAndamento: !!rodadaEmAndamento,
        rodadaAtiva: rodadaAtiva
          ? {
              id: rodadaAtiva._id,
              numero: rodadaAtiva.numero,
              cor: rodadaAtiva.participantes.find(
                (p) => p.usuario.toString() === usuarioId.toString(),
              )?.cor,
            }
          : null,
        rodadaEmAndamento: rodadaEmAndamento
          ? {
              id: rodadaEmAndamento._id,
              numero: rodadaEmAndamento.numero,
              cor: rodadaEmAndamento.participantes.find(
                (p) => p.usuario.toString() === usuarioId.toString(),
              )?.cor,
              vagasVermelho:
                8 -
                rodadaEmAndamento.participantes.filter(
                  (p) => p.cor === "vermelho",
                ).length,
            }
          : null,
        rodadasConcluidas: rodadasConcluidas.length,
        totalGanho: totalGanho,
        historico: historico,
        aguardandoVermelho: usuario?.aguardandoVermelho || false,
        naFilaEspera: naFilaEspera,
        posicaoFila: usuario?.posicaoFila || null,
      };
    } catch (error) {
      console.error("Erro ao verificar status:", error);
      throw error;
    }
  }

  // ===========================================
  // VERIFICAR E AVANCAR SE TODOS PAGARAM
  // ===========================================
  async verificarEAvancarSeNecessario(rodadaId) {
    try {
      console.log(
        `[AUTO] Verificando rodada ${rodadaId} para avanco automatico...`,
      );

      const rodada = await Rodada.findById(rodadaId);
      if (!rodada) {
        console.error(`[AUTO] Rodada nao encontrada: ${rodadaId}`);
        return false;
      }

      // ✅ Já está concluída
      if (rodada.status === "concluida") {
        console.log(`[AUTO] Rodada ${rodada.nome} ja esta concluida.`);
        return true;
      }

      // ✅ Já gerou rodadas (proteção contra duplicação)
      if (rodada.rodadasGeradas && rodada.rodadasGeradas.length > 0) {
        console.log(
          `[AUTO] Rodada ${rodada.nome} ja gerou ${rodada.rodadasGeradas.length} rodadas. Ignorando.`,
        );
        return true;
      }

      if (rodada.status !== "em_andamento") {
        console.log(
          `[AUTO] Rodada ${rodada.nome} nao esta em andamento (status: ${rodada.status})`,
        );
        return false;
      }

      const vermelhos = rodada.participantes.filter(
        (p) => p.cor === "vermelho",
      );
      const vermelhosPagos = vermelhos.filter(
        (v) => v.depositoConfirmado === true,
      );
      const todosPagos = vermelhosPagos.length === 8;

      console.log(
        `[AUTO] Rodada ${rodada.nome}: ${vermelhosPagos.length}/8 vermelhos pagos`,
      );

      if (todosPagos) {
        console.log(`[AUTO] Todos pagaram! Avancando rodada...`);
        await this.avancarRodada(rodadaId);
        console.log(`[AUTO] Rodada ${rodada.nome} avancada com sucesso!`);
        return true;
      }

      return false;
    } catch (error) {
      console.error("[AUTO] Erro ao verificar e avancar:", error);
      return false;
    }
  }

  // ===========================================
  // JOGAR NOVAMENTE (usuario que ganhou quer voltar como vermelho) - COM SALDO E FILA
  // ===========================================
  async jogarNovamente(usuarioId) {
    try {
      console.log(`\n[REENTRADA] Usuario ${usuarioId} quer jogar novamente`);

      const usuario = await User.findById(usuarioId);
      if (!usuario) {
        throw new Error("Usuario nao encontrado");
      }

      console.log(`💰 Saldo de prêmio atual: R$ ${usuario.saldoPremio || 0}`);
      console.log(
        `⏳ Aguardando vermelho: ${usuario.aguardandoVermelho || false}`,
      );
      console.log(`📍 Posição na fila: ${usuario.posicaoFila || "nenhuma"}`);

      // ===========================================
      // SE HÁ SAQUE PENDENTE, CANCELAR AUTOMATICAMENTE
      // ===========================================
      const SolicitacaoSaque = require("../models/SolicitacaoSaque");
      const solicitacaoPendente = await SolicitacaoSaque.findOne({
        usuario: usuarioId,
        status: "pendente",
      });

      if (solicitacaoPendente) {
        console.log(
          `⏳ Saque pendente encontrado (ID: ${solicitacaoPendente._id}). Cancelando...`,
        );
        solicitacaoPendente.status = "recusado";
        solicitacaoPendente.motivoRecusa =
          "Cancelado automaticamente ao jogar novamente (usou parte do saldo)";
        solicitacaoPendente.dataRecusa = new Date();
        await solicitacaoPendente.save();
        console.log(
          `✅ Saque pendente cancelado. Saldo de R$ ${usuario.saldoPremio || 0} continua disponível.`,
        );
      }

      // Verificar se ja esta em alguma rodada ativa
      const rodadaAtiva = await this.buscarRodadaAtivaDoUsuario(usuarioId);
      if (rodadaAtiva) {
        throw new Error("Voce ja esta participando de uma rodada ativa");
      }

      // 🔥 VERIFICAR SE TEM SALDO PARA PAGAR AUTOMATICAMENTE
      const temSaldo = (usuario.saldoPremio || 0) >= 150;
      let pagoAutomaticamente = false;
      let saldoRestante = usuario.saldoPremio || 0;

      // ===========================================
      // BUSCAR RODADA COM VAGA PARA VERMELHO
      // ===========================================

      // PRIORIDADE 1: Rodadas em_andamento com vagas
      let rodadaParaEntrar = await Rodada.findOne({
        status: "em_andamento",
        $expr: {
          $lt: [
            {
              $size: {
                $filter: {
                  input: "$participantes",
                  as: "p",
                  cond: { $eq: ["$$p.cor", "vermelho"] },
                },
              },
            },
            8,
          ],
        },
      }).sort({ createdAt: 1 });

      // PRIORIDADE 2: Rodadas aguardando que JÁ TEM estrutura (rodadas filhas)
      if (!rodadaParaEntrar) {
        rodadaParaEntrar = await Rodada.findOne({
          status: "aguardando",
          verde: { $ne: null },
          pretos: { $ne: [] },
          azuis: { $ne: [] },
          $expr: {
            $lt: [
              {
                $size: {
                  $filter: {
                    input: "$participantes",
                    as: "p",
                    cond: { $eq: ["$$p.cor", "vermelho"] },
                  },
                },
              },
              8,
            ],
          },
        }).sort({ createdAt: 1 });
      }

      // ===========================================
      // CASO 1: ENCONTROU RODADA COM VAGA
      // ===========================================
      if (rodadaParaEntrar) {
        console.log(`✅ Rodada encontrada: ${rodadaParaEntrar.nome}`);

        // Verificar se o usuário já não está na fila (limpar sujeira)
        if (usuario.aguardandoVermelho) {
          console.log(
            `⚠️ Usuário estava na fila. Removendo da fila antes de entrar na rodada...`,
          );
          usuario.aguardandoVermelho = false;
          usuario.posicaoFila = null;
          usuario.dataEntradaFila = null;
          await usuario.save();
        }

        // Adicionar como VERMELHO
        await this.adicionarParticipanteVermelho(
          rodadaParaEntrar._id.toString(),
          usuarioId,
          null,
        );

        // 🔥 SE TEM SALDO, CRIAR TRANSACAO E MARCAR COMO PAGO AUTOMATICAMENTE
        if (temSaldo) {
          console.log(
            `💰 Usuário tem saldo de R$ ${saldoRestante}. Criando transação e aplicando pagamento automático...`,
          );

          // 🔥 CRIA A TRANSACAO IMEDIATAMENTE
          const verdeId = rodadaParaEntrar.verde;
          if (!verdeId) {
            console.log(
              `⚠️ Rodada ${rodadaParaEntrar.nome} não tem VERDE definido!`,
            );
          } else {
            // Verificar se a transação já existe
            let transacao = await Transacao.findOne({
              pagador: usuarioId,
              rodada: rodadaParaEntrar._id,
            });

            // Se não existe, criar uma nova
            if (!transacao) {
              transacao = new Transacao({
                tipo: "deposito",
                pagador: usuarioId,
                recebedor: verdeId,
                valor: 150,
                rodada: rodadaParaEntrar._id,
                status: "pendente",
              });
              await transacao.save();
              console.log(`   ✅ Transação criada: ${transacao._id}`);
            }

            // Marcar transação como confirmada
            transacao.status = "confirmado";
            transacao.dataConfirmacao = new Date();
            transacao.metadata = {
              ...(transacao.metadata || {}),
              pagoComSaldo: true,
              saldoAnterior: saldoRestante,
              valorDescontado: 150,
            };
            await transacao.save();

            // Atualizar participante na rodada
            const rodadaAtualizada = await Rodada.findById(
              rodadaParaEntrar._id,
            );
            const participante = rodadaAtualizada.participantes.find(
              (p) => p.usuario.toString() === usuarioId,
            );
            if (participante) {
              participante.depositoConfirmado = true;
              participante.dataDeposito = new Date();
              participante.comprovantePix = "PAGO_COM_SALDO";
              participante.transacaoId = transacao._id;
            }

            // Contar vermelhos pagos e atualizar total
            const vermelhos = rodadaAtualizada.participantes.filter(
              (p) => p.cor === "vermelho",
            );
            const vermelhosPagos = vermelhos.filter(
              (v) => v.depositoConfirmado === true,
            );
            rodadaAtualizada.totalDepositosConfirmados = vermelhosPagos.length;

            await rodadaAtualizada.save();

            // Descontar do saldo do usuário
            const novoSaldo = saldoRestante - 150;
            await User.findByIdAndUpdate(usuarioId, {
              $set: { saldoPremio: novoSaldo },
            });

            pagoAutomaticamente = true;
            saldoRestante = novoSaldo;

            console.log(
              `✅ Pagamento automático realizado! Saldo restante: R$ ${saldoRestante}`,
            );

            // Verificar se a rodada completou todos os pagamentos (15 participantes)
            // Só avança se a rodada estiver completa
            if (
              rodadaAtualizada.participantes.length === 15 &&
              vermelhosPagos.length === vermelhos.length
            ) {
              await this.verificarEAvancarSeNecessario(rodadaParaEntrar._id);
            }
          }
        }

        // Retorno para quando entra em rodada
        const message = pagoAutomaticamente
          ? `✅ Você foi adicionado como VERMELHO na ${rodadaParaEntrar.nome}! Seu pagamento de R$ 150 foi descontado do seu saldo. Saldo restante: R$ ${saldoRestante}.`
          : `✅ Você foi adicionado como VERMELHO na ${rodadaParaEntrar.nome}! Gere o QR Code para pagar R$ 150.`;

        return {
          success: true,
          message,
          cor: "vermelho",
          rodadaId: rodadaParaEntrar._id,
          rodadaNome: rodadaParaEntrar.nome,
          aguardando: false,
          pagoAutomaticamente,
          saldoRestante,
        };
      }

      // ===========================================
      // CASO 2: NÃO ENCONTROU RODADA COM VAGA
      // ===========================================
      console.log(
        `❌ Nenhuma rodada com vaga encontrada. Colocando na FILA DE ESPERA...`,
      );

      // Verificar se o usuário JÁ está na fila
      if (usuario.aguardandoVermelho) {
        console.log(
          `⚠️ Usuário já está na fila. Posição atual: ${usuario.posicaoFila}`,
        );

        // Contar total na fila
        const totalNaFila = await User.countDocuments({
          aguardandoVermelho: true,
        });

        return {
          success: true,
          message: `⏳ Você já está na fila de espera! Posição: ${usuario.posicaoFila} de ${totalNaFila}. Aguarde uma vaga para VERMELHO.`,
          cor: "amarelo",
          aguardando: true,
          posicao: usuario.posicaoFila,
          totalNaFila,
          pagoAutomaticamente: false,
          saldoRestante,
        };
      }

      // Buscar a MAIOR posição atual na fila
      const ultimoNaFila = await User.findOne({
        aguardandoVermelho: true,
      }).sort({ posicaoFila: -1 });

      const novaPosicao = ultimoNaFila ? ultimoNaFila.posicaoFila + 1 : 1;

      // Contar total na fila
      const totalNaFila = await User.countDocuments({
        aguardandoVermelho: true,
      });

      // Adicionar à fila de espera
      usuario.aguardandoVermelho = true;
      usuario.posicaoFila = novaPosicao;
      usuario.dataEntradaFila = new Date();
      await usuario.save();

      console.log(`✅ Usuário adicionado à fila! Posição: ${novaPosicao}`);

      // Retorno para quando vai para fila
      return {
        success: true,
        message: `⏳ Nenhuma rodada disponível no momento. Você foi colocado na FILA DE ESPERA na posição ${novaPosicao} de ${totalNaFila + 1}. Quando uma nova rodada abrir, você será automaticamente alocado como VERMELHO.${
          temSaldo
            ? ` Seu saldo de R$ ${saldoRestante} será usado automaticamente para pagar o investimento quando for alocado.`
            : ""
        }`,
        cor: "amarelo",
        aguardando: true,
        posicao: novaPosicao,
        totalNaFila: totalNaFila + 1,
        pagoAutomaticamente: false,
        saldoRestante,
      };
    } catch (error) {
      console.error("Erro ao jogar novamente:", error);
      throw error;
    }
  }
}

module.exports = new RodadaService();
