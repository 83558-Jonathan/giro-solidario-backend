const abacate = require("../config/abacate");
const Transacao = require("../models/Transacao");
const Rodada = require("../models/Rodada");
const RodadaService = require("../services/rodadaService");

// ===========================================
// NOVOS VALORES (SEM TAXA SEPARADA)
// ===========================================
const VALOR_VERMELHO = 150; // R$ 150,00 direto

// Cache para controle de pagamentos processados (evita duplicidade)
const pagamentosProcessados = new Map();

/**
 * Função auxiliar para processar pagamento com controle de duplicidade
 */
async function processarPagamentoComControle(transacaoId, source = "webhook") {
  // Verificar se este pagamento já foi processado recentemente
  if (pagamentosProcessados.has(transacaoId)) {
    const processadoEm = pagamentosProcessados.get(transacaoId);
    const segundosDesdeProcessamento = (Date.now() - processadoEm) / 1000;

    console.log(
      `⚠️ [${source}] Pagamento ${transacaoId} já foi processado há ${segundosDesdeProcessamento.toFixed(1)}s. Ignorando.`,
    );
    return {
      success: false,
      message: "Pagamento já processado",
      jaProcessado: true,
    };
  }

  // Marcar como processando (evita concorrência)
  pagamentosProcessados.set(transacaoId, Date.now());

  try {
    // Buscar transação
    const transacao = await Transacao.findById(transacaoId);

    if (!transacao) {
      console.error(`❌ [${source}] Transação não encontrada: ${transacaoId}`);
      pagamentosProcessados.delete(transacaoId);
      return { success: false, message: "Transação não encontrada" };
    }

    // VERIFICAÇÃO CRÍTICA: Se já está confirmada, não processa novamente
    if (transacao.status === "confirmado") {
      console.log(
        `⚠️ [${source}] Transação ${transacaoId} já estava confirmada. Ignorando.`,
      );
      pagamentosProcessados.delete(transacaoId);
      return {
        success: true,
        message: "Transação já confirmada",
        jaProcessado: true,
      };
    }

    console.log(
      `💰 [${source}] Processando pagamento para transação: ${transacaoId}`,
    );

    // Atualizar transação
    transacao.status = "confirmado";
    transacao.dataConfirmacao = new Date();
    await transacao.save();

    // Buscar rodada
    const rodada = await Rodada.findById(transacao.rodada);
    if (!rodada) {
      console.error(
        `❌ [${source}] Rodada não encontrada: ${transacao.rodada}`,
      );
      pagamentosProcessados.delete(transacaoId);
      return { success: false, message: "Rodada não encontrada" };
    }

    // Encontrar participante
    const participante = rodada.participantes.find(
      (p) => p.usuario.toString() === transacao.pagador.toString(),
    );

    if (!participante) {
      console.error(`❌ [${source}] Participante não encontrado na rodada`);
      pagamentosProcessados.delete(transacaoId);
      return { success: false, message: "Participante não encontrado" };
    }

    // VERIFICAÇÃO CRÍTICA: Se participante já está pago, não processa novamente
    if (participante.depositoConfirmado === true) {
      console.log(
        `⚠️ [${source}] Participante ${participante.usuario} já estava marcado como pago. Ignorando.`,
      );
      pagamentosProcessados.delete(transacaoId);
      return {
        success: true,
        message: "Participante já pago",
        jaProcessado: true,
      };
    }

    // Marcar participante como pago
    participante.depositoConfirmado = true;
    participante.dataDeposito = new Date();

    // Contar vermelhos pagos CORRETAMENTE
    const vermelhos = rodada.participantes.filter((p) => p.cor === "vermelho");
    const vermelhosPagos = vermelhos.filter(
      (v) => v.depositoConfirmado === true,
    );

    // Atualizar total de depósitos confirmados
    rodada.totalDepositosConfirmados = vermelhosPagos.length;

    await rodada.save();

    console.log(
      `✅ [${source}] Participante ${participante.usuario} marcado como pago`,
    );
    console.log(
      `📊 [${source}] Progresso: ${vermelhosPagos.length}/${vermelhos.length}`,
    );

    // Verificar se todos pagaram (8 vermelhos)
    if (vermelhosPagos.length === vermelhos.length && vermelhos.length === 8) {
      console.log(`🎉 [${source}] TODOS OS 8 VERMELHOS PAGARAM!`);

      // Atualizar flag da rodada
      if (!rodada.todosDepositaram) {
        rodada.todosDepositaram = true;
        rodada.dataTodosDepositaram = new Date();
        await rodada.save();
        console.log(`✅ [${source}] Rodada marcada como "todos depositaram"`);
      }

      // Chamar o serviço de avanço da rodada
      try {
        await RodadaService.avancarRodada(rodada._id);
        console.log(
          `✅ [${source}] Rodada ${rodada.nome} avançada com sucesso!`,
        );
      } catch (err) {
        console.error(`❌ [${source}] Erro ao avançar rodada:`, err);
      }
    }

    // Limpar do cache após 10 minutos (tempo suficiente para evitar duplicatas)
    setTimeout(
      () => {
        pagamentosProcessados.delete(transacaoId);
        console.log(
          `🧹 [${source}] Cache do pagamento ${transacaoId} removido após 10 minutos`,
        );
      },
      10 * 60 * 1000,
    );

    return {
      success: true,
      message: "Pagamento processado",
      progresso: `${vermelhosPagos.length}/${vermelhos.length}`,
    };
  } catch (error) {
    console.error(
      `❌ [${source}] Erro ao processar pagamento ${transacaoId}:`,
      error,
    );
    // Remover do cache em caso de erro para permitir tentativa futura
    pagamentosProcessados.delete(transacaoId);
    throw error;
  }
}

