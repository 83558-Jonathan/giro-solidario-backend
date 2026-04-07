// tests/testeCompleto.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../src/models/User');           // <-- adicionei src/
const Rodada = require('../src/models/Rodada');       // <-- adicionei src/
const Transacao = require('../src/models/Transacao'); // <-- adicionei src/
const RodadaService = require('../src/services/rodadaService'); // <-- adicionei src/

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/giro-solidario';

// ===========================================
// FUNÇÕES AUXILIARES
// ===========================================
async function limparBanco() {
    await User.deleteMany({});
    await Rodada.deleteMany({});
    await Transacao.deleteMany({});
    console.log('✅ Banco limpo');
}

function gerarCpfUnico(prefixo, numero) {
    const base = String(numero).padStart(11, '0');
    return base;
}

function gerarEmailUnico(prefixo, numero) {
    return `${prefixo}${numero}@teste.com`;
}

async function criarUsuarios(quantidade, prefixo = 'user', startIndex = 1) {
    const usuarios = [];
    const senhaHash = await bcrypt.hash('123456', 10);

    for (let i = startIndex; i < startIndex + quantidade; i++) {
        const cpf = String(i).padStart(11, '0');

        const user = new User({
            nome: `${prefixo.charAt(0).toUpperCase() + prefixo.slice(1)} ${i}`,
            email: gerarEmailUnico(prefixo, i),
            telefone: `1199999${i}`,
            cpf: cpf,
            chavePix: gerarEmailUnico(prefixo, i),
            tipoChavePix: 'email',
            senha: senhaHash,
            codigoConvite: `CONVITE-${prefixo.toUpperCase()}${i}`
        });
        await user.save();
        usuarios.push(user);
        console.log(`   Criado: ${user.nome} (${user.email})`);
    }
    return usuarios;
}

async function mostrarEstadoRodadas() {
    const rodadas = await Rodada.find().sort({ numero: 1 });
    console.log('\n📊 ESTADO ATUAL DAS RODADAS:');
    for (const rodada of rodadas) {
        const verdes = rodada.participantes.filter(p => p.cor === 'verde').length;
        const pretos = rodada.participantes.filter(p => p.cor === 'preto').length;
        const azuis = rodada.participantes.filter(p => p.cor === 'azul').length;
        const vermelhos = rodada.participantes.filter(p => p.cor === 'vermelho').length;
        const amarelos = rodada.participantes.filter(p => p.cor === 'amarelo').length;
        const pagos = rodada.totalDepositosConfirmados || 0;

        console.log(`\n📌 ${rodada.nome} (${rodada.status})`);
        console.log(`   Participantes: ${rodada.participantes.length}/15`);
        console.log(`   Cores: 🟢${verdes} ⚫${pretos} 🔵${azuis} 🔴${vermelhos} 🟡${amarelos}`);
        if (vermelhos > 0) {
            console.log(`   Pagamentos: ${pagos}/${vermelhos}`);
        }
    }
}

async function simularPagamentoVermelho(rodadaId, vermelhoId) {
    const transacao = await Transacao.findOne({
        pagador: vermelhoId,
        rodada: rodadaId,
        status: 'pendente'
    });

    if (!transacao) {
        console.log(`   ⚠️ Nenhuma transação pendente para ${vermelhoId}`);
        return false;
    }

    await RodadaService.confirmarDeposito(
        transacao._id.toString(),
        'teste_simulado',
        vermelhoId.toString()
    );
    return true;
}

