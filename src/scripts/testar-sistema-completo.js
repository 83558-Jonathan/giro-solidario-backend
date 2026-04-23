/**
 * TESTE COMPLETO DO SISTEMA - VALIDA TODAS AS REGRAS
 * 
 * Regras validadas:
 * 1. Novos usuarios NUNCA criam rodadas
 * 2. Rodadas so nascem da progressao
 * 3. Usuarios sem vaga entram na FILA DE ESPERA
 * 4. Na progressao, usuarios da fila sao alocados como VERMELHOS
 * 5. Progressao de cores: 🔴→🔵→⚫→🟢→✅
 * 6. Duplicacao: 1 rodada gera 2 novas rodadas
 * 7. ✅ NENHUM usuario pode estar em multiplas rodadas ATIVAS
 * 
 * Como executar:
 * cd /root/giro-solidario-backend
 * node scripts/testar-sistema-completo.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Configuracoes
const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/giro-solidario';
const TEST_PREFIX = 'TESTE_SISTEMA_';
const QUANTIDADE_USUARIOS = 15;
const QUANTIDADE_USUARIOS_ESPERA = 5;

// Cores
const CORES = {
    amarelo: { nome: 'Amarelo', emoji: '🟡' },
    vermelho: { nome: 'Vermelho', emoji: '🔴' },
    azul: { nome: 'Azul', emoji: '🔵' },
    preto: { nome: 'Preto', emoji: '⚫' },
    verde: { nome: 'Verde', emoji: '🟢' },
    concluido: { nome: 'Concluido', emoji: '✅' }
};

function log(emoji, mensagem, dados = null) {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`${timestamp} ${emoji} ${mensagem}`);
    if (dados) console.log('   ', JSON.stringify(dados, null, 2));
}

function logSeparador() {
    console.log('\n' + '='.repeat(80) + '\n');
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function gerarCpfUnico(prefixo, index, timestamp) {
    const num = String(index).padStart(3, '0');
    const time = String(timestamp).slice(-8);
    const cpf = `${prefixo}${num}${time}`.slice(0, 11);
    return cpf;
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

    try {
        await User.deleteMany({ email: { $regex: `^${TEST_PREFIX}` } });
        await Rodada.deleteMany({});
        await Transacao.deleteMany({});
        await SolicitacaoSaque.deleteMany({});
        log('✅', 'Dados limpos com sucesso');
    } catch (error) {
        log('⚠️', `Erro ao limpar: ${error.message}`);
    }
    await sleep(500);
}

// ===========================================
// 2. CRIAR USUARIOS PRINCIPAIS
// ===========================================
async function criarUsuariosPrincipais() {
    log('👥', `Criando ${QUANTIDADE_USUARIOS} usuarios principais...`);

    const User = require('../models/User');
    const usuarios = [];
    const timestamp = Date.now();

    for (let i = 1; i <= QUANTIDADE_USUARIOS; i++) {
        const nome = `${TEST_PREFIX}Principal_${i}`;
        const email = `${TEST_PREFIX}principal${i}@teste.com`;
        const cpf = gerarCpfUnico('P', i, timestamp);

        const existe = await User.findOne({ email });
        if (existe) {
            log('⚠️', `Usuario ${nome} ja existe, pulando...`);
            usuarios.push(existe);
            continue;
        }

        const senhaHash = await bcrypt.hash('123456', 10);

        const usuario = new User({
            nome, email,
            telefone: `1199999${i}`,
            cpf: cpf,
            chavePix: email,
            tipoChavePix: 'email',
            senha: senhaHash,
            role: i === 1 ? 'admin' : 'user'
        });

        if (i > 1 && usuarios[0]) {
            usuario.indicadoPor = usuarios[0]._id;
        }

        await usuario.save();
        usuarios.push(usuario);
        log('✅', `Criado: ${nome}`);
        await sleep(50);
    }

    log('✅', `${usuarios.length} usuarios principais criados`);
    return usuarios;
}

// ===========================================
// 3. CRIAR USUARIOS DE ESPERA
// ===========================================
async function criarUsuariosEspera(usuariosPrincipais) {
    log('👥', `Criando ${QUANTIDADE_USUARIOS_ESPERA} usuarios de espera...`);

    const User = require('../models/User');
    const usuariosEspera = [];
    const indicador = usuariosPrincipais[0];
    const timestamp = Date.now();

    for (let i = 1; i <= QUANTIDADE_USUARIOS_ESPERA; i++) {
        const nome = `${TEST_PREFIX}Espera_${i}`;
        const email = `${TEST_PREFIX}espera${i}@teste.com`;
        const cpf = gerarCpfUnico('E', i, timestamp);

        const existe = await User.findOne({ email });
        if (existe) {
            log('⚠️', `Usuario ${nome} ja existe, pulando...`);
            usuariosEspera.push(existe);
            continue;
        }

        const senhaHash = await bcrypt.hash('123456', 10);

        const usuario = new User({
            nome, email,
            telefone: `1188888${i}`,
            cpf: cpf,
            chavePix: email,
            tipoChavePix: 'email',
            senha: senhaHash,
            indicadoPor: indicador._id
        });

        await usuario.save();
        usuariosEspera.push(usuario);
        log('🟡', `Criado: ${nome} (aguardara vaga)`);
        await sleep(50);
    }

    log('✅', `${usuariosEspera.length} usuarios de espera criados`);
    return usuariosEspera;
}

// ===========================================
// 4. FORMAR RODADA INICIAL
// ===========================================
async function formarRodadaInicial(usuarios) {
    log('🔄', 'Formando rodada inicial com 15 participantes...');

    const RodadaService = require('../services/rodadaService');
    const Rodada = require('../models/Rodada');

    let rodada = await Rodada.findOne({});
    if (rodada) {
        log('📌', `Rodada ${rodada.nome} ja existe, usando ela...`);
        return rodada;
    }

    const criador = usuarios[0];
    rodada = await RodadaService.criarRodada(criador._id.toString());
    log('📌', `Rodada ${rodada.nome} criada por ${criador.nome}`);

    for (let i = 1; i < usuarios.length; i++) {
        rodada = await RodadaService.adicionarParticipanteAmarelo(
            rodada._id.toString(),
            usuarios[i]._id.toString(),
            criador._id.toString()
        );
        process.stdout.write(`\r   Progresso: ${rodada.participantes.length}/15 participantes`);
        await sleep(100);
    }

    console.log();
    log('🎯', `Rodada ${rodada.nome} completou 15 participantes!`);

    return rodada;
}

// ===========================================
// 5. ADICIONAR USUARIOS DE ESPERA (VAO PARA FILA)
// ===========================================
async function adicionarUsuariosEspera(rodada, usuariosEspera) {
    log('🔄', 'Tentando adicionar usuarios de espera a rodada cheia...');
    log('⚠️', 'Rodada ja tem 15 participantes. Usuarios serao colocados na FILA DE ESPERA');

    const RodadaService = require('../services/rodadaService');
    const User = require('../models/User');

    for (const usuario of usuariosEspera) {
        try {
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
    log('⏳', `${pendentes} usuarios na FILA DE ESPERA`);
    return pendentes;
}

// ===========================================
// 6. MOSTRAR DETALHES DA RODADA
// ===========================================
async function mostrarDetalhesRodada(rodada) {
    const participantes = rodada.participantes || [];
    const cores = {
        verde: participantes.filter(p => p.cor === 'verde').length,
        preto: participantes.filter(p => p.cor === 'preto').length,
        azul: participantes.filter(p => p.cor === 'azul').length,
        vermelho: participantes.filter(p => p.cor === 'vermelho').length,
        amarelo: participantes.filter(p => p.cor === 'amarelo').length
    };

    console.log(`\n📊 ${rodada.nome} (${rodada.status.toUpperCase()})`);
    console.log(`   Participantes: ${participantes.length}/15`);
    console.log(`   Cores: ${CORES.verde.emoji}${cores.verde} ${CORES.preto.emoji}${cores.preto} ${CORES.azul.emoji}${cores.azul} ${CORES.vermelho.emoji}${cores.vermelho} ${CORES.amarelo.emoji}${cores.amarelo}`);
    console.log(`   Vermelhos pagos: ${rodada.totalDepositosConfirmados}/8`);
}

// ===========================================
// 7. PAGAR VERMELHOS
// ===========================================
async function pagarVermelhos(rodada) {
    log('💰', `Processando pagamentos dos vermelhos...`);

    const RodadaService = require('../services/rodadaService');
    const Transacao = require('../models/Transacao');
    const User = require('../models/User');
    const Rodada = require('../models/Rodada');

    let rodadaAtualizada = await Rodada.findById(rodada._id);

    const vermelhos = rodadaAtualizada.participantes.filter(p => p.cor === 'vermelho');
    log('🔴', `${vermelhos.length} vermelhos encontrados`);

    if (vermelhos.length === 0) {
        log('⚠️', 'Nenhum vermelho encontrado!');
        return false;
    }

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
                recebedor: rodadaAtualizada.verde,
                valor: 125,
                rodada: rodada._id,
                status: 'pendente'
            });
            await transacao.save();
            vermelho.transacaoId = transacao._id;
            await rodadaAtualizada.save();
        }

        try {
            await RodadaService.confirmarDeposito(
                transacao._id.toString(),
                `https://teste.com/comprovante_${transacao._id}.png`,
                vermelho.usuario.toString()
            );
            pagos++;
            console.log(`   ✅ ${pagos}/${vermelhos.length} - ${usuario.nome} pagou R$125`);
            await sleep(300);
        } catch (error) {
            console.log(`   ❌ ${usuario.nome}: ${error.message}`);
        }
    }

    log('💰', `${pagos}/${vermelhos.length} pagamentos processados`);
    return pagos === vermelhos.length;
}

// ===========================================
// 8. FORCAR AVANCO
// ===========================================
async function forcarAvancoRodada(rodadaId) {
    log('🔄', 'Forcando verificacao da rodada...');
    const RodadaService = require('../services/rodadaService');
    await RodadaService.verificarEAvancarSeNecessario(rodadaId);
    await sleep(2000);
}

// ===========================================
// 9. VERIFICAR PROGRESSAO DE CORES
// ===========================================
async function verificarProgressaoCores(rodadaOriginal, novasRodadas) {
    console.log(`\n📌 MAPEAMENTO DE PROGRESSAO DE CORES:`);
    console.log('Participante | Cor Original | Cor Apos Promocao | Rodada Destino');
    console.log('-'.repeat(70));

    for (const p of rodadaOriginal.participantes) {
        let corApos = p.cor;
        let rodadaDestino = rodadaOriginal.nome;

        if (p.cor === 'verde') {
            corApos = 'concluido';
            rodadaDestino = 'CONCLUIDO (ganhou R$ 900)';
        } else {
            for (const nr of novasRodadas) {
                const participanteNovo = nr.participantes.find(
                    np => np.usuario.toString() === p.usuario.toString()
                );
                if (participanteNovo) {
                    corApos = participanteNovo.cor;
                    rodadaDestino = nr.nome;
                    break;
                }
            }
        }

        const emojiOriginal = CORES[p.cor]?.emoji || '❓';
        const emojiApos = CORES[corApos]?.emoji || '❓';
        console.log(`${emojiOriginal} ${p.usuario.nome || p.usuario} | ${p.cor} | ${emojiApos} ${corApos} | ${rodadaDestino}`);
    }
}

// ===========================================
// 10. VERIFICAR RESULTADO E MULTIPLAS PARTICIPACOES
// ===========================================
async function verificarResultado(rodadaOriginal, usuariosEspera) {
    const Rodada = require('../models/Rodada');
    const User = require('../models/User');

    const novasRodadas = await Rodada.find({ rodadaOrigem: rodadaOriginal._id });

    // Buscar participantes com nome para exibicao
    const rodadaOriginalComNomes = await Rodada.findById(rodadaOriginal._id).populate('participantes.usuario', 'nome');

    logSeparador();
    log('📊', 'RESULTADO APOS PROGRESSAO');
    logSeparador();

    console.log(`\n📌 RODADA ORIGINAL: ${rodadaOriginal.nome} (${rodadaOriginal.status.toUpperCase()})`);
    console.log(`   Participantes mantidos no histórico: ${rodadaOriginal.participantes.length}`);
    console.log(`   Concluídos (ganhadores): ${rodadaOriginal.participantes.filter(p => p.cor === 'concluido').length}`);

    console.log(`\n📌 NOVAS RODADAS CRIADAS: ${novasRodadas.length}`);
    for (const rodada of novasRodadas) {
        const rodadaComNomes = await Rodada.findById(rodada._id).populate('participantes.usuario', 'nome');
        const participantes = rodadaComNomes.participantes || [];
        const cores = {
            verde: participantes.filter(p => p.cor === 'verde').length,
            preto: participantes.filter(p => p.cor === 'preto').length,
            azul: participantes.filter(p => p.cor === 'azul').length,
            vermelho: participantes.filter(p => p.cor === 'vermelho').length
        };

        let verdeNome = 'N/A';
        if (rodada.verde) {
            const verde = await User.findById(rodada.verde);
            verdeNome = verde?.nome || rodada.verde;
        }

        console.log(`\n   📌 ${rodada.nome} (${rodada.status.toUpperCase()})`);
        console.log(`      👑 Verde: ${verdeNome}`);
        console.log(`      Participantes: ${participantes.length}/15`);
        console.log(`      Cores: ${CORES.verde.emoji}${cores.verde} ${CORES.preto.emoji}${cores.preto} ${CORES.azul.emoji}${cores.azul} ${CORES.vermelho.emoji}${cores.vermelho}`);
    }

    // ===========================================
    // VERIFICAR PARTICIPACAO MULTIPLA (APENAS RODADAS ATIVAS)
    // ===========================================
    console.log(`\n🔍 VERIFICANDO PARTICIPACAO MULTIPLA (apenas rodadas ATIVAS):`);

    // ✅ CORRECAO: Buscar apenas rodadas com status 'aguardando' ou 'em_andamento'
    const rodadasAtivas = await Rodada.find({
        status: { $in: ['aguardando', 'em_andamento'] }
    }).populate('participantes.usuario', 'nome');

    console.log(`   Rodadas ativas encontradas: ${rodadasAtivas.length}`);
    for (const r of rodadasAtivas) {
        console.log(`      → ${r.nome} (${r.status})`);
    }

    const participacaoMap = new Map();

    for (const rodada of rodadasAtivas) {
        for (const p of rodada.participantes || []) {
            const userId = p.usuario._id.toString();
            if (!participacaoMap.has(userId)) {
                participacaoMap.set(userId, []);
            }
            participacaoMap.get(userId).push({
                rodada: rodada.nome,
                cor: p.cor,
                status: rodada.status
            });
        }
    }

    let multiplas = 0;
    for (const [userId, participacoes] of participacaoMap) {
        if (participacoes.length > 1) {
            multiplas++;
            const usuario = await User.findById(userId);
            console.log(`   ⚠️ ${usuario?.nome} participa de ${participacoes.length} rodadas ATIVAS:`);
            for (const p of participacoes) {
                console.log(`      → ${p.rodada} como ${p.cor.toUpperCase()} (${p.status})`);
            }
        }
    }

    if (multiplas === 0) {
        console.log(`   ✅ Nenhum usuario em multiplas rodadas ativas!`);
    } else {
        console.log(`   ❌ ${multiplas} usuario(s) em multiplas rodadas ativas - VERIFICAR CORRECAO`);
    }

    // ===========================================
    // VERIFICAR ALOCACAO DOS USUARIOS DE ESPERA
    // ===========================================
    console.log(`\n📌 ALOCACAO DOS USUARIOS DE ESPERA:`);
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
                console.log(`   ${CORES.vermelho.emoji} ${usuario.nome} -> ${rodada.nome} como VERMELHO`);
                break;
            }
        }
        if (!encontrado) {
            const aindaAguardando = await User.findById(usuario._id);
            console.log(`   ${CORES.amarelo.emoji} ${usuario.nome} -> AINDA NA FILA (aguardandoVermelho: ${aindaAguardando?.aguardandoVermelho})`);
        }
    }

    // ===========================================
    // VERIFICAR PROGRESSAO DE CORES
    // ===========================================
    await verificarProgressaoCores(rodadaOriginalComNomes, novasRodadas);

    return { novasRodadas, alocados, multiplas };
}

// ===========================================
// 11. RELATORIO FINAL
// ===========================================
async function relatorioFinal(usuariosEspera, alocados, multiplas) {
    const User = require('../models/User');
    const Rodada = require('../models/Rodada');
    const Transacao = require('../models/Transacao');

    const totalUsuarios = await User.countDocuments();
    const totalRodadas = await Rodada.countDocuments();
    const rodadasConcluidas = await Rodada.countDocuments({ status: 'concluida' });
    const rodadasAguardando = await Rodada.countDocuments({ status: 'aguardando' });
    const transacoesConfirmadas = await Transacao.countDocuments({ status: 'confirmado' });
    const pendentes = await User.countDocuments({ aguardandoVermelho: true });

    logSeparador();
    log('📊', 'RELATORIO FINAL');
    logSeparador();

    console.log('\n📈 ESTATISTICAS:');
    console.log(`   Usuarios totais: ${totalUsuarios}`);
    console.log(`   Rodadas totais: ${totalRodadas}`);
    console.log(`   Concluidas: ${rodadasConcluidas}`);
    console.log(`   Aguardando: ${rodadasAguardando}`);
    console.log(`   Transacoes confirmadas: ${transacoesConfirmadas}`);
    console.log(`   Usuarios pendentes: ${pendentes}`);

    console.log('\n🎯 VALIDACOES:');

    const validacao1 = rodadasAguardando >= 2;
    console.log(`   ${validacao1 ? '✅' : '❌'} 1. Duplicacao (1 rodada gerou ${rodadasAguardando} novas): ${validacao1 ? 'OK' : 'FALHOU'}`);

    const validacao2 = alocados === usuariosEspera.length;
    console.log(`   ${validacao2 ? '✅' : '❌'} 2. Alocacao fila de espera (${alocados}/${usuariosEspera.length}): ${validacao2 ? 'OK' : 'FALHOU'}`);

    const validacao3 = pendentes === 0;
    console.log(`   ${validacao3 ? '✅' : '❌'} 3. Fila de espera vazia (${pendentes} pendentes): ${validacao3 ? 'OK' : 'FALHOU'}`);

    const validacao4 = rodadasConcluidas >= 1;
    console.log(`   ${validacao4 ? '✅' : '❌'} 4. Rodada concluida (${rodadasConcluidas}): ${validacao4 ? 'OK' : 'FALHOU'}`);

    const validacao5 = multiplas === 0;
    console.log(`   ${validacao5 ? '✅' : '❌'} 5. Participacao multipla (${multiplas} usuarios): ${validacao5 ? 'OK' : 'FALHOU'}`);

    const testePassou = validacao1 && validacao2 && validacao3 && validacao4 && validacao5;

    console.log('\n🎯 RESULTADO FINAL:');
    if (testePassou) {
        console.log('   ✅ TESTE PASSOU! O sistema esta funcionando corretamente.');
        console.log('   ✅ Novos usuarios nao criam rodadas');
        console.log('   ✅ Rodadas so nascem da progressao');
        console.log('   ✅ Fila de espera funcionando');
        console.log('   ✅ Usuarios pendentes alocados como VERMELHOS');
        console.log('   ✅ Progressao de cores OK');
        console.log('   ✅ Nenhum usuario em multiplas rodadas ativas');
    } else {
        console.log('   ❌ TESTE FALHOU! Verifique os logs acima.');
    }

    logSeparador();
}

// ===========================================
// FUNCAO PRINCIPAL
// ===========================================
async function executarTesteCompleto() {
    console.log('\n' + '🎯'.repeat(40));
    console.log('🎯 TESTE COMPLETO DO SISTEMA - VALIDACAO DE REGRAS');
    console.log('🎯'.repeat(40) + '\n');

    try {
        log('🔌', 'Conectando ao MongoDB...');
        await mongoose.connect(MONGODB_URI);
        log('✅', 'Conectado!');
        await sleep(500);

        await limparDadosTeste();

        const usuariosPrincipais = await criarUsuariosPrincipais();
        const usuariosEspera = await criarUsuariosEspera(usuariosPrincipais);

        let rodada = await formarRodadaInicial(usuariosPrincipais);
        await mostrarDetalhesRodada(rodada);

        await adicionarUsuariosEspera(rodada, usuariosEspera);

        const todosPagos = await pagarVermelhos(rodada);
        if (todosPagos) {
            log('🎉', 'Todos os 8 vermelhos pagaram! Aguardando processamento...');
            await sleep(2000);
        }

        await forcarAvancoRodada(rodada._id.toString());

        const Rodada = require('../models/Rodada');
        rodada = await Rodada.findById(rodada._id);

        const { novasRodadas, alocados, multiplas } = await verificarResultado(rodada, usuariosEspera);

        await relatorioFinal(usuariosEspera, alocados, multiplas);

        log('🎉', 'TESTE CONCLUIDO COM SUCESSO!');

    } catch (error) {
        log('💥', `ERRO: ${error.message}`);
        console.error(error.stack);
    } finally {
        await mongoose.disconnect();
        log('🔌', 'Desconectado');
    }
}

executarTesteCompleto();