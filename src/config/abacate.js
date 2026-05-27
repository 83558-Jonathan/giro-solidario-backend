const axios = require('axios')

const ABACATE_API_URL = 'https://api.abacatepay.com'

const abacateV1 = axios.create({
  baseURL: ABACATE_API_URL,
  headers: {
    Authorization: `Bearer ${process.env.ABACATE_API_KEY}`,
    'Content-Type': 'application/json'
  },
  timeout: 15000
})

const abacateV2 = axios.create({
  baseURL: ABACATE_API_URL,
  headers: {
    Authorization: `Bearer ${process.env.ABACATE_API_KEY_V2}`,
    'Content-Type': 'application/json'
  },
  timeout: 15000
})

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
      }
      return Promise.reject(error)
    }
  )
}

addInterceptors(abacateV1, 'v1')
addInterceptors(abacateV2, 'v2')

module.exports = { abacateV1, abacateV2 }