/**
 * Cria um QR Code PIX para o vermelho pagar (API v1)
 * Endpoint: POST /v1/pixQrCode/create
 */
exports.criarCobrancaPix = async (req, res) => {
  try {
    const { transacaoId } = req.body;

    if (!transacaoId) {
      return res.status(400).json({
        success: false,
        error: "transacaoId é obrigatório",
      });
    }

    // Buscar transação com dados completos
    const transacao = await Transacao.findById(transacaoId)
      .populate("pagador", "nome email")
      .populate("rodada", "nome");

    if (!transacao) {
      return res.status(404).json({
        success: false,
        error: "Transação não encontrada",
      });
    }

    // VERIFICAR SE JÁ FOI PAGA
    if (transacao.status === "confirmado") {
      return res.status(400).json({
        success: false,
        error: "Esta transação já foi paga",
      });
    }

    // ===========================================
    // VALOR CORRETO: R$ 150,00 (SEM TAXA SEPARADA)
    // ===========================================
    const valorCorreto = VALOR_VERMELHO; // 150.00
    const valorCentavos = Math.round(valorCorreto * 100); // 15000

    const payload = {
      amount: valorCentavos,
      description: `Giro Premiado - ${transacao.pagador.nome}`,
      expiresIn: 3600,
      metadata: {
        externalId: transacao._id.toString(),
      },
    };

    console.log("📤 Enviando payload:", JSON.stringify(payload, null, 2));

    // Criar QR Code PIX na AbacatePay
    const response = await abacate.post("/pixQrCode/create", payload);

    console.log(
      "📥 Resposta da AbacatePay:",
      JSON.stringify(response.data, null, 2),
    );

    const {
      id: cobrancaId,
      brCode,
      brCodeBase64,
      expiresAt,
    } = response.data.data;

    // Salvar referência da cobrança com valor correto
    transacao.cobrancaId = cobrancaId;
    transacao.valorPago = valorCorreto; // 150.00
    transacao.metadata = {
      ...(transacao.metadata || {}),
      cobrancaCriadaEm: new Date().toISOString(),
      expiraEm: expiresAt,
      tipo: "pix_qrcode_v1",
      renovacoes: 0,
      valorOriginal: valorCorreto,
    };
    await transacao.save();

    console.log(
      `💰 PIX gerado para transação ${transacaoId}: R$ ${valorCorreto}`,
    );

    // ===========================================
    // 🔥 ENVIAR QR CODE POR E-MAIL PARA O VERMELHO
    // ===========================================
    try {
      const emailController = require("./emailController");
      const User = require("../models/User");

      const usuario = await User.findById(transacao.pagador);
      if (usuario && usuario.email) {
        // Verificar se a função existe no emailController
        if (typeof emailController.enviarEmailQrCodePix === "function") {
          await emailController.enviarEmailQrCodePix(
            usuario,
            transacao,
            brCode,
            brCodeBase64,
            valorCorreto,
            transacao.rodada,
          );
          console.log(`📧 Email com QR Code enviado para ${usuario.email}`);
        } else {
          console.log(
            "⚠️ Função enviarEmailQrCodePix não encontrada no emailController",
          );
        }
      }
    } catch (emailError) {
      console.error("❌ Erro ao enviar email com QR Code:", emailError.message);
      // Não interrompe o fluxo principal
    }

    res.json({
      success: true,
      qrCode: brCode,
      qrCodeImage: brCodeBase64,
      valor: valorCorreto,
      expiraEm: expiresAt,
      transacaoId: transacao._id,
      cobrancaId,
      renovacoes: 0,
    });
  } catch (error) {
    console.error("❌ Erro ao criar QR Code PIX:", error);

    if (error.response) {
      console.error("❌ Resposta de erro:", {
        status: error.response.status,
        data: error.response.data,
      });
    }

    res.status(500).json({
      success: false,
      error:
        error.response?.data?.error || "Erro ao gerar PIX. Tente novamente.",
    });
  }
};

