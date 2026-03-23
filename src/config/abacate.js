const axios = require('axios');

const ABACATE_API_URL = 'https://api.abacatepay.com/v1';
const ABACATE_API_KEY = process.env.ABACATE_API_KEY;

if (!ABACATE_API_KEY) {
    console.error('❌ ABACATE_API_KEY não definida no .env');
    process.exit(1);
}

console.log(`🔑 AbacatePay configurado com API key: ${ABACATE_API_KEY.substring(0, 8)}...`);

const abacate = axios.create({
    baseURL: ABACATE_API_URL,
    headers: {
        'Authorization': `Bearer ${ABACATE_API_KEY}`,
        'Content-Type': 'application/json'
    },
    timeout: 15000 // 15 segundos de timeout
});

// Interceptor para log de requisições
abacate.interceptors.request.use(
    config => {
        console.log(`📤 AbacatePay Request: ${config.method.toUpperCase()} ${config.url}`);
        return config;
    },
    error => {
        console.error('❌ Erro na requisição AbacatePay (request):', error.message);
        return Promise.reject(error);
    }
);

// Interceptor para log de respostas e erros
abacate.interceptors.response.use(
    response => {
        console.log(`📥 AbacatePay Response: ${response.status} - ${response.config.url}`);
        return response;
    },
    error => {
        if (error.response) {
            // A requisição foi feita e o servidor respondeu com status >= 300
            console.error('❌ Erro na resposta AbacatePay:', {
                status: error.response.status,
                data: error.response.data,
                url: error.config?.url,
                method: error.config?.method
            });
        } else if (error.request) {
            // A requisição foi feita mas não houve resposta
            console.error('❌ Sem resposta da AbacatePay:', error.message);
        } else {
            // Algo aconteceu na configuração da requisição
            console.error('❌ Erro na configuração da AbacatePay:', error.message);
        }
        return Promise.reject(error);
    }
);

module.exports = abacate;