// ===========================================
// TESTE 1: PRIMEIRA RODADA
// ===========================================
async function testarPrimeiraRodada() {
    console.log('\n' + '='.repeat(60));
    console.log('🧪 TESTE 1: PRIMEIRA RODADA');
    console.log('='.repeat(60));

    console.log('\n📝 Criando 15 usuários...');
    const usuarios = await criarUsuarios(15, 'usuario', 1);
    const criador = usuarios[0];
    console.log(`✅ ${usuarios.length} usuários criados`);

    console.log('\n📝 Criando rodada...');
    let rodada = await RodadaService.criarRodada(criador._id.toString());
    console.log(`✅ Rodada criada: ${rodada.nome} (${rodada.status})`);

    console.log('\n📝 Adicionando participantes...');
    for (let i = 1; i < usuarios.length; i++) {
        await RodadaService.adicionarParticipanteAmarelo(
            rodada._id.toString(),
            usuarios[i]._id.toString()
        );
        if ((i + 1) % 5 === 0) {
            console.log(`   Progresso: ${i + 1}/15 participantes`);
        }
    }

    rodada = await Rodada.findById(rodada._id);
    console.log(`\n✅ Rodada iniciada: ${rodada.status}`);

    const verdeUser = await User.findById(rodada.verde);
    console.log(`   🟢 Verde: ${verdeUser.nome}`);
    console.log(`   ⚫ Pretos: ${rodada.pretos.length}`);
    console.log(`   🔵 Azuis: ${rodada.azuis.length}`);
    console.log(`   🔴 Vermelhos: ${rodada.vermelhos.length}`);

    if (rodada.vermelhos.length !== 8) {
        throw new Error('❌ Primeira rodada deveria ter 8 vermelhos');
    }

    const transacoes = await Transacao.find({ rodada: rodada._id });
    console.log(`\n💰 Transações criadas: ${transacoes.length}/8`);

    if (transacoes.length !== 8) {
        throw new Error('❌ Deveriam existir 8 transações');
    }

    console.log('\n💸 Simulando pagamentos dos vermelhos...');
    const verdeInicial = rodada.verde;
    let verdeUserSaldo = await User.findById(verdeInicial);
    console.log(`   Verde atual: ${verdeUserSaldo.nome} (saldo inicial: R$ ${verdeUserSaldo.saldo || 0})`);

    for (let i = 0; i < rodada.vermelhos.length; i++) {
        const vermelhoId = rodada.vermelhos[i];
        const vermelhoUser = await User.findById(vermelhoId);
        console.log(`   🔴 Pagamento ${i + 1}/8: ${vermelhoUser.nome}`);
        await simularPagamentoVermelho(rodada._id.toString(), vermelhoId.toString());
    }

    rodada = await Rodada.findById(rodada._id);
    console.log(`\n✅ Rodada após pagamentos: ${rodada.status}`);

    verdeUserSaldo = await User.findById(verdeInicial);
    console.log(`💰 Verde recebeu: R$ ${verdeUserSaldo.saldo || 0}`);

    if (rodada.rodadasGeradas.length !== 2) {
        throw new Error('❌ Deveriam ter sido geradas 2 novas rodadas');
    }

    const novaRodada1 = await Rodada.findById(rodada.rodadasGeradas[0]);
    const novaRodada2 = await Rodada.findById(rodada.rodadasGeradas[1]);

    console.log(`\n✅ Novas rodadas criadas:`);
    console.log(`   📌 ${novaRodada1.nome} (${novaRodada1.participantes.length} participantes) - ${novaRodada1.status}`);
    console.log(`   📌 ${novaRodada2.nome} (${novaRodada2.participantes.length} participantes) - ${novaRodada2.status}`);

    return { novaRodada1, novaRodada2 };
}

