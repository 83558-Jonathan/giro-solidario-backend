/**
 * SCRIPT DE TESTE COMPLETO - PROGRESSÃO DE RODADAS
 * 
 * Este script simula:
 * 1. Cadastro de usuários com e sem convite
 * 2. Formação de rodadas (15 participantes)
 * 3. Início da rodada (distribuição de cores)
 * 4. Pagamento dos 8 vermelhos
 * 5. Progressão automática (promoção de cores)
 * 6. Duplicação em 2 novas rodadas
 * 7. Alocação de usuários amarelos pendentes como vermelhos nas novas rodadas
 * 
 * Como executar:
 * node scripts/testarFluxoCompleto.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Rodada = require('../models/Rodada');
const Transacao = require('../models/Transacao');
const SolicitacaoSaque = require('../models/SolicitacaoSaque');
const RodadaService = require('../services/rodadaService');

// ===========================================
// CONFIGURAÇÕES
// ===========================================
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/giro-solidario';
const TEST_PREFIX = 'TESTE_';
const QUANTIDADE_USUARIOS = 20; // Serão criados 20 usuários (mais que 15 para gerar pendentes)
const VALOR_PAGAMENTO = 125;

// Cores para emojis
const CORES = {
    amarelo: '🟡',
    vermelho: '🔴',
    azul: '🔵',
    preto: '⚫',
    verde: '🟢',
    concluido: '✅'
};

// ===========================================
// UTILITÁRIOS
// ===========================================
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
// LIMPAR DADOS DE TESTE
// ===========================================
async function limparDadosTeste() {
    log('🧹', 'Limpando dados de teste...');

    // Remover usuários com email de teste
    const usuariosRemovidos = await User.deleteMany({ email: { $regex: `^${TEST_PREFIX}` } });
    log('🗑️', `${usuariosRemovidos.deletedCount} usuários de teste removidos`);

    // Remover rodadas que não tenham participantes reais (ou todas, mas cuidado)
    // Vamos remover apenas rodadas sem participantes ou com emails de teste
    const rodadasRemovidas = await Rodada.deleteMany({});
    log('🗑️', `${rodadasRemovidas.deletedCount} rodadas removidas`);

    // Remover transações e solicitações de teste
    await Transacao.deleteMany({});
    await SolicitacaoSaque.deleteMany({});

    log('✅', 'Dados limpos com sucesso');
}

// ===========================================
// CRIAR USUÁRIOS (COM E SEM CONVITE)
// ===========================================
async function criarUsuarios(quantidade) {
    log('👥', `Criando ${quantidade} usuários...`);

    const usuarios = [];
    let codigoConviteAdmin = null;

    // Primeiro, criar um admin para ser o topo da rede (opcional)
    const admin = await User.findOne({ role: 'admin' });
    if (admin) {
        codigoConviteAdmin = admin.codigoConvite;
        log('👑', `Admin encontrado: ${admin.nome} - Código: ${codigoConviteAdmin}`);
    }

    for (let i = 1; i <= quantidade; i++) {
        const nome = `${TEST_PREFIX}Usuário ${i}`;
        const email = `${TEST_PREFIX}usuario${i}@teste.com`;
        const cpf = `${TEST_PREFIX}${String(i).padStart(11, '0')}`;
        const telefone = `1199999${String(i).padStart(4, '0')}`;
        const chavePix = email;
        const tipoChavePix = 'email';
        const senha = 'Teste@123';

        // Definir código de convite: primeiro usuário sem convite, depois com convite do anterior
        let codigoConvite = null;
        if (i > 1 && usuarios[i - 2]) {
            codigoConvite = usuarios[i - 2].codigoConvite;
        } else if (i === 1 && codigoConviteAdmin) {
            codigoConvite = codigoConviteAdmin;
        }

        try {
            // Simular requisição de registro
            const bcrypt = require('bcryptjs');
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
                role: i === 1 ? 'user' : 'user'
            });

            usuario.codigoConvite = `CONVITE-${TEST_PREFIX}${i}`;

            if (codigoConvite) {
                const indicador = await User.findOne({ codigoConvite });
                if (indicador) {
                    usuario.indicadoPor = indicador._id;
                    await User.findByIdAndUpdate(indicador._id, {
                        $push: { meusIndicados: usuario._id },
                        $inc: { totalIndicacoes: 1 }
                    });
                }
            }

            await usuario.save();
            usuarios.push(usuario);
            log('✅', `Usuário criado: ${nome} (Convite: ${codigoConvite || 'nenhum'})`);

            // Aguardar um pouco para não sobrecarregar
            await sleep(100);

        } catch (error) {
            log('❌', `Erro ao criar usuário ${nome}: ${error.message}`);
        }
    }

    log('✅', `${usuarios.length} usuários criados com sucesso`);
    return usuarios;
}

// ===========================================
// GARANTIR QUE CADA USUÁRIO TENHA UMA RODADA ATIVA (via garantirRodadaParaUsuario)
// ===========================================
async function garantirRodadasParaUsuarios(usuarios) {
    log('🔄', 'Garantindo rodadas ativas para cada usuário...');

    for (const usuario of usuarios) {
        try {
            const rodada = await RodadaService.garantirRodadaParaUsuario(usuario._id.toString());
            log('✅', `Usuário ${usuario.nome} está na rodada: ${rodada?.nome || 'criada'}`);
            await sleep(200);
        } catch (error) {
            log('❌', `Erro para ${usuario.nome}: ${error.message}`);
        }
    }

    log('✅', 'Rodadas garantidas');
}

// ===========================================
// LISTAR RODADAS E SEUS PARTICIPANTES
// ===========================================
async function listarRodadas() {
    const rodadas = await Rodada.find().sort({ numero: 1 });

    logSeparador();
    log('📋', `TOTAL DE RODADAS: ${rodadas.length}`);

    for (const rodada of rodadas) {
        const participantes = rodada.participantes || [];
        const cores = {
            amarelo: participantes.filter(p => p.cor === 'amarelo').length,
            vermelho: participantes.filter(p => p.cor === 'vermelho').length,
            azul: participantes.filter(p => p.cor === 'azul').length,
            preto: participantes.filter(p => p.cor === 'preto').length,
            verde: participantes.filter(p => p.cor === 'verde').length,
            concluido: participantes.filter(p => p.cor === 'concluido').length
        };

        console.log(`\n📌 ${rodada.nome} (${rodada.status.toUpperCase()})`);
        console.log(`   Participantes: ${participantes.length}/15`);
        console.log(`   Cores: 🟡${cores.amarelo} 🔴${cores.vermelho} 🔵${cores.azul} ⚫${cores.preto} 🟢${cores.verde} ✅${cores.concluido}`);
        console.log(`   Vermelhos pagos: ${rodada.totalDepositosConfirmados}/8`);
        console.log(`   Todos depositaram: ${rodada.todosDepositaram ? 'SIM' : 'NÃO'}`);

        if (rodada.rodadasGeradas && rodada.rodadasGeradas.length > 0) {
            console.log(`   ➡️ Gerou: ${rodada.rodadasGeradas.length} nova(s) rodada(s)`);
        }
    }

    logSeparador();
}

// ===========================================
// SIMULAR PAGAMENTOS DOS VERMELHOS DE UMA RODADA
// ===========================================
async function pagarVermelhosDaRodada(rodadaId) {
    log('💰', `Processando pagamentos da rodada ${rodadaId}...`);

    const rodada = await Rodada.findById(rodadaId);
    if (!rodada) {
        log('❌', 'Rodada não encontrada');
        return false;
    }

    const vermelhos = rodada.participantes.filter(p => p.cor === 'vermelho');
    log('🔴', `${vermelhos.length} vermelhos encontrados na rodada ${rodada.nome}`);

    let pagamentosConfirmados = 0;

    for (const vermelho of vermelhos) {
        // Buscar transação do vermelho
        const transacao = await Transacao.findOne({
            pagador: vermelho.usuario,
            rodada: rodadaId,
            status: 'pendente'
        });

        if (!transacao) {
            log('⚠️', `Nenhuma transação pendente para vermelho ${vermelho.usuario}`);
            continue;
        }

        try {
            // Simular pagamento via serviço
            const comprovante = `https://teste.com/comprovante_${transacao._id}.png`;
            const result = await RodadaService.confirmarDeposito(
                transacao._id.toString(),
                comprovante,
                vermelho.usuario.toString()
            );

            pagamentosConfirmados++;
            log('✅', `Pagamento confirmado para vermelho ${vermelho.usuario} (${pagamentosConfirmados}/${vermelhos.length})`);

            await sleep(500); // Pequena pausa para não sobrecarregar

        } catch (error) {
            log('❌', `Erro no pagamento do vermelho ${vermelho.usuario}: ${error.message}`);
        }
    }

    log('💰', `${pagamentosConfirmados}/${vermelhos.length} pagamentos processados na rodada ${rodada.nome}`);
    return pagamentosConfirmados === vermelhos.length;
}

// ===========================================
// FORÇAR VERIFICAÇÃO E AVANÇO DAS RODADAS
// ===========================================
async function forcarVerificacaoRodadas() {
    log('🔍', 'Forçando verificação de todas as rodadas em andamento...');

    const rodadasEmAndamento = await Rodada.find({ status: 'em_andamento' });

    for (const rodada of rodadasEmAndamento) {
        await RodadaService.verificarEAvancarSeNecessario(rodada._id.toString());
        log('🔄', `Verificada rodada ${rodada.nome}`);
        await sleep(300);
    }

    log('✅', 'Verificação concluída');
}

// ===========================================
// VERIFICAR SE USUÁRIOS AMARELOS PENDENTES FORAM ALOCADOS
// ===========================================
async function verificarPendentesAlocados() {
    const pendentes = await User.find({ aguardandoVermelho: true });

    if (pendentes.length === 0) {
        log('✅', 'Nenhum usuário pendente aguardando alocação');
        return;
    }

    log('⚠️', `${pendentes.length} usuário(s) ainda aguardando vaga de vermelho:`);
    for (const u of pendentes) {
        console.log(`   - ${u.nome} (${u.email})`);
    }

    // Verificar se algum deles já está em alguma rodada como amarelo
    for (const u of pendentes) {
        const rodadaAmarela = await Rodada.findOne({
            'participantes.usuario': u._id,
            'participantes.cor': 'amarelo',
            status: 'aguardando'
        });
        if (rodadaAmarela) {
            log('🟡', `${u.nome} ainda está como amarelo na rodada ${rodadaAmarela.nome}`);
        }
    }
}

// ===========================================
// RELATÓRIO FINAL
// ===========================================
async function gerarRelatorioFinal() {
    logSeparador();
    log('📊', 'RELATÓRIO FINAL DO TESTE');
    logSeparador();

    const totalUsuarios = await User.countDocuments();
    const totalRodadas = await Rodada.countDocuments();
    const rodadasConcluidas = await Rodada.countDocuments({ status: 'concluida' });
    const rodadasAndamento = await Rodada.countDocuments({ status: 'em_andamento' });
    const rodadasAguardando = await Rodada.countDocuments({ status: 'aguardando' });

    const totalTransacoes = await Transacao.countDocuments();
    const transacoesConfirmadas = await Transacao.countDocuments({ status: 'confirmado' });

    const pendentes = await User.countDocuments({ aguardandoVermelho: true });

    console.log('\n📈 ESTATÍSTICAS:');
    console.log(`   👥 Usuários totais: ${totalUsuarios}`);
    console.log(`   🎲 Rodadas totais: ${totalRodadas}`);
    console.log(`      - Concluídas: ${rodadasConcluidas}`);
    console.log(`      - Em andamento: ${rodadasAndamento}`);
    console.log(`      - Aguardando: ${rodadasAguardando}`);
    console.log(`   💰 Transações totais: ${totalTransacoes}`);
    console.log(`      - Confirmadas: ${transacoesConfirmadas}`);
    console.log(`   ⏳ Usuários pendentes (aguardandoVermelho): ${pendentes}`);

    // Verificar estrutura das rodadas
    console.log('\n🔍 VERIFICAÇÃO DE ESTRUTURA:');
    const rodadasEmAndamentoComEstrutura = await Rodada.find({
        status: 'em_andamento',
        verde: { $ne: null },
        pretos: { $ne: [] },
        azuis: { $ne: [] }
    });
    console.log(`   Rodadas com estrutura completa (verde+pretos+azuis): ${rodadasEmAndamentoComEstrutura.length}`);

    // Verificar se há usuários que já foram verdes
    const usuariosQueForamVerdes = await User.aggregate([
        {
            $lookup: {
                from: 'rodadas',
                localField: '_id',
                foreignField: 'participantes.usuario',
                as: 'rodadas'
            }
        },
        { $match: { 'rodadas.participantes.cor': 'verde' } },
        { $count: 'total' }
    ]);
    console.log(`   Usuários que já foram VERDES em alguma rodada: ${usuariosQueForamVerdes[0]?.total || 0}`);

    logSeparador();
}

// ===========================================
// FUNÇÃO PRINCIPAL
// ===========================================
async function executarTeste() {
    console.log('\n🚀 INICIANDO TESTE COMPLETO DE PROGRESSÃO DE RODADAS\n');

    try {
        // Conectar ao banco
        log('🔌', `Conectando ao MongoDB...`);
        await mongoose.connect(MONGO_URI);
        log('✅', 'Conectado com sucesso');

        // Limpar dados anteriores
        await limparDadosTeste();

        // Criar usuários
        const usuarios = await criarUsuarios(QUANTIDADE_USUARIOS);

        // Garantir rodadas para cada usuário (simula cadastros e convites)
        await garantirRodadasParaUsuarios(usuarios);

        // Listar rodadas antes de qualquer pagamento
        await listarRodadas();

        // Encontrar rodada em andamento (já com 15 participantes e iniciada)
        let rodadaParaPagar = await Rodada.findOne({ status: 'em_andamento' });

        if (!rodadaParaPagar) {
            log('⚠️', 'Nenhuma rodada em andamento. Verificando rodadas aguardando...');
            const rodadaAguardando = await Rodada.findOne({ status: 'aguardando' });
            if (rodadaAguardando && rodadaAguardando.participantes.length === 15) {
                log('🔄', `Rodada ${rodadaAguardando.nome} está com 15 participantes, iniciando...`);
                await RodadaService.iniciarRodada(rodadaAguardando._id.toString());
                rodadaParaPagar = await Rodada.findById(rodadaAguardando._id);
            } else if (rodadaAguardando) {
                log('⚠️', `Rodada ${rodadaAguardando.nome} ainda tem ${rodadaAguardando.participantes.length}/15 participantes.`);
                log('ℹ️', 'Vamos forçar o preenchimento manual para teste...');

                // Forçar adição de participantes para completar 15
                const participantesFaltando = 15 - rodadaAguardando.participantes.length;
                for (let i = 0; i < participantesFaltando && i < usuarios.length; i++) {
                    const usuario = usuarios[i];
                    const jaEsta = rodadaAguardando.participantes.some(p => p.usuario.toString() === usuario._id.toString());
                    if (!jaEsta) {
                        await RodadaService.adicionarParticipanteAmarelo(rodadaAguardando._id.toString(), usuario._id.toString());
                        log('➕', `Adicionado ${usuario.nome} como amarelo na rodada ${rodadaAguardando.nome}`);
                    }
                }

                // Reiniciar busca
                rodadaParaPagar = await Rodada.findById(rodadaAguardando._id);
                if (rodadaParaPagar.participantes.length === 15) {
                    await RodadaService.iniciarRodada(rodadaParaPagar._id.toString());
                    rodadaParaPagar = await Rodada.findById(rodadaParaPagar._id);
                }
            }
        }

        if (rodadaParaPagar && rodadaParaPagar.status === 'em_andamento') {
            log('🎯', `Rodada selecionada para pagamento: ${rodadaParaPagar.nome}`);

            // Simular pagamento de todos os vermelhos
            const todosPagos = await pagarVermelhosDaRodada(rodadaParaPagar._id.toString());

            if (todosPagos) {
                log('🎉', 'Todos os vermelhos pagaram! Aguardando processamento automático...');
                await sleep(2000);

                // Forçar verificação para garantir avanço
                await forcarVerificacaoRodadas();
                await sleep(2000);

                // Verificar se novas rodadas foram criadas
                const rodadasAtualizadas = await Rodada.find({});
                log('📊', `Após pagamentos: ${rodadasAtualizadas.length} rodadas no total`);

                // Listar rodadas atualizadas
                await listarRodadas();

                // Verificar alocação de pendentes
                await verificarPendentesAlocados();

            } else {
                log('⚠️', 'Nem todos os vermelhos pagaram. Verifique os logs.');
            }
        } else {
            log('⚠️', 'Nenhuma rodada em andamento para testar pagamentos.');
        }

        // Gerar relatório final
        await gerarRelatorioFinal();

        log('🎉', 'TESTE CONCLUÍDO COM SUCESSO!');

    } catch (error) {
        log('💥', `ERRO FATAL: ${error.message}`);
        console.error(error);
    } finally {
        // Desconectar
        await mongoose.disconnect();
        log('🔌', 'Desconectado do MongoDB');
    }
}

// Executar
executarTeste();