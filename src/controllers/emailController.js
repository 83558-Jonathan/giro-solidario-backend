const User = require('../models/User');
const Rodada = require('../models/Rodada');
const Transacao = require('../models/Transacao');
const nodemailer = require('nodemailer');

// Configuração do transporter com mais opções de timeout
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true', // true para 465, false para outras portas
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    },
    timeout: 10000, // 10 segundos
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
    debug: true, // Ativar debug para ver o erro
    logger: true
});

// Cache para controle de envios (evita enviar múltiplas vezes no mesmo dia)
const emailCooldownCache = new Map();

// Função para testar conexão SMTP
async function testarConexaoSMTP() {
    try {
        await transporter.verify();
        console.log('✅ SMTP configurado corretamente');
        return true;
    } catch (error) {
        console.error('❌ Erro na conexão SMTP:', error.message);
        return false;
    }
}

// Verificar conexão ao iniciar
testarConexaoSMTP();

// Função para verificar se pode enviar email
function podeEnviarEmail(usuarioId, rodadaId) {
    const key = `${usuarioId}_${rodadaId}`;
    const ultimoEnvio = emailCooldownCache.get(key);

    if (!ultimoEnvio) return true;

    const agora = new Date();
    const horasDesdeUltimoEnvio = (agora - ultimoEnvio) / (1000 * 60 * 60);

    return horasDesdeUltimoEnvio >= 24;
}

// Registrar envio no cache
function registrarEnvio(usuarioId, rodadaId) {
    const key = `${usuarioId}_${rodadaId}`;
    emailCooldownCache.set(key, new Date());

    setTimeout(() => {
        emailCooldownCache.delete(key);
    }, 24 * 60 * 60 * 1000);
}

