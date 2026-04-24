const express = require('express');
const router = express.Router();
const Transacao = require('../models/Transacao');
const Rodada = require('../models/Rodada');
const User = require('../models/User');
const abacate = require('../config/abacate');
const RodadaService = require('../services/rodadaService');

// Constantes
const TAXA_PLATAFORMA = 0.10;
const VALOR_BRUTO_VERDE = 1000;
const VALOR_LIQUIDO_VERDE = VALOR_BRUTO_VERDE * (1 - TAXA_PLATAFORMA);

// Chaves secretas do ambiente
const WEBHOOK_SECRET_QUERY = process.env.WEBHOOK_SECRET_QUERY;

// Cache para controle de webhooks processados
const webhooksProcessados = new Map();

// Cache para controle de pagamentos processados (evita duplicidade)
const pagamentosProcessados = new Map();

/**
 * Função auxiliar para processar pagamento com controle de duplicidade
 */
async function processarPagamentoComControle(transacaoId, source = 'webhook') {
    // Verificar se este pagamento já foi processado recentemente
    if (pagamentosProcessados.has(transacaoId)) {
        const processadoEm = pagamentosProcessados.get(transacaoId);
        const segundosDesdeProcessamento = (Date.now() - processadoEm) / 1000;

        console.log(`⚠️ [${source}] Pagamento ${transacaoId} já foi processado há ${segundosDesdeProcessamento.toFixed(1)}s. Ignorando.`);
        return { success: false, message: 'Pagamento já processado', jaProcessado: true };
    }

    // Marcar como processando (evita concorrência)
    pagamentosProcessados.set(transacaoId, Date.now());

    try {
        const transacao = await Transacao.findById(transacaoId);

        if (!transacao) {
            console.error(`❌ [${source}] Transação não encontrada: ${transacaoId}`);
            pagamentosProcessados.delete(transacaoId);
            return { success: false, message: 'Transação não encontrada' };
        }

        // VERIFICAÇÃO CRÍTICA: Se já está confirmada, não processa novamente
        if (transacao.status === 'confirmado') {
            console.log(`⚠️ [${source}] Transação ${transacaoId} já estava confirmada. Ignorando.`);
            pagamentosProcessados.delete(transacaoId);
            return { success: true, message: 'Transação já confirmada', jaProcessado: true };
        }

        console.log(`💰 [${source}] Processando pagamento para transação: ${transacaoId}`);

        // Atualizar transação
        transacao.status = 'confirmado';
        transacao.dataConfirmacao = new Date();
        await transacao.save();

        // Buscar rodada
        const rodada = await Rodada.findById(transacao.rodada);
        if (!rodada) {
            console.error(`❌ [${source}] Rodada não encontrada: ${transacao.rodada}`);
            pagamentosProcessados.delete(transacaoId);
            return { success: false, message: 'Rodada não encontrada' };
        }

        // Encontrar participante
        const participante = rodada.participantes.find(
            p => p.usuario.toString() === transacao.pagador.toString()
        );

        if (!participante) {
            console.error(`❌ [${source}] Participante não encontrado na rodada`);
            pagamentosProcessados.delete(transacaoId);
            return { success: false, message: 'Participante não encontrado' };
        }

        // VERIFICAÇÃO CRÍTICA: Se participante já está pago, não processa novamente
        if (participante.depositoConfirmado === true) {
            console.log(`⚠️ [${source}] Participante ${participante.usuario} já estava marcado como pago. Ignorando.`);
            pagamentosProcessados.delete(transacaoId);
            return { success: true, message: 'Participante já pago', jaProcessado: true };
        }

        // Marcar participante como pago
        participante.depositoConfirmado = true;
        participante.dataDeposito = new Date();

        // Contar vermelhos pagos CORRETAMENTE
        const vermelhos = rodada.participantes.filter(p => p.cor === 'vermelho');
        const vermelhosPagos = vermelhos.filter(v => v.depositoConfirmado === true);

        // Atualizar total de depósitos confirmados
        rodada.totalDepositosConfirmados = vermelhosPagos.length;

        await rodada.save();

        console.log(`✅ [${source}] Participante ${participante.usuario} marcado como pago`);
        console.log(`📊 [${source}] Progresso: ${vermelhosPagos.length}/${vermelhos.length}`);

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
                console.log(`✅ [${source}] Rodada ${rodada.nome} avançada com sucesso!`);
            } catch (err) {
                console.error(`❌ [${source}] Erro ao avançar rodada:`, err);
            }
        }

        // Limpar do cache após 10 minutos (tempo suficiente para evitar duplicatas)
        setTimeout(() => {
            pagamentosProcessados.delete(transacaoId);
            console.log(`🧹 [${source}] Cache do pagamento ${transacaoId} removido após 10 minutos`);
        }, 10 * 60 * 1000);

        return { success: true, message: 'Pagamento processado', progresso: `${vermelhosPagos.length}/${vermelhos.length}` };

    } catch (error) {
        console.error(`❌ [${source}] Erro ao processar pagamento ${transacaoId}:`, error);
        // Remover do cache em caso de erro para permitir tentativa futura
        pagamentosProcessados.delete(transacaoId);
        throw error;
    }
}

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
router.post('/pix', async (req, res) => {
    try {
        // VALIDAÇÃO DO SECRET NA URL
        const querySecret = req.query.webhookSecret;
        if (WEBHOOK_SECRET_QUERY && querySecret !== WEBHOOK_SECRET_QUERY) {
            console.error('❌ Webhook rejeitado: secret da URL inválido');
            return res.status(401).send('Unauthorized');
        }

        // Criar ID único para este webhook
        const webhookId = req.body.id || `${Date.now()}_${Math.random()}`;

        // Verificar se este webhook já foi processado
        if (webhooksProcessados.has(`webhook_${webhookId}`)) {
            console.log(`⚠️ Webhook ${webhookId} já foi processado. Ignorando.`);
            return res.status(200).send('Webhook já processado');
        }

        // Marcar webhook como processado
        webhooksProcessados.set(`webhook_${webhookId}`, Date.now());

        // Limpar webhooks antigos após 5 minutos
        setTimeout(() => {
            webhooksProcessados.delete(`webhook_${webhookId}`);
        }, 5 * 60 * 1000);

        console.log('📡 Webhook recebido:', JSON.stringify(req.body, null, 2));

        const event = req.body;
        if (!event || !event.event) {
            return res.status(400).send('Evento inválido');
        }

        // Extrair externalId
        const externalId = extrairExternalId(event);

        if (!externalId) {
            console.log(`⏩ Evento ${event.event} sem externalId - ignorado`);
            return res.status(200).send('Evento ignorado');
        }

        console.log(`🔍 ExternalId extraído: ${externalId} do evento ${event.event}`);

        // Processar apenas eventos de pagamento confirmado
        const eventosPagamento = ['billing.paid', 'qr_code.paid', 'checkout.completed', 'transparent.completed'];

        if (eventosPagamento.includes(event.event)) {
            // USAR A FUNÇÃO COM CONTROLE DE DUPLICIDADE
            const result = await processarPagamentoComControle(externalId, 'webhook');
            console.log(`📊 Resultado processamento: ${result.message}`);
            res.send('OK');
        } else {
            console.log(`⏩ Evento ignorado: ${event.event}`);
            res.status(200).send('Evento ignorado');
        }
    } catch (error) {
        console.error('❌ Erro no webhook PIX:', error);
        res.status(500).send('Erro interno');
    }
});

module.exports = router;