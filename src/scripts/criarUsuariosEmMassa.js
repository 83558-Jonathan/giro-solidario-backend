// Script para criar 20 usuários de teste via front-end
(async function criarUsuariosEmMassa() {
    const TOTAL_USUARIOS = 20;
    console.log(`🚀 Iniciando criação de ${TOTAL_USUARIOS} usuários de teste...`);

    const conviteCode = 'CONVITE-ADMIN-MASTER';
    const resultados = [];
    const erros = [];

    // Função para gerar dados aleatórios
    const gerarNome = (i) => `teste${i})}`;
    const gerarEmail = (i) => `teste${i}@teste.com`;
    const gerarCPF = () => {
        const cpf = Math.floor(Math.random() * 99999999999).toString().padStart(11, '0');
        return cpf;
    };
    const gerarTelefone = () => `31${Math.floor(Math.random() * 999999999).toString().padStart(9, '0')}`;

    // Mostrar progresso
    console.log(`📊 Criando ${TOTAL_USUARIOS} usuários...\n`);

    for (let i = 1; i <= TOTAL_USUARIOS; i++) {
        try {
            const nome = gerarNome(i);
            const email = gerarEmail(i);
            const cpf = gerarCPF();
            const telefone = gerarTelefone();

            console.log(`🔄 [${i}/${TOTAL_USUARIOS}] Criando: ${nome} (${email})`);

            const response = await fetch('/api/auth/registrar', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    nome: nome,
                    email: email,
                    telefone: telefone,
                    cpf: cpf,
                    chavePix: email,
                    tipoChavePix: 'email',
                    senha: 'Teste@123',
                    codigoConvite: conviteCode
                })
            });

            const data = await response.json();

            if (response.ok) {
                console.log(`✅ [${i}/${TOTAL_USUARIOS}] Sucesso: ${nome}`);
                resultados.push({
                    id: data.usuario?.id || 'N/A',
                    nome: nome,
                    email: email,
                    senha: 'Teste@123',
                    status: data.entrouNaFila ? 'Fila' : 'Rodada',
                    rodadaId: data.rodadaId || 'N/A',
                    posicaoFila: data.posicaoFila || 'N/A'
                });
            } else {
                console.error(`❌ [${i}/${TOTAL_USUARIOS}] Erro: ${data.error || 'Erro desconhecido'}`);
                erros.push({ nome, email, error: data.error });
            }

            // Pequeno delay entre requisições para não sobrecarregar
            await new Promise(resolve => setTimeout(resolve, 500));

        } catch (error) {
            console.error(`❌ [${i}/${TOTAL_USUARIOS}] Exceção: ${error.message}`);
            erros.push({ index: i, error: error.message });
        }
    }

    // Resumo final
    console.log('\n' + '='.repeat(60));
    console.log('📊 RESUMO DA CRIAÇÃO');
    console.log('='.repeat(60));
    console.log(`✅ Sucessos: ${resultados.length}/${TOTAL_USUARIOS}`);
    console.log(`❌ Erros: ${erros.length}/${TOTAL_USUARIOS}`);

    if (resultados.length > 0) {
        console.log('\n📋 USUÁRIOS CRIADOS:');
        console.table(resultados);

        // Salvar resultados em arquivo
        const blob = new Blob([JSON.stringify(resultados, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `usuarios_criados_${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        console.log('\n💾 Arquivo JSON com os resultados foi baixado!');
    }

    if (erros.length > 0) {
        console.log('\n❌ ERROS:');
        console.table(erros);
    }

    console.log('\n🎯 VERIFIQUE AS RODADAS NO PAINEL ADMIN!');
})();