// Função para enviar email (com fallback para console em caso de erro)
async function enviarEmailCobranca(usuario, rodada, valor, linkPagamento, tipo = 'cobranca') {
    const smtpOk = await testarConexaoSMTP();

    if (!smtpOk) {
        // Fallback: apenas logar (modo desenvolvimento)
        console.log(`\n📧 [MODO DEV] Email seria enviado para: ${usuario.email}`);
        console.log(`   Assunto: ${tipo === 'lembrete' ? 'Lembrete de pagamento' : 'Pagamento pendente'} - ${rodada.nome}`);
        console.log(`   Corpo:`);
        console.log(`   Olá ${usuario.nome}!`);
        console.log(`   Seu pagamento de R$ ${valor.toFixed(2)} para a rodada ${rodada.nome} está pendente.`);
        if (linkPagamento) console.log(`   Link: ${linkPagamento}`);
        console.log(`\n`);
        return;
    }

    const mailOptions = {
        from: `"Giro Premiado" <${process.env.SMTP_USER}>`,
        to: usuario.email,
        subject: tipo === 'lembrete'
            ? `🔴 Lembrete de pagamento - ${rodada.nome}`
            : `🔴 Pagamento pendente - ${rodada.nome}`,
        html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="text-align: center; padding: 20px; background-color: #ef4444; border-radius: 10px 10px 0 0;">
          <h1 style="color: white; margin: 0;">Giro Premiado</h1>
        </div>
        
        <div style="padding: 30px; background-color: #f9fafb; border: 1px solid #e5e7eb;">
          <h2 style="color: #1f2937;">Olá ${usuario.nome}!</h2>
          
          <p style="color: #4b5563; line-height: 1.5;">
            ${tipo === 'lembrete'
                ? 'Este é um lembrete amigável: seu pagamento ainda está pendente.'
                : 'Seu pagamento para a rodada ainda está pendente.'}
          </p>
          
          <div style="background-color: #fef3c7; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0; font-size: 14px;">💰 Valor a pagar:</p>
            <p style="margin: 5px 0 0; font-size: 24px; font-weight: bold; color: #d97706;">R$ ${valor.toFixed(2)}</p>
            <p style="margin: 5px 0 0; font-size: 12px; color: #92400e;">(R$ 125,00 + 10% de taxa administrativa)</p>
          </div>
          
          <p style="color: #4b5563;">
            ⏳ A rodada <strong>${rodada.nome}</strong> está aguardando seu pagamento para avançar!
          </p>
          
          ${linkPagamento ? `
          <div style="text-align: center; margin: 30px 0;">
            <a href="${linkPagamento}" 
               style="background-color: #ef4444; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
              🔴 Realizar Pagamento Agora
            </a>
          </div>
          ` : `
          <p style="color: #4b5563;">
            Acesse o sistema e vá até a mandala para gerar seu QR Code de pagamento.
          </p>
          `}
          
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
          
          <p style="color: #9ca3af; font-size: 12px; text-align: center;">
            Giro Premiado - Sistema colaborativo de ganhos<br/>
            <a href="${process.env.FRONTEND_URL}" style="color: #9ca3af;">Acessar Sistema</a>
          </p>
        </div>
      </div>
    `
    };

    await transporter.sendMail(mailOptions);
    console.log(`📧 Email de ${tipo} enviado para ${usuario.email}`);
}

// ===========================================
// COBRAR USUÁRIO ESPECÍFICO
// ===========================================
exports.cobrarUsuario = async (req, res) => {
    try {
        const { usuarioId } = req.params;
        const { rodadaId, valor } = req.body;

        if (!rodadaId) {
            return res.status(400).json({ success: false, error: 'rodadaId é obrigatório' });
        }

        // Buscar usuário alvo
        const usuario = await User.findById(usuarioId);
        if (!usuario) {
            return res.status(404).json({ success: false, error: 'Usuário não encontrado' });
        }

        // Buscar rodada
        const rodada = await Rodada.findById(rodadaId);
        if (!rodada) {
            return res.status(404).json({ success: false, error: 'Rodada não encontrada' });
        }

        // VERIFICAR COOLDOWN (evitar spam)
        if (!podeEnviarEmail(usuarioId, rodadaId)) {
            const ultimoEnvio = emailCooldownCache.get(`${usuarioId}_${rodadaId}`);
            const horasRestantes = 24 - ((new Date() - ultimoEnvio) / (1000 * 60 * 60));

            return res.status(429).json({
                success: false,
                error: `Aguarde ${Math.ceil(horasRestantes)} horas para enviar outro lembrete`,
                podeEnviarNovamente: false,
                horasRestantes: Math.ceil(horasRestantes)
            });
        }

        // Buscar transação pendente
        const transacao = await Transacao.findOne({
            pagador: usuarioId,
            rodada: rodadaId,
            status: 'pendente'
        });

        // Gerar link de pagamento
        let linkPagamento = null;
        if (transacao && transacao._id) {
            linkPagamento = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/pagamento/${transacao._id}`;
        }

        // Enviar email (mesmo se falhar, não bloqueia a resposta)
        try {
            await enviarEmailCobranca(usuario, rodada, valor || 137.50, linkPagamento, 'cobranca');
            registrarEnvio(usuarioId, rodadaId);
        } catch (emailError) {
            console.error('Erro ao enviar email:', emailError);
            // Continua mesmo com erro de email - apenas loga
        }

        res.json({
            success: true,
            message: `Lembrete enviado para ${usuario.nome}`,
            modo: process.env.NODE_ENV === 'development' ? 'desenvolvimento' : 'producao'
        });

    } catch (error) {
        console.error('Erro ao cobrar usuário:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// ===========================================
// ENVIAR LEMBRETE (mais suave que cobrança)
// ===========================================
exports.enviarLembrete = async (req, res) => {
    try {
        const { usuarioId } = req.params;
        const { rodadaId, valor } = req.body;

        if (!rodadaId) {
            return res.status(400).json({ success: false, error: 'rodadaId é obrigatório' });
        }

        // Verificar cooldown
        if (!podeEnviarEmail(usuarioId, rodadaId)) {
            const ultimoEnvio = emailCooldownCache.get(`${usuarioId}_${rodadaId}`);
            const horasRestantes = 24 - ((new Date() - ultimoEnvio) / (1000 * 60 * 60));

            return res.status(429).json({
                success: false,
                error: `Já enviamos um lembrete recentemente. Aguarde ${Math.ceil(horasRestantes)} horas.`,
                podeEnviarNovamente: false,
                horasRestantes: Math.ceil(horasRestantes)
            });
        }

        const usuario = await User.findById(usuarioId);
        if (!usuario) {
            return res.status(404).json({ success: false, error: 'Usuário não encontrado' });
        }

        const rodada = await Rodada.findById(rodadaId);
        if (!rodada) {
            return res.status(404).json({ success: false, error: 'Rodada não encontrada' });
        }

        const transacao = await Transacao.findOne({
            pagador: usuarioId,
            rodada: rodadaId,
            status: 'pendente'
        });

        const linkPagamento = transacao ? `${process.env.FRONTEND_URL || 'http://localhost:3000'}/pagamento/${transacao._id}` : null;

        try {
            await enviarEmailCobranca(usuario, rodada, valor || 137.50, linkPagamento, 'lembrete');
            registrarEnvio(usuarioId, rodadaId);
        } catch (emailError) {
            console.error('Erro ao enviar email:', emailError);
        }

        res.json({
            success: true,
            message: `Lembrete enviado para ${usuario.nome}`,
            modo: process.env.NODE_ENV === 'development' ? 'desenvolvimento' : 'producao'
        });

    } catch (error) {
        console.error('Erro ao enviar lembrete:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// ===========================================
// COBRAR TODOS OS PENDENTES DA RODADA
// ===========================================
exports.cobrarTodosPendentes = async (req, res) => {
    try {
        const { rodadaId } = req.params;

        const rodada = await Rodada.findById(rodadaId);
        if (!rodada) {
            return res.status(404).json({ success: false, error: 'Rodada não encontrada' });
        }

        const vermelhosPendentes = rodada.participantes.filter(
            p => p.cor === 'vermelho' && !p.depositoConfirmado
        );

        const resultados = [];
        const erros = [];

        for (const v of vermelhosPendentes) {
            const usuarioId = v.usuario.toString();

            // Verificar cooldown para cada usuário
            if (!podeEnviarEmail(usuarioId, rodadaId)) {
                const ultimoEnvio = emailCooldownCache.get(`${usuarioId}_${rodadaId}`);
                const horasRestantes = 24 - ((new Date() - ultimoEnvio) / (1000 * 60 * 60));
                erros.push({
                    usuario: v.nome || v.usuario,
                    erro: `Aguardar ${Math.ceil(horasRestantes)}h para novo envio`
                });
                continue;
            }

            try {
                const usuario = await User.findById(v.usuario);
                const transacao = await Transacao.findOne({
                    pagador: v.usuario,
                    rodada: rodadaId,
                    status: 'pendente'
                });

                const linkPagamento = transacao ? `${process.env.FRONTEND_URL || 'http://localhost:3000'}/pagamento/${transacao._id}` : null;

                await enviarEmailCobranca(usuario, rodada, 137.50, linkPagamento, 'lembrete');
                registrarEnvio(usuarioId, rodadaId);

                resultados.push({ usuario: usuario.nome, email: usuario.email });
            } catch (error) {
                erros.push({ usuario: v.nome || v.usuario, erro: error.message });
            }
        }

        res.json({
            success: true,
            message: `Lembretes enviados para ${resultados.length} usuário(s)`,
            data: {
                enviados: resultados,
                erros: erros,
                totalPendentes: vermelhosPendentes.length
            }
        });

    } catch (error) {
        console.error('Erro ao cobrar todos:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// ===========================================
// VERIFICAR SE PODE ENVIAR LEMBRETE
// ===========================================
exports.verificarCooldown = async (req, res) => {
    try {
        const { usuarioId, rodadaId } = req.params;
        const podeEnviar = podeEnviarEmail(usuarioId, rodadaId);

        let horasRestantes = 0;
        if (!podeEnviar) {
            const ultimoEnvio = emailCooldownCache.get(`${usuarioId}_${rodadaId}`);
            if (ultimoEnvio) {
                horasRestantes = 24 - ((new Date() - ultimoEnvio) / (1000 * 60 * 60));
            }
        }

        res.json({
            success: true,
            podeEnviar,
            horasRestantes: Math.ceil(horasRestantes),
            podeEnviarNovamente: new Date(Date.now() + (horasRestantes * 60 * 60 * 1000))
        });

    } catch (error) {
        console.error('Erro ao verificar cooldown:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};