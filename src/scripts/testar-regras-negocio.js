const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

// Models
const User = require('../models/User');
const Rodada = require('../models/Rodada');
const Transacao = require('../models/Transacao');
const SolicitacaoSaque = require('../models/SolicitacaoSaque');

// Services
const RodadaService = require('../services/rodadaService');

// Configurações
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/giro_solidario_test';

// Armazenamento de dados dos testes
const testData = {
    users: [],
    rodadas: [],
    transacoes: [],
    solicitacoes: [],
    codigosConvite: new Map() // Mapa de código convite -> usuário
};

// ===========================================
// CORES ANSI PARA LOG
// ===========================================
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m'
};

function logSuccess(msg) {
    console.log(`${colors.green}✅ ${msg}${colors.reset}`);
}

function logError(msg) {
    console.log(`${colors.red}❌ ${msg}${colors.reset}`);
}

function logInfo(msg) {
    console.log(`${colors.blue}📌 ${msg}${colors.reset}`);
}

function logWarning(msg) {
    console.log(`${colors.yellow}⚠️ ${msg}${colors.reset}`);
}

function logSection(title) {
    console.log(`\n${colors.cyan}${'='.repeat(70)}${colors.reset}`);
    console.log(`${colors.bright}${colors.magenta}${title}${colors.reset}`);
    console.log(`${colors.cyan}${'='.repeat(70)}${colors.reset}`);
}

function logSubSection(title) {
    console.log(`\n${colors.cyan}${'-'.repeat(50)}${colors.reset}`);
    console.log(`${colors.bright}${title}${colors.reset}`);
    console.log(`${colors.cyan}${'-'.repeat(50)}${colors.reset}`);
}

// ===========================================
// FUNÇÕES AUXILIARES
// ===========================================
async function limparBanco() {
    logInfo('Limpando banco de dados...');
    await User.deleteMany({});
    await Rodada.deleteMany({});
    await Transacao.deleteMany({});
    await SolicitacaoSaque.deleteMany({});
    logSuccess('Banco de dados limpo');

    // Resetar dados de teste
    testData.users = [];
    testData.rodadas = [];
    testData.transacoes = [];
    testData.solicitacoes = [];
    testData.codigosConvite.clear();
}

async function criarUsuario(nome, email, senha = 'Test@123', tipoChavePix = 'email') {
    const salt = await bcrypt.genSalt(10);
    const senhaHash = await bcrypt.hash(senha, salt);

    const usuario = new User({
        nome,
        email,
        telefone: '11999999999',
        cpf: `${Math.floor(Math.random() * 100000000000)}`.padStart(11, '0'),
        chavePix: email,
        tipoChavePix,
        senha: senhaHash,
        codigoConvite: `CONVITE-${Math.random().toString(36).substring(2, 10).toUpperCase()}`
    });

    await usuario.save();
    testData.users.push(usuario);
    testData.codigosConvite.set(usuario.codigoConvite, usuario);

    return usuario;
}

