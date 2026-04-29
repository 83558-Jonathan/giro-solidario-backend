const Transacao = require("../models/Transacao");
const Rodada = require("../models/Rodada");
const mongoose = require("mongoose");

// Listar minhas transações
exports.minhasTransacoes = async (req, res) => {
  try {
    const userId = req.usuarioId;

    const transacoes = await Transacao.find({
      $or: [{ pagador: userId }, { recebedor: userId }],
    })
      .populate("pagador", "nome")
      .populate("recebedor", "nome")
      .populate("rodada", "nome numero")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: transacoes.length,
      data: transacoes,
    });
  } catch (error) {
    console.error("❌ Erro ao buscar transações:", error);
    res.status(500).json({
      success: false,
      error:
        process.env.NODE_ENV === "development"
          ? error.message
          : "Erro ao buscar transações",
    });
  }
};

// Listar transações de uma rodada
exports.porRodada = async (req, res) => {
  try {
    const { rodadaId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(rodadaId)) {
      return res.status(400).json({
        success: false,
        error: "ID da rodada inválido",
      });
    }

    const transacoes = await Transacao.find({ rodada: rodadaId })
      .populate("pagador", "nome")
      .populate("recebedor", "nome");

    res.json({
      success: true,
      count: transacoes.length,
      data: transacoes,
    });
  } catch (error) {
    console.error("❌ Erro ao listar transações da rodada:", error);
    res.status(500).json({
      success: false,
      error:
        process.env.NODE_ENV === "development"
          ? error.message
          : "Erro ao listar transações",
    });
  }
};

// Confirmar depósito
exports.confirmarDeposito = async (req, res) => {
  try {
    const { transacaoId } = req.params;
    const { comprovante } = req.body;

    if (!comprovante) {
      return res.status(400).json({
        success: false,
        error: "Comprovante é obrigatório",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(transacaoId)) {
      return res.status(400).json({
        success: false,
        error: "ID da transação inválido",
      });
    }

    // Buscar transação
    const transacao = await Transacao.findById(transacaoId);

    if (!transacao) {
      return res.status(404).json({
        success: false,
        error: "Transação não encontrada",
      });
    }

    if (transacao.status !== "pendente") {
      return res.status(400).json({
        success: false,
        error: `Transação já foi ${transacao.status}`,
      });
    }

    // Atualizar transação
    transacao.status = "confirmado";
    transacao.comprovante = comprovante;
    transacao.dataConfirmacao = new Date();
    transacao.confirmadoPor = req.usuarioId;

    await transacao.save();

    // Buscar rodada e atualizar participante
    const rodada = await Rodada.findById(transacao.rodada);

    if (rodada) {
      const participante = rodada.participantes.find(
        (p) => p.usuario.toString() === transacao.pagador.toString(),
      );

      if (participante) {
        // VERIFICAR SE JÁ ESTÁ PAGO
        if (participante.depositoConfirmado === true) {
          console.log(
            `⚠️ Participante ${participante.usuario} já estava marcado como pago.`,
          );
          return res.json({
            success: true,
            data: transacao,
            message: "Depósito já estava confirmado anteriormente.",
          });
        }

        participante.depositoConfirmado = true;
        participante.dataDeposito = new Date();
        participante.comprovantePix = comprovante;

        // Contar vermelhos pagos
        const vermelhos = rodada.participantes.filter(
          (p) => p.cor === "vermelho",
        );
        const vermelhosPagos = vermelhos.filter(
          (v) => v.depositoConfirmado === true,
        );
        rodada.totalDepositosConfirmados = vermelhosPagos.length;

        await rodada.save();

        console.log(
          `✅ Pagamento confirmado: ${participante.usuario} - ${rodada.totalDepositosConfirmados}/8`,
        );

        // VERIFICAR SE TODOS PAGARAM (8 vermelhos)
        if (
          vermelhosPagos.length === vermelhos.length &&
          vermelhos.length === 8
        ) {
          console.log(`🎉 [confirmarDeposito] TODOS OS 8 VERMELHOS PAGARAM!`);

          // Marcar que todos depositaram
          if (!rodada.todosDepositaram) {
            rodada.todosDepositaram = true;
            rodada.dataTodosDepositaram = new Date();
            await rodada.save();
          }

          // Chamar avanço da rodada
          try {
            const RodadaService = require("../services/rodadaService");
            await RodadaService.avancarRodada(rodada._id);
            console.log(`✅ Rodada ${rodada.nome} avançada com sucesso!`);
          } catch (err) {
            console.error("❌ Erro ao avançar rodada:", err);
          }
        }
      }
    }

    const transacaoAtualizada = await Transacao.findById(transacaoId)
      .populate("pagador", "nome")
      .populate("recebedor", "nome");

    res.json({
      success: true,
      data: transacaoAtualizada,
      message: "Depósito confirmado com sucesso!",
    });
  } catch (error) {
    console.error("❌ Erro ao confirmar depósito:", error);
    res.status(500).json({
      success: false,
      error:
        process.env.NODE_ENV === "development"
          ? error.message
          : "Erro ao confirmar depósito",
    });
  }
};

// Cancelar transação
exports.cancelarTransacao = async (req, res) => {
  try {
    const { transacaoId } = req.params;
    const { motivo } = req.body;

    if (!mongoose.Types.ObjectId.isValid(transacaoId)) {
      return res.status(400).json({
        success: false,
        error: "ID da transação inválido",
      });
    }

    const transacao = await Transacao.findById(transacaoId);

    if (!transacao) {
      return res.status(404).json({
        success: false,
        error: "Transação não encontrada",
      });
    }

    if (transacao.status !== "pendente") {
      return res.status(400).json({
        success: false,
        error: `Não é possível cancelar transação ${transacao.status}`,
      });
    }

    transacao.status = "cancelado";
    transacao.motivoCancelamento = motivo || "Cancelado pelo usuário";
    transacao.dataCancelamento = new Date();

    await transacao.save();

    res.json({
      success: true,
      message: "Transação cancelada com sucesso",
    });
  } catch (error) {
    console.error("❌ Erro ao cancelar transação:", error);
    res.status(500).json({
      success: false,
      error:
        process.env.NODE_ENV === "development"
          ? error.message
          : "Erro ao cancelar transação",
    });
  }
};

// Buscar estatísticas de transações
exports.estatisticas = async (req, res) => {
  try {
    const userId = req.usuarioId;

    const [
      totalPendente,
      totalConfirmado,
      totalComoPagador,
      totalComoRecebedor,
    ] = await Promise.all([
      Transacao.countDocuments({
        $or: [{ pagador: userId }, { recebedor: userId }],
        status: "pendente",
      }),
      Transacao.countDocuments({
        $or: [{ pagador: userId }, { recebedor: userId }],
        status: "confirmado",
      }),
      Transacao.countDocuments({
        pagador: userId,
        status: "confirmado",
      }),
      Transacao.countDocuments({
        recebedor: userId,
        status: "confirmado",
      }),
    ]);

    res.json({
      success: true,
      data: {
        pendente: totalPendente,
        confirmado: totalConfirmado,
        comoPagador: totalComoPagador,
        comoRecebedor: totalComoRecebedor,
        total: totalPendente + totalConfirmado,
      },
    });
  } catch (error) {
    console.error("❌ Erro ao buscar estatísticas:", error);
    res.status(500).json({
      success: false,
      error:
        process.env.NODE_ENV === "development"
          ? error.message
          : "Erro ao buscar estatísticas",
    });
  }
};
