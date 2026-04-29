const express = require("express");
const router = express.Router();
const Transacao = require("../models/Transacao");
const Rodada = require("../models/Rodada");
const User = require("../models/User");
const abacate = require("../config/abacate");
const RodadaService = require("../services/rodadaService");
const pixController = require("../controllers/pixController");

// Chaves secretas do ambiente
const WEBHOOK_SECRET_QUERY = process.env.WEBHOOK_SECRET_QUERY;

// Cache para controle de webhooks processados
const webhooksProcessados = new Map();

// Função para extrair externalId de diferentes formatos
function extrairExternalId(event) {
  if (event.data?.pixQrCode?.metadata?.externalId) {
    return event.data.pixQrCode.metadata.externalId;
  }
  if (event.data?.externalId) {
    return event.data.externalId;
  }
  if (event.data?.metadata?.externalId) {
    return event.data.metadata.externalId;
  }
  if (event.data?.checkout?.metadata?.externalId) {
    return event.data.checkout.metadata.externalId;
  }
  if (event.data?.transparent?.metadata?.externalId) {
    return event.data.transparent.metadata.externalId;
  }
  return null;
}

// Webhook com controle de duplicidade
router.post("/pix", async (req, res) => {
  try {
    // VALIDAÇÃO DO SECRET NA URL
    const querySecret = req.query.webhookSecret;
    if (WEBHOOK_SECRET_QUERY && querySecret !== WEBHOOK_SECRET_QUERY) {
      console.error("❌ Webhook rejeitado: secret da URL inválido");
      return res.status(401).send("Unauthorized");
    }

    // Criar ID único para este webhook
    const webhookId = req.body.id || `${Date.now()}_${Math.random()}`;

    // Verificar se este webhook já foi processado
    if (webhooksProcessados.has(`webhook_${webhookId}`)) {
      console.log(`⚠️ Webhook ${webhookId} já foi processado. Ignorando.`);
      return res.status(200).send("Webhook já processado");
    }

    // Marcar webhook como processado
    webhooksProcessados.set(`webhook_${webhookId}`, Date.now());

    // Limpar webhooks antigos após 5 minutos
    setTimeout(
      () => {
        webhooksProcessados.delete(`webhook_${webhookId}`);
      },
      5 * 60 * 1000,
    );

    console.log("📡 Webhook recebido:", JSON.stringify(req.body, null, 2));

    const event = req.body;
    if (!event || !event.event) {
      return res.status(400).send("Evento inválido");
    }

    // Extrair externalId
    const externalId = extrairExternalId(event);

    if (!externalId) {
      console.log(`⏩ Evento ${event.event} sem externalId - ignorado`);
      return res.status(200).send("Evento ignorado");
    }

    console.log(
      `🔍 ExternalId extraído: ${externalId} do evento ${event.event}`,
    );

    // Processar apenas eventos de pagamento confirmado
    const eventosPagamento = [
      "billing.paid",
      "qr_code.paid",
      "checkout.completed",
      "transparent.completed",
    ];

    if (eventosPagamento.includes(event.event)) {
      const result = await pixController.processarPagamentoComControle(
        externalId,
        "webhook",
      );
      console.log(`📊 Resultado processamento: ${result.message}`);
      res.send("OK");
    } else {
      console.log(`⏩ Evento ignorado: ${event.event}`);
      res.status(200).send("Evento ignorado");
    }
  } catch (error) {
    console.error("❌ Erro no webhook PIX:", error);
    res.status(500).send("Erro interno");
  }
});

module.exports = router;
