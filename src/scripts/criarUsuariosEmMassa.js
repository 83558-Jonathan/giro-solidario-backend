// Script para criar 20 usuários de teste via front-end
(async function criarUsuariosEmMassa() {
    // 🔧 CONFIGURE A URL BASE DO SEU BACKEND
    const API_BASE = 'http://localhost:5001/api'; // Altere se necessário
    const TOTAL_USUARIOS = 20;
    const CONVITE_CODE = 'CONVITE-ADMIN-MASTER'; // Código de convite válido (admin master)

    console.log(`🚀 Iniciando criação de ${TOTAL_USUARIOS} usuários...`);
    console.log(`🔗 API Base: ${API_BASE}`);

    const resultados = [];
    const erros = [];

    // Gera CPF único baseado no timestamp + índice (evita colisão)
    const gerarCPFUnico = (index) => {
        const base = Date.now().toString().slice(-6) + index.toString().padStart(4, '0');
        const cpf = base.padEnd(11, '0').slice(0, 11);
        return cpf;
    };

    const gerarTelefone = () => `31${Math.floor(Math.random() * 999999999).toString().padStart(9, '0')}`;

    for (let i = 1; i <= TOTAL_USUARIOS; i++) {
        try {
            const nome = `teste${i}`;
            const email = `teste${i}_${Date.now()}@teste.com`; // Email único
            const cpf = gerarCPFUnico(i);
            const telefone = gerarTelefone();

            console.log(`🔄 [${i}/${TOTAL_USUARIOS}] Criando: ${nome} (${email})`);

            const response = await fetch(`${API_BASE}/auth/registrar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    nome,
                    email,
                    telefone,
                    cpf,
                    chavePix: email,
                    tipoChavePix: 'email',
                    senha: 'Teste@123',
                    codigoConvite: CONVITE_CODE
                })
            });

            const data = await response.json();

            if (response.ok) {
                console.log(`✅ [${i}/${TOTAL_USUARIOS}] Sucesso: ${nome} → ${data.entrouNaFila ? 'Fila' : 'Rodada'}`);
                resultados.push({
                    id: data.usuario?.id || 'N/A',
                    nome,
                    email,
                    senha: 'Teste@123',
                    status: data.entrouNaFila ? `Fila (pos ${data.posicaoFila || '?'})` : `Rodada ${data.rodadaId || '?'}`,
                    rodadaId: data.rodadaId || 'N/A',
                    posicaoFila: data.posicaoFila || 'N/A'
                });
            } else {
                console.error(`❌ [${i}/${TOTAL_USUARIOS}] Erro: ${data.error || 'Desconhecido'}`);
                erros.push({ nome, email, error: data.error });
            }

            // Delay entre requisições (evita sobrecarga)
            await new Promise(resolve => setTimeout(resolve, 800));

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

        // Salvar resultados em arquivo JSON
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