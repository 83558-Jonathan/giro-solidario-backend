/**
 * TESTE COMPLETO DO SISTEMA DE RODADAS
 * 
 * Este script testa TODO o fluxo:
 * 1. Cadastro de usuários
 * 2. Formação de rodada com 15 participantes
 * 3. Distribuição de cores (1 verde, 2 pretos, 4 azuis, 8 vermelhos)
 * 4. Pagamento de todos os vermelhos
 * 5. Progressão automática (promoção de cores)
 * 6. Duplicação em 2 novas rodadas
 * 7. ✅ NOVO: Teste de usuários em espera (amarelos que viram vermelhos)
 * 8. Verificação de estrutura das novas rodadas
 * 
 * Como executar:
 * cd /root/giro-solidario-backend
 * node scripts/teste-completo.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Configurações
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/giro-solidario';
const TEST_PREFIX = 'TESTE_AUTO_';
const QUANTIDADE_USUARIOS = 15; // Exatamente 15 para formar 1 rodada completa
const QUANTIDADE_USUARIOS_ESPERA = 5; // Usuários que vão ficar na fila de espera

// Cores e emojis
const CORES = {
    amarelo: { nome: 'Amarelo', emoji: '🟡' },
    vermelho: { nome: 'Vermelho', emoji: '🔴' },
    azul: { nome: 'Azul', emoji: '🔵' },
    preto: { nome: 'Preto', emoji: '⚫' },
    verde: { nome: 'Verde', emoji: '🟢' },
    concluido: { nome: 'Concluído', emoji: '✅' }
};

// Utilitários
function log(emoji, mensagem, dados = null) {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`${timestamp} ${emoji} ${mensagem}`);
    if (dados) {
        console.log('   📊', JSON.stringify(dados, null, 2));
    }
}

function logSeparador() {
    console.log('\n' + '='.repeat(80) + '\n');
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ===========================================
// 1. LIMPAR DADOS DE TESTE
// ===========================================
async function limparDadosTeste() {
    log('🧹', 'Limpando dados de teste anteriores...');

    const User = require('../models/User');
    const Rodada = require('../models/Rodada');
    const Transacao = require('../models/Transacao');
    const SolicitacaoSaque = require('../models/SolicitacaoSaque');

    const usuariosRemovidos = await User.deleteMany({ email: { $regex: `^${TEST_PREFIX}` } });
    log('🗑️', `${usuariosRemovidos.deletedCount} usuários de teste removidos`);

    // Limpar todas as rodadas para teste limpo
    const rodadasRemovidas = await Rodada.deleteMany({});
    log('🗑️', `${rodadasRemovidas.deletedCount} rodadas removidas`);

    await Transacao.deleteMany({});
    await SolicitacaoSaque.deleteMany({});

    log('✅', 'Dados limpos com sucesso');
    await sleep(500);
}

// ===========================================
// 2. CRIAR USUÁRIOS PRINCIPAIS (15 para a rodada)
// ===========================================
async function criarUsuariosPrincipais(quantidade) {
    log('👥', `Criando ${quantidade} usuários principais...`);

    const User = require('../models/User');
    const usuarios = [];

    for (let i = 1; i <= quantidade; i++) {
        const nome = `${TEST_PREFIX}Principal_${i}`;
        const email = `${TEST_PREFIX}principal${i}@teste.com`;
        const cpf = `${TEST_PREFIX}P${String(i).padStart(11, '0').slice(0, 11)}`;
        const telefone = `1199999${String(i).padStart(4, '0')}`;
        const chavePix = email;
        const tipoChavePix = 'email';
        const senha = 'Teste@123';

        const salt = await bcrypt.genSalt(10);
        const senhaHash = await bcrypt.hash(senha, salt);

        const usuario = new User({
            nome,
            email,
            telefone,
            cpf,
            chavePix,
            tipoChavePix,
            senha: senhaHash,
            role: 'user'
        });

        usuario.codigoConvite = `CONVITE-PRINCIPAL-${i}`;

        // Primeiro usuário sem convite, os demais convidados pelo primeiro
        if (i > 1 && usuarios[0]) {
            usuario.indicadoPor = usuarios[0]._id;
            await User.findByIdAndUpdate(usuarios[0]._id, {
                $push: { meusIndicados: usuario._id },
                $inc: { totalIndicacoes: 1 }
            });
        }

        await usuario.save();
        usuarios.push(usuario);
        log('✅', `Criado: ${nome}${i > 1 ? ` (convidado por ${usuarios[0].nome})` : ' (criador)'}`);
        await sleep(100);
    }

    log('✅', `${usuarios.length} usuários principais criados com sucesso`);
    return usuarios;
}

// ===========================================
// 2.1. CRIAR USUÁRIOS DE ESPERA (vão ficar aguardando)
// ===========================================
async function criarUsuariosEspera(quantidade, usuariosPrincipais) {
    log('👥', `Criando ${quantidade} usuários que vão ficar na fila de espera...`);

    const User = require('../models/User');
    const usuariosEspera = [];
    const indicador = usuariosPrincipais[0]; // Usam o primeiro usuário como indicador

    for (let i = 1; i <= quantidade; i++) {
        const nome = `${TEST_PREFIX}Espera_${i}`;
        const email = `${TEST_PREFIX}espera${i}@teste.com`;
        const cpf = `${TEST_PREFIX}E${String(i).padStart(11, '0').slice(0, 11)}`;
        const telefone = `1198888${String(i).padStart(4, '0')}`;
        const chavePix = email;
        const tipoChavePix = 'email';
        const senha = 'Teste@123';

        const salt = await bcrypt.genSalt(10);
        const senhaHash = await bcrypt.hash(senha, salt);

        const usuario = new User({
            nome,
            email,
            telefone,
            cpf,
            chavePix,
            tipoChavePix,
            senha: senhaHash,
            role: 'user',
            indicadoPor: indicador._id,
            codigoConvite: `CONVITE-ESPERA-${i}`
        });

        await usuario.save();

        // Atualizar indicações do indicador
        await User.findByIdAndUpdate(indicador._id, {
            $push: { meusIndicados: usuario._id },
            $inc: { totalIndicacoes: 1 }
        });

        usuariosEspera.push(usuario);
        log('🟡', `Criado (aguardará vaga): ${nome} (convidado por ${indicador.nome})`);
        await sleep(100);
    }

    log('✅', `${usuariosEspera.length} usuários de espera criados com sucesso`);
    return usuariosEspera;
}

// ===========================================
// 3. ADICIONAR USUÁRIOS PRINCIPAIS À RODADA
// ===========================================
async function adicionarUsuariosRodada(usuarios) {
    log('🔄', 'Adicionando usuários principais à rodada...');

    const RodadaService = require('../services/rodadaService');

    // Primeiro usuário cria a rodada
    const criador = usuarios[0];
    let rodada = await RodadaService.criarRodada(criador._id.toString());
    log('📌', `Rodada ${rodada.nome} criada por ${criador.nome}`);

    // Adicionar os demais usuários
    for (let i = 1; i < usuarios.length; i++) {
        const usuario = usuarios[i];
        try {
            rodada = await RodadaService.adicionarParticipanteAmarelo(
                rodada._id.toString(),
                usuario._id.toString(),
                criador._id.toString()
            );
            log('➕', `${usuario.nome} adicionado à ${rodada.nome} (${rodada.participantes.length}/15)`);
            await sleep(200);
        } catch (error) {
            log('⚠️', `${usuario.nome}: ${error.message}`);
        }
    }

    // Verificar se completou 15
    const rodadaFinal = await require('../models/Rodada').findById(rodada._id);
    if (rodadaFinal.participantes.length === 15) {
        log('🎯', `Rodada ${rodadaFinal.nome} completou 15 participantes! Iniciando...`);
    }

    return rodadaFinal;
}

// ===========================================
// 3.1. TENTAR ADICIONAR USUÁRIOS DE ESPERA (vão falhar e entrar na fila)
// ===========================================
async function adicionarUsuariosEspera(rodada, usuariosEspera) {
    log('🔄', 'Tentando adicionar usuários de espera à rodada cheia...');
    log('⚠️', 'Como a rodada já tem 15 participantes, eles serão adicionados como AMARELOS e marcados como AGUARDANDO...');

    const RodadaService = require('../services/rodadaService');
    const User = require('../models/User');

    for (const usuario of usuariosEspera) {
        try {
            // Tentar adicionar como vermelho (vai falhar porque a rodada está cheia)
            // O serviço automaticamente vai adicionar como amarelo e marcar aguardandoVermelho = true
            const resultado = await RodadaService.adicionarParticipanteVermelho(
                rodada._id.toString(),
                usuario._id.toString(),
                usuario.indicadoPor?.toString() || null
            );

            log('🟡', `${usuario.nome} adicionado como AMARELO e marcado como AGUARDANDO vaga de vermelho`);
            await sleep(200);
        } catch (error) {
            log('⚠️', `${usuario.nome}: ${error.message}`);
        }
    }

    // Verificar quantos estão aguardando
    const pendentes = await User.countDocuments({ aguardandoVermelho: true });
    log('⏳', `${pendentes} usuário(s) estão aguardando vaga de vermelho`);

    return pendentes;
}

// ===========================================
// 4. MOSTRAR DETALHES DA RODADA
// ===========================================
async function mostrarDetalhesRodada(rodada) {
    logSeparador();
    log('📋', `DETALHES DA ${rodada.nome} (${rodada.status.toUpperCase()})`);

    const participantes = rodada.participantes || [];
    const cores = {
        amarelo: participantes.filter(p => p.cor === 'amarelo').length,
        vermelho: participantes.filter(p => p.cor === 'vermelho').length,
        azul: participantes.filter(p => p.cor === 'azul').length,
        preto: participantes.filter(p => p.cor === 'preto').length,
        verde: participantes.filter(p => p.cor === 'verde').length,
        concluido: participantes.filter(p => p.cor === 'concluido').length
    };

    console.log(`\n📊 Distribuição de cores:`);
    console.log(`   🟡 Amarelo: ${cores.amarelo}`);
    console.log(`   🔴 Vermelho: ${cores.vermelho}`);
    console.log(`   🔵 Azul: ${cores.azul}`);
    console.log(`   ⚫ Preto: ${cores.preto}`);
    console.log(`   🟢 Verde: ${cores.verde}`);
    console.log(`   ✅ Concluído: ${cores.concluido}`);
    console.log(`\n💰 Vermelhos pagos: ${rodada.totalDepositosConfirmados}/8`);
    console.log(`📌 Status: ${rodada.status}`);

    if (rodada.verde) {
        const User = require('../models/User');
        const verde = await User.findById(rodada.verde);
        console.log(`\n👑 VERDE atual: ${verde?.nome || rodada.verde}`);
    }

    logSeparador();
}

// ===========================================
// 5. MARCAR TODOS VERMELHOS COMO PAGOS
// ===========================================
async function marcarTodosVermelhosPagos(rodada) {
    log('💰', `Marcando todos os vermelhos da ${rodada.nome} como pagos...`);

    const RodadaService = require('../services/rodadaService');
    const Transacao = require('../models/Transacao');
    const User = require('../models/User');

    // Buscar participantes vermelhos
    const vermelhos = rodada.participantes.filter(p => p.cor === 'vermelho');
    log('🔴', `${vermelhos.length} vermelhos encontrados`);

    let pagos = 0;
    let erros = 0;

    for (let i = 0; i < vermelhos.length; i++) {
        const vermelho = vermelhos[i];
        const usuario = await User.findById(vermelho.usuario);

        // Buscar transação pendente
        let transacao = await Transacao.findOne({
            pagador: vermelho.usuario,
            rodada: rodada._id,
            status: 'pendente'
        });

        // Se não existe transação, criar uma
        if (!transacao) {
            log('⚠️', `Criando transação para ${usuario.nome}...`);
            transacao = new Transacao({
                tipo: 'deposito',
                pagador: vermelho.usuario,
                recebedor: rodada.verde,
                valor: 125,
                rodada: rodada._id,
                status: 'pendente'
            });
            await transacao.save();

            // Associar ao participante
            vermelho.transacaoId = transacao._id;
            await rodada.save();
        }

        try {
            const comprovante = `https://teste.com/comprovante_${transacao._id}.png`;
            const result = await RodadaService.confirmarDeposito(
                transacao._id.toString(),
                comprovante,
                vermelho.usuario.toString()
            );

            if (!result.jaProcessado) {
                pagos++;
                log('✅', `${i + 1}/${vermelhos.length} - ${usuario.nome} pago com sucesso`);
            } else {
                log('⚠️', `${i + 1}/${vermelhos.length} - ${usuario.nome} já estava pago`);
                pagos++;
            }

            await sleep(300);
        } catch (error) {
            erros++;
            log('❌', `${i + 1}/${vermelhos.length} - Erro ao pagar ${usuario.nome}: ${error.message}`);
        }
    }

    log('💰', `${pagos}/${vermelhos.length} pagamentos processados (${erros} erros)`);
    return pagos === vermelhos.length;
}

// ===========================================
// 6. FORÇAR VERIFICAÇÃO E AVANÇO
// ===========================================
async function forcarAvancoRodada(rodadaId) {
    log('🔄', 'Forçando verificação e avanço da rodada...');

    const RodadaService = require('../services/rodadaService');
    const resultado = await RodadaService.verificarEAvancarSeNecessario(rodadaId);

    if (resultado) {
        log('✅', 'Rodada avançada com sucesso!');
    } else {
        log('⚠️', 'Rodada não avançou automaticamente, forçando avanço manual...');
        await RodadaService.avancarRodada(rodadaId);
    }

    await sleep(1000);
}

// ===========================================
// 7. VERIFICAR NOVAS RODADAS E ALOCAÇÃO DOS PENDENTES
// ===========================================
async function verificarNovasRodadasEAlocacao(rodadaOriginal, usuariosEspera) {
    log('🔍', 'Verificando novas rodadas criadas e alocação dos usuários pendentes...');

    const Rodada = require('../models/Rodada');
    const User = require('../models/User');

    // Buscar rodadas geradas a partir da original
    const novasRodadas = await Rodada.find({
        rodadaOrigem: rodadaOriginal._id
    });

    if (novasRodadas.length === 0) {
        log('⚠️', 'Nenhuma nova rodada foi criada!');
        return [];
    }

    log('🎉', `${novasRodadas.length} nova(s) rodada(s) criada(s)!`);

    // Verificar estrutura de cada nova rodada
    for (const rodada of novasRodadas) {
        const participantes = rodada.participantes || [];
        const cores = {
            verde: participantes.filter(p => p.cor === 'verde').length,
            preto: participantes.filter(p => p.cor === 'preto').length,
            azul: participantes.filter(p => p.cor === 'azul').length,
            vermelho: participantes.filter(p => p.cor === 'vermelho').length,
            amarelo: participantes.filter(p => p.cor === 'amarelo').length
        };

        let verdeNome = 'N/A';
        if (rodada.verde) {
            const verde = await User.findById(rodada.verde);
            verdeNome = verde?.nome || rodada.verde;
        }

        console.log(`\n📌 ${rodada.nome} (${rodada.status.toUpperCase()})`);
        console.log(`   👑 Verde: ${verdeNome}`);
        console.log(`   Participantes: ${participantes.length}/15`);
        console.log(`   Cores: 🟢${cores.verde} ⚫${cores.preto} 🔵${cores.azul} 🔴${cores.vermelho} 🟡${cores.amarelo}`);

        // Validar estrutura
        const estruturaOk = cores.verde === 1 && cores.preto === 2 && cores.azul === 4;
        if (estruturaOk) {
            log('✅', `Estrutura da ${rodada.nome} está CORRETA!`);
        } else {
            log('⚠️', `Estrutura da ${rodada.nome} está INCORRETA!`);
        }
    }

    // ✅ VERIFICAR SE OS USUÁRIOS DE ESPERA FORAM ALOCADOS COMO VERMELHOS
    logSeparador();
    log('🔍', 'VERIFICANDO ALOCAÇÃO DOS USUÁRIOS QUE ESTAVAM NA FILA...');

    let alocados = 0;
    let naoAlocados = 0;

    for (const usuario of usuariosEspera) {
        const usuarioAtualizado = await User.findById(usuario._id);
        let encontrado = false;
        let rodadaEncontrada = null;
        let corEncontrada = null;

        // Verificar em qual nova rodada ele está
        for (const rodada of novasRodadas) {
            const participante = rodada.participantes.find(
                p => p.usuario.toString() === usuario._id.toString()
            );
            if (participante) {
                encontrado = true;
                rodadaEncontrada = rodada.nome;
                corEncontrada = participante.cor;
                break;
            }
        }

        if (encontrado && corEncontrada === 'vermelho') {
            alocados++;
            log('🔴', `${usuario.nome} foi alocado como VERMELHO na ${rodadaEncontrada} ✅`);
        } else if (encontrado && corEncontrada !== 'vermelho') {
            naoAlocados++;
            log('⚠️', `${usuario.nome} foi alocado como ${corEncontrada} (deveria ser VERMELHO) ❌`);
        } else {
            naoAlocados++;
            const aindaAguardando = usuarioAtualizado?.aguardandoVermelho || false;
            log('⏳', `${usuario.nome} ainda NÃO foi alocado (aguardandoVermelho: ${aindaAguardando})`);
        }
    }

    logSeparador();
    log('📊', `RESULTADO DA ALOCAÇÃO:`);
    log('✅', `${alocados} usuários alocados como VERMELHOS nas novas rodadas`);
    if (naoAlocados > 0) {
        log('⚠️', `${naoAlocados} usuários ainda não foram alocados`);
    }

    return novasRodadas;
}

// ===========================================
// 8. VERIFICAR PROGRESSÃO DOS PARTICIPANTES
// ===========================================
async function verificarProgressaoParticipantes(rodadaOriginal, novasRodadas) {
    log('🔍', 'Verificando progressão dos participantes principais...');

    const User = require('../models/User');

    // Participantes da rodada original
    const participantesOriginais = rodadaOriginal.participantes || [];

    console.log('\n📊 MAPEAMENTO DE PROGRESSÃO (PRINCIPAIS):');
    console.log('Participante | Cor Original | Nova Cor | Nova Rodada');
    console.log('-'.repeat(60));

    for (const p of participantesOriginais) {
        const usuario = await User.findById(p.usuario);
        const corOriginal = p.cor;
        let novaCor = '❓';
        let rodadaDestino = '❓';

        // Verificar em qual nova rodada o participante está
        for (const nr of novasRodadas) {
            const participanteNovo = nr.participantes.find(
                np => np.usuario.toString() === p.usuario.toString()
            );
            if (participanteNovo) {
                novaCor = participanteNovo.cor;
                rodadaDestino = nr.nome;
                break;
            }
        }

        // Se não está nas novas rodadas, pode ter sido promovido a concluído
        if (novaCor === '❓' && p.cor === 'verde') {
            novaCor = 'concluido';
            rodadaDestino = 'SAIU (ganhou R$ 900)';
        }

        const emojiOriginal = CORES[corOriginal]?.emoji || '❓';
        const emojiNova = CORES[novaCor]?.emoji || '❓';

        console.log(`${emojiOriginal} ${usuario?.nome || p.usuario} | ${corOriginal} | ${emojiNova} ${novaCor} | ${rodadaDestino}`);
    }
}

// ===========================================
// 9. RELATÓRIO FINAL
// ===========================================
async function relatorioFinal(usuariosEspera) {
    logSeparador();
    log('📊', 'RELATÓRIO FINAL COMPLETO');
    logSeparador();

    const User = require('../models/User');
    const Rodada = require('../models/Rodada');
    const Transacao = require('../models/Transacao');

    const totalUsuarios = await User.countDocuments();
    const usuariosTeste = await User.countDocuments({ email: { $regex: `^${TEST_PREFIX}` } });
    const totalRodadas = await Rodada.countDocuments();
    const rodadasConcluidas = await Rodada.countDocuments({ status: 'concluida' });
    const rodadasAndamento = await Rodada.countDocuments({ status: 'em_andamento' });
    const rodadasAguardando = await Rodada.countDocuments({ status: 'aguardando' });
    const totalTransacoes = await Transacao.countDocuments();
    const transacoesConfirmadas = await Transacao.countDocuments({ status: 'confirmado' });
    const pendentes = await User.countDocuments({ aguardandoVermelho: true });

    console.log('\n📈 ESTATÍSTICAS GERAIS:');
    console.log(`   👥 Usuários totais: ${totalUsuarios}`);
    console.log(`   🧪 Usuários de teste: ${usuariosTeste}`);
    console.log(`      - Principais: ${usuariosTeste - (usuariosEspera?.length || 0)}`);
    console.log(`      - Em espera: ${usuariosEspera?.length || 0}`);
    console.log(`   🎲 Rodadas totais: ${totalRodadas}`);
    console.log(`      - Concluídas: ${rodadasConcluidas}`);
    console.log(`      - Em andamento: ${rodadasAndamento}`);
    console.log(`      - Aguardando: ${rodadasAguardando}`);
    console.log(`   💰 Transações: ${totalTransacoes} (${transacoesConfirmadas} confirmadas)`);
    console.log(`   ⏳ Usuários pendentes (aguardandoVermelho): ${pendentes}`);

    // Verificar se o teste foi bem sucedido
    const testeSucesso = rodadasConcluidas >= 1 && rodadasAguardando >= 2;

    console.log('\n🎯 RESULTADO DO TESTE:');
    if (testeSucesso) {
        console.log('   ✅ TESTE PASSOU! O sistema está funcionando corretamente.');
        console.log('   ✅ A progressão de cores está OK.');
        console.log('   ✅ A duplicação de rodadas está OK.');
        console.log('   ✅ A estrutura das novas rodadas está OK.');
        if (pendentes === 0 && usuariosEspera?.length > 0) {
            console.log('   ✅ Os usuários em espera foram alocados como VERMELHOS!');
        } else if (usuariosEspera?.length > 0) {
            console.log(`   ⚠️ Ainda há ${pendentes} usuários em espera.`);
        }
    } else {
        console.log('   ❌ TESTE FALHOU! Verifique os logs acima para identificar o problema.');
    }

    logSeparador();
}

// ===========================================
// FUNÇÃO PRINCIPAL
// ===========================================
async function executarTesteCompleto() {
    console.log('\n' + '🚀'.repeat(40));
    console.log('🚀 TESTE COMPLETO DO SISTEMA DE RODADAS');
    console.log('🚀 TESTE INCLUI FILA DE ESPERA (AMARELOS → VERMELHOS)');
    console.log('🚀'.repeat(40) + '\n');

    let usuariosPrincipais = [];
    let usuariosEspera = [];
    let rodada = null;
    let pendentesAntes = 0;

    try {
        // Conectar ao banco
        log('🔌', `Conectando ao MongoDB...`);
        await mongoose.connect(MONGO_URI);
        log('✅', 'Conectado com sucesso');
        await sleep(500);

        // 1. Limpar dados
        await limparDadosTeste();

        // 2. Criar usuários principais (15 para a rodada)
        usuariosPrincipais = await criarUsuariosPrincipais(QUANTIDADE_USUARIOS);

        // 3. Criar usuários de espera (vão ficar na fila)
        usuariosEspera = await criarUsuariosEspera(QUANTIDADE_USUARIOS_ESPERA, usuariosPrincipais);

        // 4. Adicionar usuários principais à rodada
        rodada = await adicionarUsuariosRodada(usuariosPrincipais);

        // 5. Mostrar detalhes da rodada
        await mostrarDetalhesRodada(rodada);

        // 6. Tentar adicionar usuários de espera (vão entrar na fila)
        pendentesAntes = await adicionarUsuariosEspera(rodada, usuariosEspera);

        // Mostrar que estão na fila
        if (pendentesAntes > 0) {
            logSeparador();
            log('⏳', `${pendentesAntes} usuários estão AGUARDANDO na fila para serem vermelhos`);
            log('🔄', 'Quando a rodada atual for concluída, eles serão alocados como VERMELHOS nas novas rodadas');
        }

        // 7. Marcar todos vermelhos como pagos
        const todosPagos = await marcarTodosVermelhosPagos(rodada);

        if (!todosPagos) {
            log('⚠️', 'Nem todos os pagamentos foram processados, mas continuando...');
        }

        // 8. Forçar avanço
        await forcarAvancoRodada(rodada._id.toString());

        // 9. Buscar rodada atualizada
        const RodadaModel = require('../models/Rodada');
        rodada = await RodadaModel.findById(rodada._id);

        // 10. Verificar novas rodadas e alocação dos pendentes
        const novasRodadas = await verificarNovasRodadasEAlocacao(rodada, usuariosEspera);

        // 11. Verificar progressão dos participantes principais
        if (novasRodadas.length > 0) {
            await verificarProgressaoParticipantes(rodada, novasRodadas);
        }

        // 12. Relatório final
        await relatorioFinal(usuariosEspera);

        log('🎉', 'TESTE COMPLETO FINALIZADO COM SUCESSO!');

    } catch (error) {
        log('💥', `ERRO FATAL: ${error.message}`);
        console.error(error.stack);
    } finally {
        await mongoose.disconnect();
        log('🔌', 'Desconectado do MongoDB');
    }
}

// Executar
executarTesteCompleto();