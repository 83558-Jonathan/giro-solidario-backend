const User = require('../models/User');
const Rodada = require('../models/Rodada');
const bcrypt = require('bcryptjs');

async function criarAdmin() {
    try {
        // Configurações do admin
        const adminEmail = process.env.ADMIN_EMAIL || 'admin@giropremiados.com.br';
        const adminSenha = process.env.ADMIN_PASSWORD || 'Admin@2026#Giro$Premium';
        const adminNome = process.env.ADMIN_NOME || 'Administrador Master';
        const adminCpf = process.env.ADMIN_CPF || '98485518080';
        const adminTelefone = process.env.ADMIN_TELEFONE || '41984589322';
        const adminChavePix = process.env.ADMIN_CHAVE_PIX || 'admin@giropremiados.com.br';
        const adminTipoChavePix = process.env.ADMIN_TIPO_CHAVE || 'email';

        let admin;

        // Verificar se admin já existe
        const adminExiste = await User.findOne({ email: adminEmail });

        if (adminExiste) {
            if (adminExiste.role !== 'admin') {
                await User.findByIdAndUpdate(adminExiste._id, { role: 'admin' });
                console.log('✅ Usuário atualizado para ADMIN:', adminEmail);
            } else {
                console.log('✅ Admin já existe:', adminEmail);
            }
            admin = adminExiste;
        } else {
            // Hash da senha
            const salt = await bcrypt.genSalt(12);
            const senhaHash = await bcrypt.hash(adminSenha, salt);

            // Criar admin
            admin = new User({
                nome: adminNome,
                email: adminEmail,
                telefone: adminTelefone,
                cpf: adminCpf,
                chavePix: adminChavePix,
                tipoChavePix: adminTipoChavePix,
                senha: senhaHash,
                role: 'admin',
                status: 'ativo',
                codigoConvite: 'CONVITE-ADMIN-MASTER',
                createdAt: new Date(),
                updatedAt: new Date()
            });

            await admin.save();

            console.log(`
                ========================================
                ✅ ADMIN CRIADO COM SUCESSO!
                ========================================
                📧 Email: ${adminEmail}
                🔑 Senha: ${adminSenha}
                👤 Nome: ${adminNome}
                ========================================
                ⚠️  GUARDE ESSAS CREDENCIAIS EM LOCAL SEGURO!
                ========================================
            `);
        }

        // ===========================================
        // CRIAR PRIMEIRA RODADA SE NÃO EXISTIR
        // ===========================================
        const RodadaService = require('../services/rodadaService');
        const totalRodadas = await Rodada.countDocuments();

        if (totalRodadas === 0) {
            console.log('\n🎯 Nenhuma rodada encontrada. Criando primeira rodada via ADMIN...');
            console.log(`   Respeitando a REGRA DE OURO: nenhum cadastro cria rodada`);
            console.log(`   A primeira rodada é criada pelo ADMINISTRADOR do sistema.\n`);

            const rodada = await RodadaService.criarRodada(admin._id);

            console.log(`
    ========================================
    🎲 PRIMEIRA RODADA CRIADA COM SUCESSO!
    ========================================
    📊 Rodada: ${rodada.nome}
    🟡 Status: ${rodada.status}
    👥 Participantes: ${rodada.participantes.length}/15
    👑 Admin é o participante #1 (AMARELO)
    ========================================
            `);

            console.log(`\n📋 PRÓXIMOS PASSOS PARA INICIAR O SISTEMA:`);
            console.log(`   1. Faça login com o admin no sistema`);
            console.log(`   2. Compartilhe seu link de convite`);
            console.log(`   3. Mais 14 pessoas devem se cadastrar`);
            console.log(`   4. Ao completar 15, a rodada inicia automaticamente`);
            console.log(`   5. A partir daí, a progressão gera novas rodadas\n`);

        } else {
            console.log(`\n✅ Sistema já possui ${totalRodadas} rodada(s). Nada a fazer.\n`);
        }

    } catch (error) {
        console.error('❌ Erro ao criar admin:', error);
    }
}

module.exports = criarAdmin;