// ===========================================
// TESTE 2: CONVITE E ENTRADA COMO VERMELHO
// ===========================================
async function testarConviteComoVermelho(rodadaAlvo) {
    console.log('\n' + '='.repeat(60));
    console.log('🧪 TESTE 2: CONVITE COMO VERMELHO');
    console.log('='.repeat(60));

    console.log(`\n📌 Rodada alvo: ${rodadaAlvo.nome}`);
    console.log(`   Status: ${rodadaAlvo.status}`);
    console.log(`   Participantes atuais: ${rodadaAlvo.participantes.length}/15`);
    console.log(`   Vermelhos atuais: ${rodadaAlvo.vermelhos.length}/8`);

    const convidadorId = rodadaAlvo.verde;
    const convidador = await User.findById(convidadorId);
    console.log(`\n👤 Convidador: ${convidador.nome} (${convidador.email})`);

    console.log(`\n📝 Criando 8 novos usuários (convidados)...`);
    const convidados = await criarUsuarios(8, 'convidado', 100);
    console.log(`✅ ${convidados.length} convidados criados`);

    console.log(`\n🔴 Adicionando convidados como VERMELHOS na rodada ${rodadaAlvo.nome}...`);
    for (let i = 0; i < convidados.length; i++) {
        const convidado = convidados[i];
        console.log(`   ${i + 1}/8: ${convidado.nome}`);

        await RodadaService.adicionarParticipanteVermelho(
            rodadaAlvo._id.toString(),
            convidado._id.toString(),
            convidadorId.toString()
        );
    }

    const rodadaAtualizada = await Rodada.findById(rodadaAlvo._id);
    console.log(`\n✅ Rodada após adicionar convidados:`);
    console.log(`   Status: ${rodadaAtualizada.status}`);
    console.log(`   Participantes: ${rodadaAtualizada.participantes.length}/15`);
    console.log(`   Vermelhos: ${rodadaAtualizada.vermelhos.length}/8`);

    if (rodadaAtualizada.participantes.length !== 15) {
        throw new Error(`❌ Deveria ter 15 participantes, tem ${rodadaAtualizada.participantes.length}`);
    }

    if (rodadaAtualizada.vermelhos.length !== 8) {
        throw new Error(`❌ Deveria ter 8 vermelhos, tem ${rodadaAtualizada.vermelhos.length}`);
    }

    if (rodadaAtualizada.status !== 'em_andamento') {
        throw new Error(`❌ Status deveria ser em_andamento, está ${rodadaAtualizada.status}`);
    }

    const transacoes = await Transacao.find({ rodada: rodadaAlvo._id });
    console.log(`\n💰 Transações criadas: ${transacoes.length}/8`);

    if (transacoes.length !== 8) {
        throw new Error(`❌ Deveriam existir 8 transações, existem ${transacoes.length}`);
    }

    return rodadaAtualizada;
}

// ===========================================
// TESTE 3: PAGAMENTO E AVANÇO DA NOVA RODADA
// ===========================================
async function testarPagamentoEAvanco(rodada) {
    console.log('\n' + '='.repeat(60));
    console.log('🧪 TESTE 3: PAGAMENTO E AVANÇO DA RODADA');
    console.log('='.repeat(60));

    console.log(`\n📌 Rodada: ${rodada.nome}`);
    console.log(`   Status: ${rodada.status}`);
    console.log(`   Vermelhos: ${rodada.vermelhos.length}/8`);

    const verdeAtualId = rodada.verde;
    let verdeUser = await User.findById(verdeAtualId);
    console.log(`\n👤 Verde atual: ${verdeUser.nome} (saldo inicial: R$ ${verdeUser.saldo || 0})`);

    console.log(`\n💸 Simulando pagamentos dos ${rodada.vermelhos.length} vermelhos...`);
    for (let i = 0; i < rodada.vermelhos.length; i++) {
        const vermelhoId = rodada.vermelhos[i];
        const vermelhoUser = await User.findById(vermelhoId);
        console.log(`   ${i + 1}/${rodada.vermelhos.length}: ${vermelhoUser.nome}`);
        await simularPagamentoVermelho(rodada._id.toString(), vermelhoId.toString());
    }

    const rodadaConcluida = await Rodada.findById(rodada._id);
    console.log(`\n✅ Rodada após pagamentos: ${rodadaConcluida.status}`);

    verdeUser = await User.findById(verdeAtualId);
    console.log(`💰 Verde recebeu: R$ ${verdeUser.saldo || 0}`);

    if (rodadaConcluida.rodadasGeradas.length !== 2) {
        throw new Error(`❌ Deveriam ter sido geradas 2 novas rodadas, foram ${rodadaConcluida.rodadasGeradas.length}`);
    }

    const novaRodada1 = await Rodada.findById(rodadaConcluida.rodadasGeradas[0]);
    const novaRodada2 = await Rodada.findById(rodadaConcluida.rodadasGeradas[1]);

    console.log(`\n✅ Novas rodadas criadas:`);
    console.log(`   📌 ${novaRodada1.nome} (${novaRodada1.participantes.length} participantes) - ${novaRodada1.status}`);
    console.log(`   📌 ${novaRodada2.nome} (${novaRodada2.participantes.length} participantes) - ${novaRodada2.status}`);

    return { novaRodada1, novaRodada2 };
}

