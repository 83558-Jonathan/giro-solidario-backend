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

// Cálculos derivados
const TOTAL_ARRECADADO = VALOR_VERMELHO * TOTAL_VERMELHOS
const MARGEM_PLATAFORMA = TOTAL_ARRECADADO - PREMIO_VERDE

// ===========================================
// FORMATAÇÃO (usado nos emails e relatórios)
// ===========================================
function formatarMoeda (valor) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(Number(valor) || 0)
}

// Strings pré-formatadas (evita recomputar toda hora)
const VALOR_VERMELHO_TEXTO = formatarMoeda(VALOR_VERMELHO) // "R$ 20,00"
const PREMIO_VERDE_TEXTO = formatarMoeda(PREMIO_VERDE)     // "R$ 100,00"

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

  // Texto pré-formatado (usado nos templates de email)
  VALOR_VERMELHO_TEXTO,
  PREMIO_VERDE_TEXTO,

  // Utilitário
  formatarMoeda,
  MOEDA: 'BRL'
}