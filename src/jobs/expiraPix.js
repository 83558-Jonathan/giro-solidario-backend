const cron = require('node-cron')
const { processarTransacoesExpiradas } = require('../controllers/pixController')

cron.schedule('*/5 * * * *', () => {
  console.log('🕒 [CRON] Executando job de expiração de PIX...')
  processarTransacoesExpiradas().catch(err =>
    console.error('[CRON] Erro:', err)
  )
})
