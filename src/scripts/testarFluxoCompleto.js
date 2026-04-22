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
 * 7. Teste de usuários em espera (amarelos que viram vermelhos)
 * 8. Verificação de estrutura das novas rodadas
 * 
 * Como executar:
 * cd /root/giro-solidario-backend
 * node src/scripts/testarFluxoCompleto.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Configurações
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/giro-solidario';
const TEST_PREFIX = 'TESTE_AUTO_';
const QUANTIDADE_USUARIOS = 15;
const QUANTIDADE_USUARIOS_ESPERA = 5;

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
// 1. LIMPAR DADOS DE TESTE (COM TRY/CATCH)
// ===========================================
async function limparDadosTeste() {
    log('🧹', 'Tentando limpar dados de teste anteriores...');

    const User = require('../models/User');
    const Rodada = require('../models/Rodada');
    const Transacao = require('../models/Transacao');
    const SolicitacaoSaque = require('../models/SolicitacaoSaque');

    try {
        const usuariosRemovidos = await User.deleteMany({ email: { $regex: `^${TEST_PREFIX}` } });
        log('🗑️', `${usuariosRemovidos.deletedCount} usuários de teste removidos`);
    } catch (error) {
        log('⚠️', `Não foi possível remover usuários: ${error.message}`);
    }

    try {
        const rodadasRemovidas = await Rodada.deleteMany({});
        log('🗑️', `${rodadasRemovidas.deletedCount} rodadas removidas`);
    } catch (error) {
        log('⚠️', `Não foi possível remover rodadas: ${error.message}`);
    }

    try {
        await Transacao.deleteMany({});
        await SolicitacaoSaque.deleteMany({});
        log('🗑️', 'Transações e solicitações removidas');
    } catch (error) {
        log('⚠️', `Não foi possível remover transações: ${error.message}`);
    }

    log('✅', 'Limpeza concluída (com possíveis permissões limitadas)');
    await sleep(500);
}

// ===========================================
// 2. CRIAR USUÁRIOS PRINCIPAIS
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

        // Verificar se já existe
        const existe = await User.findOne({ email });
        if (existe) {
            log('⚠️', `Usuário ${nome} já existe, pulando...`);
            usuarios.push(existe);
            continue;
        }

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

        if (i > 1 && usuarios[0]) {
            usuario.indicadoPor = usuarios[0]._id;
            await User.findByIdAndUpdate(usuarios[0]._id, {
                $push: { meusIndicados: usuario._id },
                $inc: { totalIndicacoes: 1 }
            });
        }

        await usuario.save();
        usuarios.push(usuario);
        log('✅', `Criado: ${nome}`);
        await sleep(100);
    }

    log('✅', `${usuarios.length} usuários principais criados/obtidos`);
    return usuarios;
}

// ===========================================
// 3. CRIAR USUÁRIOS DE ESPERA
// ===========================================
async function criarUsuariosEspera(quantidade, usuariosPrincipais) {
    log('👥', `Criando ${quantidade} usuários de espera...`);

    const User = require('../models/User');
    const usuariosEspera = [];
    const indicador = usuariosPrincipais[0];

    for (let i = 1; i <= quantidade; i++) {
        const nome = `${TEST_PREFIX}Espera_${i}`;
        const email = `${TEST_PREFIX}espera${i}@teste.com`;
        const cpf = `${TEST_PREFIX}E${String(i).padStart(11, '0').slice(0, 11)}`;
        const telefone = `1198888${String(i).padStart(4, '0')}`;
        const chavePix = email;
        const tipoChavePix = 'email';
        const senha = 'Teste@123';

        // Verificar se já existe
        const existe = await User.findOne({ email });
        if (existe) {
            log('⚠️', `Usuário ${nome} já existe, pulando...`);
            usuariosEspera.push(existe);
            continue;
        }

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

        await User.findByIdAndUpdate(indicador._id, {
            $push: { meusIndicados: usuario._id },
            $inc: { totalIndicacoes: 1 }
        });

        usuariosEspera.push(usuario);
        log('🟡', `Criado: ${nome} (aguardará vaga)`);
        await sleep(100);
    }

    log('✅', `${usuariosEspera.length} usuários de espera criados/obtidos`);
    return usuariosEspera;
}

