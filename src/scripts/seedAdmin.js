const User = require('../models/User');
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

        // Verificar se admin já existe
        const adminExiste = await User.findOne({ email: adminEmail });

        if (adminExiste) {
            if (adminExiste.role !== 'admin') {
                await User.findByIdAndUpdate(adminExiste._id, { role: 'admin' });
                console.log('✅ Usuário atualizado para ADMIN:', adminEmail);
            } else {
                console.log('✅ Admin já existe:', adminEmail);
            }
            return;
        }

        // Hash da senha
        const salt = await bcrypt.genSalt(12);
        const senhaHash = await bcrypt.hash(adminSenha, salt);

        // Criar admin
        const admin = new User({
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

    } catch (error) {
        console.error('❌ Erro ao criar admin:', error);
    }
}

module.exports = criarAdmin;