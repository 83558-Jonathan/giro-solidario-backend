// ===========================================
// config/abacate.js — Configuração AbacatePay (V2)
// ===========================================
const axios = require('axios')

const ABACATE_API_URL = 'https://api.abacatepay.com'

// ===========================================
// CLIENTE V2 (única instância usada por toda a aplicação)
// ===========================================
const abacateV2 = axios.create({
  baseURL: ABACATE_API_URL,
  headers: {
    Authorization: `Bearer ${process.env.ABACATE_API_KEY_V2}`,
    'Content-Type': 'application/json'
  },
  timeout: 15000
})

// ===========================================
// INTERCEPTORS (log de request/response)
// ===========================================
function addInterceptors (client, version) {
  client.interceptors.request.use(config => {
    console.log(
      `📤 AbacatePay ${version} Request: ${config.method.toUpperCase()} ${
        config.url
      }`
    )
    return config
  })

  client.interceptors.response.use(
    response => response,
    error => {
      if (error.response) {
        console.error(`❌ Erro na resposta AbacatePay ${version}:`, {
          status: error.response.status,
          data: error.response.data,
          url: error.config?.url
        })
      } else if (error.request) {
        console.error(
          `❌ Sem resposta da AbacatePay ${version} (timeout/rede):`,
          error.message
        )
      } else {
        console.error(
          `❌ Erro ao montar request AbacatePay ${version}:`,
          error.message
        )
      }
      return Promise.reject(error)
    }
  )
}

addInterceptors(abacateV2, 'v2')

// ===========================================
// ALIAS DE COMPATIBILIDADE (opcional)
// ===========================================
// Mantém `abacateV1` apontando para a mesma instância V2,
// caso algum arquivo antigo ainda importe `{ abacateV1 }`.
// Assim você não precisa refatorar tudo de uma vez.
const abacateV1 = abacateV2

module.exports = { abacateV2, abacateV1 }