/**
 * Verifica o status de um QR Code PIX (API v1)
 * E ATUALIZA A TRANSAÇÃO E A RODADA SE ESTIVER PAGA
 */
exports.verificarStatus = async (req, res) => {
  try {
    const { transacaoId } = req.params;

    const transacao = await Transacao.findById(transacaoId);
    if (!transacao) {
      return res.status(404).json({
        success: false,
        error: "Transação não encontrada",
      });
    }

    // Se já está confirmada, retorna direto
    if (transacao.status === "confirmado") {
      return res.json({
        success: true,
        status: transacao.status,
        confirmadoEm: transacao.dataConfirmacao,
        cobrancaId: transacao.cobrancaId,
      });
    }

    // Consultar AbacatePay se tiver cobrancaId
    if (transacao.cobrancaId) {
      try {
        const response = await abacate.get(`/pixQrCode/check`, {
          params: { id: transacao.cobrancaId },
        });

        console.log("📥 Status do QR Code:", response.data);

        const statusApi =
          response.data.data?.status?.toUpperCase?.() ||
          response.data.data?.status;

        // Se pagamento foi confirmado na API
        if (
          statusApi === "PAID" ||
          statusApi === "COMPLETED" ||
          statusApi === "CONFIRMED"
        ) {
          console.log(`💰 Pagamento detectado para transação ${transacaoId}`);

          // USAR A FUNÇÃO COM CONTROLE DE DUPLICIDADE
          const result = await processarPagamentoComControle(
            transacaoId,
            "verificarStatus",
          );

          if (result.jaProcessado) {
            console.log(
              `⚠️ Pagamento ${transacaoId} já foi processado anteriormente`,
            );
          }
        }
      } catch (apiError) {
        console.error("❌ Erro ao consultar status:", apiError.message);
        if (apiError.response?.status === 404) {
          console.log("⏰ QR Code não encontrado (possivelmente expirado)");
        }
      }
    }

    // Buscar transação atualizada após possível processamento
    const transacaoAtualizada = await Transacao.findById(transacaoId);

    res.json({
      success: true,
      status: transacaoAtualizada.status,
      confirmadoEm: transacaoAtualizada.dataConfirmacao,
      cobrancaId: transacaoAtualizada.cobrancaId,
    });
  } catch (error) {
    console.error("❌ Erro ao verificar status:", error);
    res.status(500).json({
      success: false,
      error: "Erro ao verificar status",
    });
  }
};