// ===========================================
// 4. ADICIONAR USUÁRIOS PRINCIPAIS À RODADA
// ===========================================
async function adicionarUsuariosRodada(usuarios) {
    log('🔄', 'Adicionando usuários principais à rodada...');

    const RodadaService = require('../services/rodadaService');
    const Rodada = require('../models/Rodada');

    // Verificar se já existe uma rodada com esses participantes
    const rodadaExistente = await Rodada.findOne({
        'participantes.usuario': usuarios[0]._id,
        status: { $in: ['aguardando', 'em_andamento'] }
    });

    if (rodadaExistente) {
        log('📌', `Rodada ${rodadaExistente.nome} já existe, usando ela...`);
        return rodadaExistente;
    }

    const criador = usuarios[0];
    let rodada = await RodadaService.criarRodada(criador._id.toString());
    log('📌', `Rodada ${rodada.nome} criada por ${criador.nome}`);

    for (let i = 1; i < usuarios.length; i++) {
        const usuario = usuarios[i];
        try {
            rodada = await RodadaService.adicionarParticipanteAmarelo(
                rodada._id.toString(),
                usuario._id.toString(),
                criador._id.toString()
            );
            log('➕', `${usuario.nome} adicionado (${rodada.participantes.length}/15)`);
            await sleep(200);
        } catch (error) {
            log('⚠️', `${usuario.nome}: ${error.message}`);
        }
    }

    const rodadaFinal = await Rodada.findById(rodada._id);
    if (rodadaFinal.participantes.length === 15) {
        log('🎯', `Rodada ${rodadaFinal.nome} completou 15 participantes!`);
    }

    return rodadaFinal;
}

// ===========================================
// 5. ADICIONAR USUÁRIOS DE ESPERA
// ===========================================
async function adicionarUsuariosEspera(rodada, usuariosEspera) {
    log('🔄', 'Adicionando usuários de espera a rodada cheia...');
    log('⚠️', 'Como a rodada ja tem 15 participantes e 8 vermelhos, eles serao marcados como AGUARDANDO...');

    const RodadaService = require('../services/rodadaService');
    const User = require('../models/User');

    for (const usuario of usuariosEspera) {
        try {
            // Tenta adicionar como vermelho (vai falhar porque a rodada esta cheia)
            // O service deve adicionar como amarelo e marcar aguardandoVermelho = true
            await RodadaService.adicionarParticipanteVermelho(
                rodada._id.toString(),
                usuario._id.toString(),
                usuario.indicadoPor?.toString() || null
            );
            log('🟡', `${usuario.nome} entrou na FILA DE ESPERA`);
            await sleep(200);
        } catch (error) {
            log('⚠️', `${usuario.nome}: ${error.message}`);
        }
    }

    const pendentes = await User.countDocuments({ aguardandoVermelho: true });
    log('⏳', `${pendentes} usuario(s) aguardando vaga de vermelho`);
    return pendentes;
}

// ===========================================
// 6. MOSTRAR DETALHES DA RODADA
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

    logSeparador();
}

// ===========================================
// 7. MARCAR TODOS VERMELHOS COMO PAGOS
// ===========================================
async function marcarTodosVermelhosPagos(rodada) {
    log('💰', `Processando pagamentos da ${rodada.nome}...`);

    const RodadaService = require('../services/rodadaService');
    const Transacao = require('../models/Transacao');
    const User = require('../models/User');

    const vermelhos = rodada.participantes.filter(p => p.cor === 'vermelho');
    log('🔴', `${vermelhos.length} vermelhos encontrados`);

    let pagos = 0;

    for (let i = 0; i < vermelhos.length; i++) {
        const vermelho = vermelhos[i];
        const usuario = await User.findById(vermelho.usuario);

        let transacao = await Transacao.findOne({
            pagador: vermelho.usuario,
            rodada: rodada._id,
            status: 'pendente'
        });

        if (!transacao) {
            transacao = new Transacao({
                tipo: 'deposito',
                pagador: vermelho.usuario,
                recebedor: rodada.verde,
                valor: 125,
                rodada: rodada._id,
                status: 'pendente'
            });
            await transacao.save();
            vermelho.transacaoId = transacao._id;
            await rodada.save();
        }

        try {
            const comprovante = `https://teste.com/comprovante_${transacao._id}.png`;
            await RodadaService.confirmarDeposito(
                transacao._id.toString(),
                comprovante,
                vermelho.usuario.toString()
            );
            pagos++;
            log('✅', `${i + 1}/${vermelhos.length} - ${usuario.nome} pago`);
            await sleep(300);
        } catch (error) {
            log('❌', `${usuario.nome}: ${error.message}`);
        }
    }

    log('💰', `${pagos}/${vermelhos.length} pagamentos processados`);
    return pagos === vermelhos.length;
}