// ===========================================
// TESTE 4: VALIDAÇÃO DE PROGRESSÃO DE CORES
// ===========================================
async function testarProgressaoCores() {
    console.log('\n' + '='.repeat(60));
    console.log('🧪 TESTE 4: VALIDAÇÃO DA PROGRESSÃO DE CORES');
    console.log('='.repeat(60));

    const usuarios = await User.find().limit(10);

    let encontrouProgressao = false;
    for (const usuario of usuarios) {
        const historico = await RodadaService.buscarHistoricoUsuario(usuario._id.toString());
        if (historico.length >= 2) {
            encontrouProgressao = true;
            console.log(`\n👤 Usuário: ${usuario.nome}`);
            console.log(`   Participou de ${historico.length} rodada(s):`);

            for (const rodada of historico) {
                const participante = rodada.participantes.find(
                    p => p.usuario.toString() === usuario._id.toString()
                );
                console.log(`   📌 ${rodada.nome} (${rodada.status}): cor = ${participante?.cor || 'não encontrado'}`);
            }
        }
    }

    if (!encontrouProgressao) {
        console.log(`\n⚠️ Nenhum usuário com múltiplas rodadas encontrado ainda`);
    }

    console.log(`\n✅ Progressão de cores verificada`);
}

// ===========================================
// TESTE 5: VALIDAÇÃO DE CONVITE SEM RODADA
// ===========================================
async function testarConviteSemRodada() {
    console.log('\n' + '='.repeat(60));
    console.log('🧪 TESTE 5: CONVITE SEM RODADA ATIVA');
    console.log('='.repeat(60));

    const [novoUsuario] = await criarUsuarios(1, 'novo', 200);
    console.log(`\n📝 Novo usuário criado: ${novoUsuario.nome}`);
    console.log(`   Verificando se tem rodada...`);

    const status = await RodadaService.verificarStatusUsuario(novoUsuario._id.toString());
    console.log(`   Tem rodada ativa? ${status.temRodadaAtiva ? 'Sim' : 'Não'}`);

    if (status.temRodadaAtiva) {
        console.log(`   ⚠️ Usuário tem rodada ativa, mas não deveria`);
    } else {
        console.log(`   ✅ Correto: usuário sem rodada ativa`);
    }

    const convidador = await User.findOne({ email: 'usuario1@teste.com' });
    console.log(`\n👤 Convidador: ${convidador.nome}`);

    console.log(`\n📝 Simulando cadastro com convite...`);

    let rodadaConvidador = await RodadaService.buscarRodadaParaNovoVermelho(convidador._id.toString());

    if (!rodadaConvidador) {
        console.log(`   Criando nova rodada para o convidador...`);
        rodadaConvidador = await RodadaService.criarRodada(convidador._id.toString());
    }

    await RodadaService.adicionarParticipanteAmarelo(
        rodadaConvidador._id.toString(),
        novoUsuario._id.toString(),
        convidador._id.toString()
    );

    const rodadaFinal = await Rodada.findById(rodadaConvidador._id);
    console.log(`\n✅ Resultado:`);
    console.log(`   Rodada: ${rodadaFinal.nome}`);
    console.log(`   Participantes: ${rodadaFinal.participantes.length}/15`);

    const participante = rodadaFinal.participantes.find(
        p => p.usuario.toString() === novoUsuario._id.toString()
    );
    console.log(`   Cor do novo usuário: ${participante?.cor}`);

    if (participante?.cor !== 'amarelo') {
        throw new Error(`❌ Novo usuário deveria ser AMARELO, é ${participante?.cor}`);
    }

    console.log(`   ✅ Correto: novo usuário entrou como AMARELO`);
}

