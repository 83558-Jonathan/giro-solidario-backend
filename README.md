# Navegar para pasta do backend
cd ~/Documents/giro-solidario/backend

# 1. SETUP INICIAL DO BANCO (cria tudo do zero)
npm run db:setup

# 2. VERIFICAR O BANCO
npm run db:check

# 3. POPULAR COM USUÁRIOS DE EXEMPLO
npm run db:seed

# 4. POPULAR RODADA COM PARTICIPANTES
npm run db:populate 1

# 5. INICIAR A RODADA
npm run rodada:iniciar 1

# 6. RESETAR TUDO (se precisar recomeçar)
npm run db:reset:force

# 7. REFRESH COMPLETO (reset + setup + seed)
npm run db:refresh

--

# 1. Em um terminal, mantenha o BACKEND rodando
cd ~/Documents/giro-solidario/backend
npm run dev

# 2. Em OUTRO terminal, inicie o FRONTEND
cd ~/Documents/giro-solidario/frontend
npm start