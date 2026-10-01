// ===========================================
// config/constantes.js — Valores financeiros do jogo
// Fonte única de verdade. Alterar aqui (ou no .env) reflete em todo o sistema.
// ===========================================
require('dotenv').config()

// Valor que cada jogador VERMELHO paga (em reais)
const VALOR_VERMELHO = parseFloat(process.env.VALOR_VERMELHO) || 20

// Prêmio que o jogador VERDE recebe (em reais)
const PREMIO_VERDE = parseFloat(process.env.PREMIO_VERDE) || 100

// Quantidade fixa de vermelhos por rodada
const TOTAL_VERMELHOS = 8

// Taxa fixa cobrada no PIX de saque (AbacatePay)
const TAXA_PIX = parseFloat(process.env.ABACATE_PIX_FEE) || 0.8

// Valor mínimo para saque (não permite sacar menos que o prêmio)
const VALOR_MINIMO_SAQUE = PREMIO_VERDE

// Cálculos derivados (calculados uma vez, aqui)
const TOTAL_ARRECADADO = VALOR_VERMELHO * TOTAL_VERMELHOS
const MARGEM_PLATAFORMA = TOTAL_ARRECADADO - PREMIO_VERDE

module.exports = {
  // Valores principais
  VALOR_VERMELHO,
  PREMIO_VERDE,

  // Constantes de estrutura
  TOTAL_VERMELHOS,

  // Valores calculados (para relatórios/logs)
  TOTAL_ARRECADADO,
  MARGEM_PLATAFORMA,

  // Saque
  TAXA_PIX,
  VALOR_MINIMO_SAQUE,

  // Utilitário
  MOEDA: 'BRL'
}