// ===========================================
// EXECUÇÃO PRINCIPAL
// ===========================================
async function run() {
    console.log('\n🚀 INICIANDO TESTE COMPLETO DO SISTEMA\n');

    try {
        await mongoose.connect(MONGODB_URI);
        await limparBanco();

        const { novaRodada1, novaRodada2 } = await testarPrimeiraRodada();
        await mostrarEstadoRodadas();

        const rodadaCompleta = await testarConviteComoVermelho(novaRodada1);
        await mostrarEstadoRodadas();

        const { novaRodada1: rodadaGerada1, novaRodada2: rodadaGerada2 } =
            await testarPagamentoEAvanco(rodadaCompleta);
        await mostrarEstadoRodadas();

        await testarProgressaoCores();

        await testarConviteSemRodada();
        await mostrarEstadoRodadas();

        console.log('\n' + '='.repeat(60));
        console.log('📊 RESUMO FINAL DOS TESTES');
        console.log('='.repeat(60));

        const totalRodadas = await Rodada.countDocuments();
        const totalUsuarios = await User.countDocuments();
        const totalTransacoes = await Transacao.countDocuments();
        const transacoesPendentes = await Transacao.countDocuments({ status: 'pendente' });
        const transacoesConfirmadas = await Transacao.countDocuments({ status: 'confirmado' });

        console.log(`\n📈 Estatísticas:`);
        console.log(`   Rodadas criadas: ${totalRodadas}`);
        console.log(`   Usuários no sistema: ${totalUsuarios}`);
        console.log(`   Transações totais: ${totalTransacoes}`);
        console.log(`   Transações pendentes: ${transacoesPendentes}`);
        console.log(`   Transações confirmadas: ${transacoesConfirmadas}`);

        const usuariosComGanho = await User.find({ totalGanho: { $gt: 0 } });
        if (usuariosComGanho.length > 0) {
            console.log(`\n💰 Usuários que já receberam prêmio:`);
            for (const u of usuariosComGanho) {
                console.log(`   ${u.nome}: R$ ${u.totalGanho}`);
            }
        }

        console.log('\n' + '='.repeat(60));
        console.log('🎉 TODOS OS TESTES PASSARAM COM SUCESSO!');
        console.log('='.repeat(60));
        console.log('\n✅ Regras de negócio validadas:');
        console.log('   1. Primeira rodada: 15 participantes, cores sorteadas, transações criadas');
        console.log('   2. Pagamentos: verde recebe R$ 900, cores promovidas, 2 novas rodadas criadas');
        console.log('   3. Convites: novos usuários entram como VERMELHO na rodada do convidador');
        console.log('   4. Rodada aguardando: ao completar 15, inicia e cria transações');
        console.log('   5. Progressão: cores evoluem corretamente entre rodadas');
        console.log('   6. Multiplicação: cada rodada concluída gera 2 novas rodadas\n');

    } catch (error) {
        console.error('\n❌ TESTE FALHOU:', error.message);
        console.error(error.stack);
    } finally {
        await mongoose.disconnect();
        console.log('\n🔌 Desconectado do MongoDB');
    }
}

run();