/**
 * Renova um QR Code PIX expirado para a mesma transação
 */
exports.renovarCobrancaPix = async (req, res) => {
  try {
    const { transacaoId } = req.body;

    if (!transacaoId) {
      return res.status(400).json({
        success: false,
        error: "transacaoId é obrigatório",
      });
    }

    // Buscar transação
    const transacao = await Transacao.findById(transacaoId).populate(
      "pagador",
      "nome email",
    );

    if (!transacao) {
      return res.status(404).json({
        success: false,
        error: "Transação não encontrada",
      });
    }

    // Verificar se já foi paga
    if (transacao.status === "confirmado") {
      return res.status(400).json({
        success: false,
        error: "Esta transação já foi paga",
      });
    }

    // ===========================================
    // VALOR CORRETO: R$ 150,00 (MESMO NA RENOVAÇÃO)
    // ===========================================
    const valorCorreto = VALOR_VERMELHO; // 150.00
    const valorCentavos = Math.round(valorCorreto * 100); // 15000

    console.log("💰 Renovação - valor correto:", valorCorreto);
    console.log("💰 Renovação - valorCentavos:", valorCentavos);

    // Criar NOVO QR Code na AbacatePay
    const payload = {
      amount: valorCentavos,
      description: `Giro Premiado - ${transacao.pagador.nome}`,
      expiresIn: 3600,
      metadata: {
        externalId: transacao._id.toString(),
      },
    };

    console.log("📤 Renovando PIX para transação:", transacaoId);
    console.log("📤 Payload renovação:", JSON.stringify(payload, null, 2));

    const response = await abacate.post("/pixQrCode/create", payload);
    const {
      id: novaCobrancaId,
      brCode,
      brCodeBase64,
      expiresAt,
    } = response.data.data;

    // Calcular renovacoes
    const renovacoes = (transacao.metadata?.renovacoes || 0) + 1;

    // Atualizar transação com nova cobrança e GARANTIR valor correto
    transacao.valorPago = valorCorreto;
    transacao.cobrancaId = novaCobrancaId;
    transacao.metadata = {
      ...(transacao.metadata || {}),
      cobrancaRenovadaEm: new Date().toISOString(),
      expiraEm: expiresAt,
      renovacoes,
      valorCorreto: valorCorreto,
      historicoRenovacoes: [
        ...(transacao.metadata?.historicoRenovacoes || []),
        {
          data: new Date().toISOString(),
          cobrancaId: novaCobrancaId,
          expiraEm: expiresAt,
          valor: valorCorreto,
        },
      ],
    };

    await transacao.save();

    console.log(
      `💰 PIX renovado para transação ${transacaoId} (renovação #${renovacoes}) - R$ ${valorCorreto}`,
    );

    res.json({
      success: true,
      qrCode: brCode,
      qrCodeImage: brCodeBase64,
      valor: valorCorreto,
      expiraEm: expiresAt,
      transacaoId: transacao._id,
      cobrancaId: novaCobrancaId,
      renovacoes,
    });
  } catch (error) {
    console.error("❌ Erro ao renovar PIX:", error);

    if (error.response) {
      console.error("❌ Resposta de erro da AbacatePay:", {
        status: error.response.status,
        data: error.response.data,
      });
    }

    res.status(500).json({
      success: false,
      error:
        error.response?.data?.error || "Erro ao renovar PIX. Tente novamente.",
    });
  }
};

// ===========================================
// EXPORTAR A FUNÇÃO PARA USO NO WEBHOOK
// ===========================================
module.exports = {
  criarCobrancaPix: exports.criarCobrancaPix,
  verificarStatus: exports.verificarStatus,
  renovarCobrancaPix: exports.renovarCobrancaPix,
  processarPagamentoComControle,
};