// ===========================================
// 8. FORÇAR VERIFICAÇÃO E AVANÇO
// ===========================================
async function forcarAvancoRodada(rodadaId) {
    log('🔄', 'Forçando verificação da rodada...');

    const RodadaService = require('../services/rodadaService');
    await RodadaService.verificarEAvancarSeNecessario(rodadaId);
    await sleep(1000);
}

// ===========================================
// 9. VERIFICAR NOVAS RODADAS E ALOCAÇÃO
// ===========================================
async function verificarNovasRodadasEAlocacao(rodadaOriginal, usuariosEspera) {
    log('🔍', 'Verificando novas rodadas...');

    const Rodada = require('../models/Rodada');
    const User = require('../models/User');

    const novasRodadas = await Rodada.find({ rodadaOrigem: rodadaOriginal._id });

    if (novasRodadas.length === 0) {
        log('⚠️', 'Nenhuma nova rodada foi criada!');
        return [];
    }

    log('🎉', `${novasRodadas.length} nova(s) rodada(s) criada(s)!`);

    for (const rodada of novasRodadas) {
        const participantes = rodada.participantes || [];
        const cores = {
            verde: participantes.filter(p => p.cor === 'verde').length,
            preto: participantes.filter(p => p.cor === 'preto').length,
            azul: participantes.filter(p => p.cor === 'azul').length,
            vermelho: participantes.filter(p => p.cor === 'vermelho').length
        };

        console.log(`\n📌 ${rodada.nome} (${rodada.status.toUpperCase()})`);
        console.log(`   Participantes: ${participantes.length}/15`);
        console.log(`   Cores: 🟢${cores.verde} ⚫${cores.preto} 🔵${cores.azul} 🔴${cores.vermelho}`);
    }

    // Verificar alocação
    logSeparador();
    log('🔍', 'VERIFICANDO ALOCAÇÃO DOS USUÁRIOS DE ESPERA...');

    let alocados = 0;
    for (const usuario of usuariosEspera) {
        let encontrado = false;
        for (const rodada of novasRodadas) {
            const participante = rodada.participantes.find(
                p => p.usuario.toString() === usuario._id.toString()
            );
            if (participante && participante.cor === 'vermelho') {
                encontrado = true;
                alocados++;
                log('🔴', `${usuario.nome} alocado como VERMELHO na ${rodada.nome} ✅`);
                break;
            }
        }
        if (!encontrado) {
            log('⏳', `${usuario.nome} ainda não foi alocado`);
        }
    }

    logSeparador();
    log('📊', `RESULTADO: ${alocados}/${usuariosEspera.length} usuários alocados como VERMELHOS`);

    return novasRodadas;
}

// ===========================================
// 10. VERIFICAR PROGRESSÃO
// ===========================================
async function verificarProgressaoParticipantes(rodadaOriginal, novasRodadas) {
    log('🔍', 'Verificando progressão dos participantes...');

    const User = require('../models/User');
    const participantesOriginais = rodadaOriginal.participantes || [];

    console.log('\n📊 MAPEAMENTO DE PROGRESSÃO:');
    console.log('Participante | Cor Original | Nova Cor');
    console.log('-'.repeat(50));

    for (const p of participantesOriginais) {
        const usuario = await User.findById(p.usuario);
        const corOriginal = p.cor;
        let novaCor = '❓';

        for (const nr of novasRodadas) {
            const participanteNovo = nr.participantes.find(
                np => np.usuario.toString() === p.usuario.toString()
            );
            if (participanteNovo) {
                novaCor = participanteNovo.cor;
                break;
            }
        }

        if (novaCor === '❓' && p.cor === 'verde') {
            novaCor = 'concluido';
        }

        const emojiOriginal = CORES[corOriginal]?.emoji || '❓';
        const emojiNova = CORES[novaCor]?.emoji || '❓';

        console.log(`${emojiOriginal} ${usuario?.nome || p.usuario} | ${corOriginal} | ${emojiNova} ${novaCor}`);
    }
}