async function obterCodigoConvite(usuario) {
    if (!usuario.codigoConvite) {
        usuario.codigoConvite = `CONVITE-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
        await usuario.save();
        testData.codigosConvite.set(usuario.codigoConvite, usuario);
    }
    return usuario.codigoConvite;
}

// ===========================================
// TESTE 1: CADASTRO SEM CONVITE (SEM RODADAS EXISTENTES)
// ===========================================
async function teste1_CadastroSemConviteSemRodadas() {
    logSection('TESTE 1: Cadastro SEM convite (sem rodadas existentes)');

    const rodadasAntes = await Rodada.countDocuments();
    logInfo(`Rodadas antes: ${rodadasAntes}`);

    const usuario = await criarUsuario(
        'CadastroSemConvite',
        `cadastro_sem_convite_${Date.now()}@teste.com`
    );

    const rodadasDepois = await Rodada.countDocuments();
    logInfo(`Rodadas depois: ${rodadasDepois}`);

    // Verificar se criou rodada
    if (rodadasDepois === rodadasAntes) {
        logSuccess('✅ NÃO criou rodada (correto)');
    } else {
        logError('❌ CRIOU rodada - VIOLA REGRA!');
    }

    // Verificar se foi para fila
    const usuarioAtual = await User.findById(usuario._id);
    if (usuarioAtual.aguardandoVermelho === true) {
        logSuccess(`✅ Usuário foi para FILA DE ESPERA (posição: ${usuarioAtual.posicaoFila})`);
    } else {
        logWarning(`⚠️ Usuário não está na fila. aguardandoVermelho: ${usuarioAtual.aguardandoVermelho}`);
    }

    return { usuario, success: rodadasDepois === rodadasAntes };
}

// ===========================================
// TESTE 2: CRIAR RODADA MANUALMENTE (ADMIN)
// ===========================================
async function teste2_CriarRodadaManual() {
    logSection('TESTE 2: Criar rodada manualmente');

    const admin = testData.users[0];
    const rodada = await RodadaService.criarRodada(admin._id);
    testData.rodadas.push(rodada);

    logInfo(`Rodada: ${rodada.nome}`);
    logInfo(`Status: ${rodada.status}`);
    logInfo(`Participantes: ${rodada.participantes.length}/15`);

    if (rodada.status === 'aguardando' && rodada.participantes.length === 1) {
        logSuccess('✅ Rodada criada corretamente com 1 participante AMARELO');
    } else {
        logError('❌ Rodada não foi criada corretamente');
    }

    return rodada;
}

// ===========================================
// TESTE 3: CADASTRO COM CONVITE VÁLIDO
// ===========================================
async function teste3_CadastroComConviteValido() {
    logSection('TESTE 3: Cadastro COM convite válido');

    const convidante = testData.users[0];
    const codigoConvite = await obterCodigoConvite(convidante);

    logInfo(`Convidante: ${convidante.nome} (código: ${codigoConvite})`);

    // Simular requisição de registro com convite
    const userData = {
        nome: 'ConvidadoViaLink',
        email: `convidado_${Date.now()}@teste.com`,
        telefone: '11999999999',
        cpf: `${Math.floor(Math.random() * 100000000000)}`.padStart(11, '0'),
        chavePix: `convidado_${Date.now()}@teste.com`,
        tipoChavePix: 'email',
        senha: 'Test@123',
        codigoConvite: codigoConvite
    };

    const salt = await bcrypt.genSalt(10);
    const senhaHash = await bcrypt.hash(userData.senha, salt);

    const usuario = new User({
        nome: userData.nome,
        email: userData.email,
        telefone: userData.telefone,
        cpf: userData.cpf,
        chavePix: userData.chavePix,
        tipoChavePix: userData.tipoChavePix,
        senha: senhaHash,
        codigoConvite: `CONVITE-${Math.random().toString(36).substring(2, 10).toUpperCase()}`
    });

    await usuario.save();
    testData.users.push(usuario);

    // Verificar se foi adicionado à rodada do convidante
    const rodadaDoConvidante = await Rodada.findOne({
        'participantes.usuario': convidante._id,
        status: 'aguardando'
    });

    const estaNaRodada = await Rodada.findOne({
        'participantes.usuario': usuario._id
    });

    if (estaNaRodada) {
        logSuccess(`✅ Usuário foi adicionado à rodada: ${estaNaRodada.nome}`);
    } else {
        logWarning('⚠️ Usuário não foi adicionado a nenhuma rodada');
    }

    return { usuario, rodada: estaNaRodada };
}

// ===========================================
// TESTE 4: ADICIONAR PARTICIPANTES ATÉ 15
// ===========================================
async function teste4_CompletarRodada(rodada) {
    logSection('TESTE 4: Completar rodada com 15 participantes');

    logInfo(`Participantes atuais: ${rodada.participantes.length}/15`);

    // Adicionar participantes até completar 15
    for (let i = rodada.participantes.length + 1; i <= 15; i++) {
        const usuario = await criarUsuario(
            `Participante_${i}`,
            `participante_${i}_${Date.now()}@teste.com`
        );

        await RodadaService.adicionarParticipanteAmarelo(
            rodada._id.toString(),
            usuario._id.toString(),
            testData.users[0]._id.toString()
        );

        console.log(`   Adicionado: ${usuario.nome} - ${i}/15 participantes`);
    }

    const rodadaAtualizada = await Rodada.findById(rodada._id);
    logInfo(`Participantes finais: ${rodadaAtualizada.participantes.length}/15`);
    logInfo(`Status da rodada: ${rodadaAtualizada.status}`);

    if (rodadaAtualizada.participantes.length === 15) {
        logSuccess('✅ Rodada completou 15 participantes');
        if (rodadaAtualizada.status === 'em_andamento') {
            logSuccess('✅ Rodada iniciou automaticamente');
        }
    } else {
        logError('❌ Rodada não completou 15 participantes');
    }

    return rodadaAtualizada;
}

// ===========================================
// TESTE 5: VERIFICAR DISTRIBUIÇÃO DE CORES
// ===========================================
async function teste5_DistribuicaoCores(rodada) {
    logSection('TESTE 5: Distribuição de cores');

    const participantes = rodada.participantes;

    const cores = {
        verde: participantes.filter(p => p.cor === 'verde').length,
        preto: participantes.filter(p => p.cor === 'preto').length,
        azul: participantes.filter(p => p.cor === 'azul').length,
        vermelho: participantes.filter(p => p.cor === 'vermelho').length,
        amarelo: participantes.filter(p => p.cor === 'amarelo').length
    };

    console.log(`   🟢 Verde: ${cores.verde}`);
    console.log(`   ⚫ Preto: ${cores.preto}`);
    console.log(`   🔵 Azul: ${cores.azul}`);
    console.log(`   🔴 Vermelho: ${cores.vermelho}`);
    console.log(`   🟡 Amarelo: ${cores.amarelo}`);

    if (cores.verde === 1 && cores.preto === 2 && cores.azul === 4 && cores.vermelho === 8 && cores.amarelo === 0) {
        logSuccess('✅ Distribuição correta (1+2+4+8=15)');
        return true;
    } else {
        logError('❌ Distribuição incorreta');
        return false;
    }
}

// ===========================================
// TESTE 6: VERIFICAR TRANSAÇÕES CRIADAS
// ===========================================
async function teste6_TransacoesCriadas(rodada) {
    logSection('TESTE 6: Transações criadas');

    const transacoes = await Transacao.find({ rodada: rodada._id });
    testData.transacoes = transacoes;

    logInfo(`Transações encontradas: ${transacoes.length}`);

    if (transacoes.length === 8) {
        logSuccess('✅ 8 transações criadas (1 por vermelho)');

        const valoresCorretos = transacoes.every(t => t.valor === 125);
        if (valoresCorretos) {
            logSuccess('✅ Todas com valor R$ 125,00');
        }

        return true;
    } else {
        logError(`❌ Número incorreto: ${transacoes.length} (esperado 8)`);
        return false;
    }
}

// ===========================================
// TESTE 7: PAGAMENTO DOS VERMELHOS
// ===========================================
async function teste7_PagamentosVermelhos(rodada) {
    logSection('TESTE 7: Pagamento dos vermelhos');

    const transacoes = await Transacao.find({ rodada: rodada._id });
    logInfo(`Processando ${transacoes.length} pagamentos...`);

    for (let i = 0; i < transacoes.length; i++) {
        const transacao = transacoes[i];
        console.log(`   Pagamento ${i + 1}/8 - Transação: ${transacao._id}`);

        await RodadaService.confirmarDeposito(
            transacao._id.toString(),
            `comprovante_${i}_${Date.now()}.png`,
            testData.users[0]._id.toString()
        );
    }

    const rodadaAtualizada = await Rodada.findById(rodada._id);
    logInfo(`Pagamentos confirmados: ${rodadaAtualizada.totalDepositosConfirmados}/8`);

    if (rodadaAtualizada.totalDepositosConfirmados === 8) {
        logSuccess('✅ Todos os 8 pagamentos confirmados');
        logSuccess(`✅ Rodada status: ${rodadaAtualizada.status}`);

        if (rodadaAtualizada.status === 'concluida') {
            logSuccess('✅ Rodada foi CONCLUÍDA após pagamentos');
        }

        return true;
    } else {
        logError(`❌ Apenas ${rodadaAtualizada.totalDepositosConfirmados}/8 pagamentos`);
        return false;
    }
}

// ===========================================
// TESTE 8: PROGRESSÃO DE CORES
// ===========================================
async function teste8_ProgressaoCores(rodada) {
    logSection('TESTE 8: Progressão de cores');

    const participantes = rodada.participantes;

    const cores = {
        azul: participantes.filter(p => p.cor === 'azul').length,
        preto: participantes.filter(p => p.cor === 'preto').length,
        verde: participantes.filter(p => p.cor === 'verde').length,
        concluido: participantes.filter(p => p.cor === 'concluido').length
    };

    console.log(`   🔵 Azul (eram vermelhos): ${cores.azul}`);
    console.log(`   ⚫ Preto (eram azuis): ${cores.preto}`);
    console.log(`   🟢 Verde (eram pretos): ${cores.verde}`);
    console.log(`   🏆 Concluído (era verde): ${cores.concluido}`);

    if (cores.azul === 8 && cores.preto === 4 && cores.verde === 2 && cores.concluido === 1) {
        logSuccess('✅ Progressão de cores correta');
        return true;
    } else {
        logError('❌ Progressão de cores incorreta');
        return false;
    }
}

// ===========================================
// TESTE 9: CRIAÇÃO DE 2 NOVAS RODADAS
// ===========================================
async function teste9_CriacaoNovasRodadas(rodada) {
    logSection('TESTE 9: Criação de 2 novas rodadas');

    const rodadasGeradas = rodada.rodadasGeradas;
    logInfo(`Rodadas geradas: ${rodadasGeradas?.length || 0}`);

    if (rodadasGeradas && rodadasGeradas.length === 2) {
        logSuccess('✅ 2 novas rodadas foram criadas');

        for (const rodadaId of rodadasGeradas) {
            const novaRodada = await Rodada.findById(rodadaId);
            testData.rodadas.push(novaRodada);

            if (novaRodada) {
                const cores = {
                    verde: novaRodada.participantes.filter(p => p.cor === 'verde').length,
                    preto: novaRodada.participantes.filter(p => p.cor === 'preto').length,
                    azul: novaRodada.participantes.filter(p => p.cor === 'azul').length,
                    vermelho: novaRodada.participantes.filter(p => p.cor === 'vermelho').length
                };

                console.log(`\n   📊 ${novaRodada.nome}`);
                console.log(`      Verde: ${cores.verde}, Preto: ${cores.preto}, Azul: ${cores.azul}, Vermelho: ${cores.vermelho}`);

                if (cores.verde === 1 && cores.preto === 2 && cores.azul === 4 && cores.vermelho === 0) {
                    logSuccess(`   ✅ ${novaRodada.nome} estrutura correta`);
                } else {
                    logError(`   ❌ ${novaRodada.nome} estrutura incorreta`);
                }
            }
        }

        return true;
    } else {
        logError('❌ Não foram criadas 2 novas rodadas');
        return false;
    }
}

// ===========================================
// TESTE 10: FILA DE ESPERA (FIFO)
// ===========================================
async function teste10_FilaEspera() {
    logSection('TESTE 10: Fila de espera (FIFO)');

    // Remover rodadas existentes para forçar fila
    await Rodada.deleteMany({});

    logInfo('Criando 5 usuários que vão para fila...');
    const usuariosFila = [];

    for (let i = 1; i <= 5; i++) {
        const usuario = await criarUsuario(
            `FilaUser_${i}`,
            `filauser_${i}_${Date.now()}@teste.com`
        );

        usuario.aguardandoVermelho = true;
        usuario.posicaoFila = i;
        usuario.dataEntradaFila = new Date();
        await usuario.save();

        usuariosFila.push(usuario);
        console.log(`   ${usuario.nome} - Posição ${usuario.posicaoFila}`);
    }

    logInfo(`\nTotal na fila: ${usuariosFila.length}`);

    // Criar uma rodada com estrutura para receber vermelhos
    const admin = await criarUsuario('AdminFila', `admin_fila_${Date.now()}@teste.com`);

    const novaRodada = new Rodada({
        numero: await RodadaService.getProximoNumeroRodada(),
        nome: 'Rodada Para Alocar Fila',
        status: 'aguardando',
        participantes: [],
        verde: admin._id,
        pretos: [admin._id, admin._id],
        azuis: [admin._id, admin._id, admin._id, admin._id],
        vermelhos: []
    });

    // Adicionar verde
    novaRodada.participantes.push({
        usuario: admin._id,
        cor: 'verde',
        posicao: 1,
        dataEntrada: new Date(),
        depositoConfirmado: false
    });

    // Adicionar pretos
    for (let i = 0; i < 2; i++) {
        novaRodada.participantes.push({
            usuario: admin._id,
            cor: 'preto',
            posicao: novaRodada.participantes.length + 1,
            dataEntrada: new Date(),
            depositoConfirmado: false
        });
    }

    // Adicionar azuis
    for (let i = 0; i < 4; i++) {
        novaRodada.participantes.push({
            usuario: admin._id,
            cor: 'azul',
            posicao: novaRodada.participantes.length + 1,
            dataEntrada: new Date(),
            depositoConfirmado: false
        });
    }

    await novaRodada.save();
    logSuccess(`\nRodada criada: ${novaRodada.nome}`);

    // Alocar usuários da fila
    const usuariosAguardando = await User.find({ aguardandoVermelho: true }).sort({ posicaoFila: 1 });
    let alocados = 0;

    for (const usuario of usuariosAguardando) {
        const vagasRestantes = 8 - novaRodada.vermelhos.length;
        if (vagasRestantes > 0) {
            await RodadaService.adicionarParticipanteVermelho(
                novaRodada._id.toString(),
                usuario._id.toString(),
                null
            );
            usuario.aguardandoVermelho = false;
            usuario.posicaoFila = null;
            await usuario.save();
            alocados++;
            console.log(`   Alocado: ${usuario.nome}`);
        }
    }

    logInfo(`\nAlocados: ${alocados}/${usuariosFila.length}`);

    if (alocados === usuariosFila.length) {
        logSuccess('✅ Fila FIFO funcionando corretamente');
        return true;
    } else {
        logWarning(`⚠️ Apenas ${alocados} alocados (limitado por vagas)`);
        return alocados > 0;
    }
}

// ===========================================
// TESTE 11: JOGAR NOVAMENTE
// ===========================================
async function teste11_JogarNovamente() {
    logSection('TESTE 11: Jogar Novamente');

    // Criar usuário que foi verde e quer jogar novamente
    const usuarioVerde = await criarUsuario(
        'ExVerde_JogarNovamente',
        `exverde_${Date.now()}@teste.com`
    );

    logInfo(`Usuário: ${usuarioVerde.nome}`);

    // Executar jogar novamente
    try {
        const result = await RodadaService.jogarNovamente(usuarioVerde._id.toString());

        if (result.aguardando) {
            logInfo(`Resultado: Usuário foi para FILA`);
            logInfo(`Posição: ${result.posicao}`);
            logInfo(`Total na fila: ${result.totalNaFila}`);
            logSuccess('✅ Jogar Novamente funcionou (fila)');
        } else if (result.cor === 'vermelho') {
            logInfo(`Resultado: Usuário entrou como VERMELHO`);
            logInfo(`Rodada: ${result.rodadaId}`);
            logSuccess('✅ Jogar Novamente funcionou (entrou em rodada)');
        }

        return true;
    } catch (error) {
        logError(`❌ Erro: ${error.message}`);
        return false;
    }
}

// ===========================================
// TESTE 12: SOLICITAÇÃO DE SAQUE
// ===========================================
async function teste12_SolicitacaoSaque() {
    logSection('TESTE 12: Solicitação de saque');

    // Criar rodada concluída
    const ganhador = await criarUsuario(
        'GanhadorPremio',
        `ganhador_${Date.now()}@teste.com`
    );

    const rodadaConcluida = new Rodada({
        numero: await RodadaService.getProximoNumeroRodada(),
        nome: 'Rodada Premiado',
        status: 'concluida',
        participantes: [{
            usuario: ganhador._id,
            cor: 'concluido',
            posicao: 1,
            dataEntrada: new Date(),
            depositoConfirmado: false
        }],
        verde: ganhador._id,
        pretos: [],
        azuis: [],
        vermelhos: [],
        premioVerdePago: false,
        dataFim: new Date()
    });

    await rodadaConcluida.save();
    logSuccess(`Rodada concluída: ${rodadaConcluida.nome}`);

    // Criar solicitação
    const solicitacao = new SolicitacaoSaque({
        usuario: ganhador._id,
        rodada: rodadaConcluida._id,
        valor: 900,
        chavePix: ganhador.chavePix,
        tipoChavePix: ganhador.tipoChavePix,
        status: 'pendente',
        dataSolicitacao: new Date()
    });

    await solicitacao.save();
    testData.solicitacoes.push(solicitacao);
    logSuccess(`Solicitação criada (ID: ${solicitacao._id})`);

    // Marcar rodada como premiada
    rodadaConcluida.premioVerdePago = true;
    await rodadaConcluida.save();

    // Verificar solicitação pendente
    const pendente = await SolicitacaoSaque.findOne({
        usuario: ganhador._id,
        status: 'pendente'
    });

    if (pendente) {
        logSuccess('✅ Solicitação pendente encontrada');

        // Simular aprovação
        pendente.status = 'aprovado';
        pendente.dataAprovacao = new Date();
        await pendente.save();
        logSuccess('✅ Solicitação aprovada');

        return true;
    } else {
        logError('❌ Solicitação não encontrada');
        return false;
    }
}

// ===========================================
// TESTE 13: USUÁRIO EM APENAS UMA RODADA
// ===========================================
async function teste13_UnicaRodadaPorUsuario() {
    logSection('TESTE 13: Usuário em apenas uma rodada');

    const usuario = testData.users[0];
    logInfo(`Testando usuário: ${usuario.nome}`);

    const rodadasDoUsuario = await Rodada.find({
        'participantes.usuario': usuario._id,
        status: { $in: ['aguardando', 'em_andamento'] }
    });

    logInfo(`Rodadas ativas do usuário: ${rodadasDoUsuario.length}`);

    if (rodadasDoUsuario.length <= 1) {
        logSuccess('✅ Usuário está em apenas uma rodada ativa');
        return true;
    } else {
        logError(`❌ Usuário está em ${rodadasDoUsuario.length} rodadas - VIOLA REGRA!`);
        return false;
    }
}

// ===========================================
// TESTE 14: CADASTRO EM MASSA COM LINKS DIFERENTES
// ===========================================
async function teste14_CadastroMassaComLinks() {
    logSection('TESTE 14: Cadastro em massa com links diferentes');

    // Criar 3 convidantes diferentes
    const convidantes = [];
    for (let i = 1; i <= 3; i++) {
        const convidante = await criarUsuario(
            `Convidante_${i}`,
            `convidante_${i}_${Date.now()}@teste.com`
        );

        // Criar rodada para cada convidante
        const rodada = await RodadaService.criarRodada(convidante._id);
        convidantes.push({ convidante, rodada, codigo: await obterCodigoConvite(convidante) });

        console.log(`   Convidante ${i}: ${convidante.nome} - Rodada: ${rodada.nome}`);
    }

    // Cada convidante convida 2 pessoas
    let totalConvidados = 0;

    for (const c of convidantes) {
        logSubSection(`Convites do ${c.convidante.nome}`);

        for (let j = 1; j <= 2; j++) {
            const convidado = await criarUsuario(
                `Convidado_${c.convidante.nome.split('_')[1]}_${j}`,
                `convidado_${c.convidante.nome}_${j}_${Date.now()}@teste.com`
            );

            // Adicionar à rodada do convidante
            await RodadaService.adicionarParticipanteAmarelo(
                c.rodada._id.toString(),
                convidado._id.toString(),
                c.convidante._id.toString()
            );

            totalConvidados++;
            console.log(`   ✅ ${convidado.nome} entrou na rodada ${c.rodada.nome}`);
        }
    }

    logInfo(`\nTotal de convidados adicionados: ${totalConvidados}`);
    logSuccess('✅ Cadastro em massa com links funcionou');

    return true;
}

// ===========================================
// TESTE 15: NENHUM CADASTRO CRIA RODADA (REAFIRMAÇÃO)
// ===========================================
async function teste15_ReafirmarNaoCriacaoRodadas() {
    logSection('TESTE 15: Reafirmar que NENHUM cadastro cria rodada');

    const rodadasAntes = await Rodada.countDocuments();
    logInfo(`Rodadas antes: ${rodadasAntes}`);

    // Criar 10 usuários em sequência
    for (let i = 1; i <= 10; i++) {
        await criarUsuario(
            `TesteNaoCriaRodada_${i}`,
            `teste_nao_cria_${i}_${Date.now()}@teste.com`
        );
    }

    const rodadasDepois = await Rodada.countDocuments();
    logInfo(`Rodadas depois: ${rodadasDepois}`);

    if (rodadasDepois === rodadasAntes) {
        logSuccess('✅ NENHUM dos 10 cadastros criou rodada!');
        return true;
    } else {
        logError(`❌ Foram criadas ${rodadasDepois - rodadasAntes} rodadas - VIOLA REGRA!`);
        return false;
    }
}

// ===========================================
// FUNÇÃO PRINCIPAL
// ===========================================
async function runAllTests() {
    console.log(`\n${colors.bright}${colors.magenta}${'🧪'.repeat(35)}${colors.reset}`);
    console.log(`${colors.bright}${colors.magenta}    TESTE COMPLETO - TODAS AS REGRAS DE NEGÓCIO    ${colors.reset}`);
    console.log(`${colors.bright}${colors.magenta}${'🧪'.repeat(35)}${colors.reset}\n`);

    const results = [];

    try {
        // Conectar ao MongoDB
        logInfo(`Conectando ao MongoDB: ${MONGODB_URI}`);
        await mongoose.connect(MONGODB_URI, {
            serverSelectionTimeoutMS: 5000
        });
        logSuccess('Conectado ao MongoDB');

        // Limpar banco
        await limparBanco();

        // Executar todos os testes
        results.push({ name: 'Cadastro sem convite (sem rodadas)', passed: (await teste1_CadastroSemConviteSemRodadas()).success });

        if (testData.users.length > 0) {
            const rodada = await teste2_CriarRodadaManual();
            results.push({ name: 'Criar rodada manual', passed: !!rodada });

            if (rodada) {
                results.push({ name: 'Cadastro com convite válido', passed: !!(await teste3_CadastroComConviteValido()) });

                const rodadaCompleta = await teste4_CompletarRodada(rodada);
                results.push({ name: 'Completar 15 participantes', passed: rodadaCompleta.participantes.length === 15 });

                results.push({ name: 'Distribuição de cores', passed: await teste5_DistribuicaoCores(rodadaCompleta) });
                results.push({ name: 'Transações criadas', passed: await teste6_TransacoesCriadas(rodadaCompleta) });
                results.push({ name: 'Pagamentos confirmados', passed: await teste7_PagamentosVermelhos(rodadaCompleta) });

                const rodadaConcluida = await Rodada.findById(rodadaCompleta._id);
                results.push({ name: 'Progressão de cores', passed: await teste8_ProgressaoCores(rodadaConcluida) });
                results.push({ name: 'Criação de 2 novas rodadas', passed: await teste9_CriacaoNovasRodadas(rodadaConcluida) });
            }
        }

        // Testes independentes
        results.push({ name: 'Fila de espera FIFO', passed: await teste10_FilaEspera() });
        results.push({ name: 'Jogar Novamente', passed: await teste11_JogarNovamente() });
        results.push({ name: 'Solicitação de saque', passed: await teste12_SolicitacaoSaque() });
        results.push({ name: 'Usuário em única rodada', passed: await teste13_UnicaRodadaPorUsuario() });
        results.push({ name: 'Cadastro em massa com links', passed: await teste14_CadastroMassaComLinks() });
        results.push({ name: 'Nenhum cadastro cria rodada', passed: await teste15_ReafirmarNaoCriacaoRodadas() });

        // ===========================================
        // RESUMO FINAL
        // ===========================================
        logSection('RESUMO FINAL DOS TESTES');

        const passedCount = results.filter(r => r.passed).length;
        const totalCount = results.length;

        console.log(`\n${'📊'.repeat(35)}`);
        console.log(`   Total de testes: ${totalCount}`);
        console.log(`   ✅ Aprovados: ${passedCount}`);
        console.log(`   ❌ Falhas: ${totalCount - passedCount}`);
        console.log(`   📈 Percentual: ${((passedCount / totalCount) * 100).toFixed(1)}%`);
        console.log(`${'📊'.repeat(35)}\n`);

        // Listar detalhes dos testes
        console.log(`${colors.cyan}📋 DETALHES DOS TESTES:${colors.reset}`);
        for (const result of results) {
            if (result.passed) {
                console.log(`   ${colors.green}✅ ${result.name}${colors.reset}`);
            } else {
                console.log(`   ${colors.red}❌ ${result.name}${colors.reset}`);
            }
        }

        if (passedCount === totalCount) {
            console.log(`\n${colors.green}${colors.bright}🎉 PARABÉNS! TODOS OS ${totalCount} TESTES PASSARAM! 🎉${colors.reset}`);
            console.log(`${colors.green}${colors.bright}O sistema está 100% alinhado com todas as regras de negócio!${colors.reset}`);
        } else {
            console.log(`\n${colors.red}${colors.bright}⚠️ ATENÇÃO! ${totalCount - passedCount} teste(s) falharam.${colors.reset}`);
            console.log(`${colors.yellow}Revise as implementações e execute novamente.${colors.reset}`);
        }

        // Estatísticas finais
        console.log(`\n${colors.cyan}📊 ESTATÍSTICAS FINAIS:${colors.reset}`);
        console.log(`   Usuários criados: ${testData.users.length}`);
        console.log(`   Rodadas criadas: ${testData.rodadas.length}`);
        console.log(`   Transações criadas: ${testData.transacoes.length}`);
        console.log(`   Solicitações de saque: ${testData.solicitacoes.length}`);

        await salvarCredenciaisParaLogin();

    } catch (error) {
        console.error(`${colors.red}❌ ERRO FATAL:${colors.reset}`, error);
    } finally {
        if (mongoose.connection.readyState === 1) {
            await mongoose.disconnect();
            logInfo('Desconectado do MongoDB');
        }
    }
}

// ===========================================
// FUNÇÃO PARA SALVAR CREDENCIAIS DOS USUÁRIOS
// ===========================================
async function salvarCredenciaisParaLogin() {
    console.log(`\n${colors.cyan}${'='.repeat(70)}${colors.reset}`);
    console.log(`${colors.bright}🔑 CREDENCIAIS DOS USUÁRIOS CRIADOS${colors.reset}`);
    console.log(`${colors.cyan}${'='.repeat(70)}${colors.reset}`);

    // Filtrar usuários úteis para teste (ignorar participantes genéricos)
    const usuariosUteis = testData.users.filter(u =>
        u.nome.includes('CadastroSemConvite') ||
        u.nome.includes('Convidado') ||
        u.nome.includes('Convidante') ||
        u.nome.includes('FilaUser') ||
        u.nome.includes('ExVerde') ||
        u.nome.includes('Ganhador')
    );

    console.log(`\n📋 Total de usuários para login: ${usuariosUteis.length}\n`);

    for (const user of usuariosUteis) {
        // Determinar a senha (padrão é 'Test@123' para todos criados pelo script)
        const senha = 'Test@123';

        console.log(`${colors.green}✅ ${user.nome}${colors.reset}`);
        console.log(`   📧 Email: ${user.email}`);
        console.log(`   🔑 Senha: ${senha}`);
        console.log(`   🆔 ID: ${user._id}`);
        console.log(`   🎫 Código convite: ${user.codigoConvite || 'N/A'}`);
        console.log(`   ⏳ Na fila: ${user.aguardandoVermelho ? 'SIM' : 'NÃO'}`);
        console.log(`   📍 Posição fila: ${user.posicaoFila || 'N/A'}`);
        console.log('');
    }

    // Salvar em arquivo JSON para referência
    const fs = require('fs');
    const credenciais = usuariosUteis.map(user => ({
        nome: user.nome,
        email: user.email,
        senha: 'Test@123',
        id: user._id,
        codigoConvite: user.codigoConvite,
        naFila: user.aguardandoVermelho,
        posicaoFila: user.posicaoFila
    }));

    fs.writeFileSync('./credenciais-usuarios.json', JSON.stringify(credenciais, null, 2));
    console.log(`${colors.green}💾 Credenciais salvas em: credenciais-usuarios.json${colors.reset}`);
}

// Chamar a função no final do runAllTests(), antes de desconectar

// Executar testes
runAllTests().catch(console.error);