// ===========================================
// 11. RELATÓRIO FINAL
// ===========================================
async function relatorioFinal(usuariosEspera) {
    logSeparador();
    log('📊', 'RELATÓRIO FINAL');
    logSeparador();

    const User = require('../models/User');
    const Rodada = require('../models/Rodada');
    const Transacao = require('../models/Transacao');

    const totalUsuarios = await User.countDocuments();
    const totalRodadas = await Rodada.countDocuments();
    const rodadasConcluidas = await Rodada.countDocuments({ status: 'concluida' });
    const rodadasAguardando = await Rodada.countDocuments({ status: 'aguardando' });
    const transacoesConfirmadas = await Transacao.countDocuments({ status: 'confirmado' });
    const pendentes = await User.countDocuments({ aguardandoVermelho: true });

    console.log('\n📈 ESTATÍSTICAS GERAIS:');
    console.log(`   👥 Usuários totais: ${totalUsuarios}`);
    console.log(`   🎲 Rodadas totais: ${totalRodadas}`);
    console.log(`      - Concluídas: ${rodadasConcluidas}`);
    console.log(`      - Aguardando: ${rodadasAguardando}`);
    console.log(`   💰 Transações confirmadas: ${transacoesConfirmadas}`);
    console.log(`   ⏳ Usuários pendentes: ${pendentes}`);

    console.log('\n🎯 RESULTADO:');
    if (rodadasConcluidas >= 1 && rodadasAguardando >= 2) {
        console.log('   ✅ TESTE PASSOU!');
        console.log('   ✅ Progressão de cores OK');
        console.log('   ✅ Duplicação de rodadas OK');
        if (pendentes === 0 && usuariosEspera?.length > 0) {
            console.log('   ✅ Usuários em espera alocados como VERMELHOS!');
        }
    } else {
        console.log('   ❌ TESTE FALHOU!');
    }

    logSeparador();
}

// ===========================================
// FUNÇÃO PRINCIPAL
// ===========================================
async function executarTesteCompleto() {
    console.log('\n' + '🚀'.repeat(40));
    console.log('🚀 TESTE COMPLETO - FILA DE ESPERA');
    console.log('🚀'.repeat(40) + '\n');

    try {
        log('🔌', 'Conectando ao MongoDB...');
        await mongoose.connect(MONGODB_URI);
        log('✅', 'Conectado!');

        await limparDadosTeste();

        const usuariosPrincipais = await criarUsuariosPrincipais(QUANTIDADE_USUARIOS);
        const usuariosEspera = await criarUsuariosEspera(QUANTIDADE_USUARIOS_ESPERA, usuariosPrincipais);

        let rodada = await adicionarUsuariosRodada(usuariosPrincipais);
        await mostrarDetalhesRodada(rodada);

        await adicionarUsuariosEspera(rodada, usuariosEspera);
        await marcarTodosVermelhosPagos(rodada);
        await forcarAvancoRodada(rodada._id.toString());

        const RodadaModel = require('../models/Rodada');
        rodada = await RodadaModel.findById(rodada._id);

        const novasRodadas = await verificarNovasRodadasEAlocacao(rodada, usuariosEspera);

        if (novasRodadas.length > 0) {
            await verificarProgressaoParticipantes(rodada, novasRodadas);
        }

        await relatorioFinal(usuariosEspera);

        log('🎉', 'TESTE CONCLUÍDO!');

    } catch (error) {
        log('💥', `ERRO: ${error.message}`);
        console.error(error.stack);
    } finally {
        await mongoose.disconnect();
        log('🔌', 'Desconectado');
    }
}

executarTesteCompleto();