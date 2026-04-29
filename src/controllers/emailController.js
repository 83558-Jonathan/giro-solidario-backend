const User = require("../models/User");
const Rodada = require("../models/Rodada");
const Transacao = require("../models/Transacao");
const nodemailer = require("nodemailer");

// Configuração do transporter com mais opções de timeout
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  timeout: 10000,
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 10000,
  debug: true,
  logger: true,
});

// Cache para controle de envios
const emailCooldownCache = new Map();

// Função para testar conexão SMTP
async function testarConexaoSMTP() {
  try {
    await transporter.verify();
    console.log("✅ SMTP configurado corretamente");
    return true;
  } catch (error) {
    console.error("❌ Erro na conexão SMTP:", error.message);
    return false;
  }
}

testarConexaoSMTP();

// Função para verificar cooldown
function podeEnviarEmail(usuarioId, rodadaId) {
  const key = `${usuarioId}_${rodadaId}`;
  const ultimoEnvio = emailCooldownCache.get(key);
  if (!ultimoEnvio) return true;
  const horasDesdeUltimoEnvio = (Date.now() - ultimoEnvio) / (1000 * 60 * 60);
  return horasDesdeUltimoEnvio >= 24;
}

function registrarEnvio(usuarioId, rodadaId) {
  const key = `${usuarioId}_${rodadaId}`;
  emailCooldownCache.set(key, Date.now());
  setTimeout(
    () => {
      emailCooldownCache.delete(key);
    },
    24 * 60 * 60 * 1000,
  );
}

// ===========================================
// Enviar notificação de prêmio para o VERDE (AJUSTADO - R$ 1.000)
// ===========================================
async function enviarEmailPremio(usuario, rodada, valor) {
  const smtpOk = await testarConexaoSMTP();

  if (!smtpOk) {
    console.log(
      `\n📧 [MODO DEV] Email de prêmio seria enviado para: ${usuario.email}`,
    );
    console.log(
      `   Assunto: 🎉 PARABÉNS! Você ganhou R$ ${valor} no Giro Premiado!`,
    );
    console.log(`   Corpo:`);
    console.log(`   Olá ${usuario.nome}!`);
    console.log(
      `   Parabéns! Você foi o VERDE da rodada ${rodada.nome} e ganhou R$ ${valor}!`,
    );
    console.log(`   Acesse o sistema para sacar seu prêmio.`);
    console.log(`\n`);
    return;
  }

  const mailOptions = {
    from: `"Giro Premiado" <${process.env.SMTP_USER}>`,
    to: usuario.email,
    subject: `🎉 PARABÉNS! Você ganhou R$ ${valor} no Giro Premiado!`,
    html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="text-align: center; padding: 20px; background: linear-gradient(135deg, #f59e0b 0%, #ef4444 100%); border-radius: 10px 10px 0 0;">
                    <h1 style="color: white; margin: 0;">🏆 Giro Premiado 🏆</h1>
                </div>
                
                <div style="padding: 30px; background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 0 0 10px 10px;">
                    <div style="text-align: center;">
                        <div style="font-size: 60px; margin-bottom: 10px;">🎉</div>
                        <h2 style="color: #1f2937; margin-top: 0;">PARABÉNS, ${usuario.nome}!</h2>
                    </div>
                    
                    <p style="color: #4b5563; line-height: 1.5; font-size: 16px;">
                        Você foi o <strong style="color: #10B981;">VERDE</strong> da rodada e ganhou o prêmio máximo!
                    </p>
                    
                    <div style="background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); padding: 20px; border-radius: 12px; margin: 20px 0; text-align: center;">
                        <p style="margin: 0; font-size: 14px; color: #92400e;">💰 VALOR GANHO</p>
                        <p style="margin: 5px 0 0; font-size: 36px; font-weight: bold; color: #d97706;">R$ ${valor}</p>
                    </div>
                    
                    <div style="background-color: #ecfdf5; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #10B981;">
                        <p style="margin: 0; color: #065f46; font-size: 14px;">
                            <strong>📋 DETALHES DA RODADA:</strong><br/>
                            Rodada: ${rodada.nome}<br/>
                            Data: ${new Date().toLocaleDateString("pt-BR")}<br/>
                            Status: Concluída
                        </p>
                    </div>
                    
                    <div style="background-color: #eff6ff; padding: 15px; border-radius: 8px; margin: 20px 0;">
                        <p style="margin: 0 0 10px 0; font-weight: bold; color: #1e40af;">🔐 COMO SACAR SEU PRÊMIO:</p>
                        <ol style="margin: 0; padding-left: 20px; color: #1e3a8a;">
                            <li>Acesse o sistema Giro Premiado</li>
                            <li>Vá até o dashboard</li>
                            <li>Clique em "SACAR MEU PRÊMIO" no modal de parabéns</li>
                            <li>O valor será creditado na sua conta automaticamente</li>
                        </ol>
                    </div>
                    
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${process.env.FRONTEND_URL}" 
                           style="background: linear-gradient(135deg, #10B981 0%, #059669 100%); color: white; padding: 14px 35px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block; font-size: 16px;">
                            🎁 ACESSAR SISTEMA E SACAR
                        </a>
                    </div>
                    
                    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
                    
                    <p style="color: #9ca3af; font-size: 12px; text-align: center;">
                        Giro Premiado - Sistema colaborativo de ganhos<br/>
                        <a href="${process.env.FRONTEND_URL}" style="color: #9ca3af;">Acessar Sistema</a>
                    </p>
                </div>
            </div>
        `,
  };

  await transporter.sendMail(mailOptions);
  console.log(
    `📧 Email de prêmio enviado para ${usuario.email} (Rodada ${rodada.nome})`,
  );
}

// ===========================================
// Função para email de cobrança (AJUSTADA - R$ 150,00)
// ===========================================
async function enviarEmailCobranca(
  usuario,
  rodada,
  valor,
  linkPagamento,
  tipo = "cobranca",
) {
  const smtpOk = await testarConexaoSMTP();

  if (!smtpOk) {
    console.log(`\n📧 [MODO DEV] Email seria enviado para: ${usuario.email}`);
    console.log(
      `   Assunto: ${tipo === "lembrete" ? "Lembrete de pagamento" : "Pagamento pendente"} - ${rodada.nome}`,
    );
    console.log(`   Corpo:`);
    console.log(`   Olá ${usuario.nome}!`);
    console.log(
      `   Seu pagamento de R$ ${valor.toFixed(2)} para a rodada ${rodada.nome} está pendente.`,
    );
    if (linkPagamento) console.log(`   Link: ${linkPagamento}`);
    console.log(`\n`);
    return;
  }

  const mailOptions = {
    from: `"Giro Premiado" <${process.env.SMTP_USER}>`,
    to: usuario.email,
    subject:
      tipo === "lembrete"
        ? `🔴 Lembrete de pagamento - ${rodada.nome}`
        : `🔴 Pagamento pendente - ${rodada.nome}`,
    html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="text-align: center; padding: 20px; background-color: #ef4444; border-radius: 10px 10px 0 0;">
                    <h1 style="color: white; margin: 0;">Giro Premiado</h1>
                </div>
                
                <div style="padding: 30px; background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 0 0 10px 10px;">
                    <h2 style="color: #1f2937;">Olá ${usuario.nome}!</h2>
                    
                    <p style="color: #4b5563; line-height: 1.5;">
                        ${
                          tipo === "lembrete"
                            ? "Este é um lembrete amigável: seu pagamento ainda está pendente."
                            : "Seu pagamento para a rodada ainda está pendente."
                        }
                    </p>
                    
                    <div style="background-color: #fef3c7; padding: 15px; border-radius: 8px; margin: 20px 0;">
                        <p style="margin: 0; font-size: 14px;">💰 Valor a pagar:</p>
                        <p style="margin: 5px 0 0; font-size: 24px; font-weight: bold; color: #d97706;">R$ ${valor.toFixed(2)}</p>
                        <p style="margin: 5px 0 0; font-size: 12px; color: #92400e;">(Investimento de R$ 150,00)</p>
                    </div>
                    
                    <p style="color: #4b5563;">
                        ⏳ A rodada <strong>${rodada.nome}</strong> está aguardando seu pagamento para avançar!
                    </p>
                    
                    ${
                      linkPagamento
                        ? `
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${linkPagamento}" 
                           style="background-color: #ef4444; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
                            🔴 Realizar Pagamento Agora
                        </a>
                    </div>
                    `
                        : `
                    <p style="color: #4b5563;">
                        Acesse o sistema e vá até a mandala para gerar seu QR Code de pagamento.
                    </p>
                    `
                    }
                    
                    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
                    
                    <p style="color: #9ca3af; font-size: 12px; text-align: center;">
                        Giro Premiado - Sistema colaborativo de ganhos<br/>
                        <a href="${process.env.FRONTEND_URL}" style="color: #9ca3af;">Acessar Sistema</a>
                    </p>
                </div>
            </div>
        `,
  };

  await transporter.sendMail(mailOptions);
  console.log(`📧 Email de ${tipo} enviado para ${usuario.email}`);
}

// ===========================================
// 🔥 FUNÇÃO: Notificar verde sobre prêmio (exportada) - valor ajustado para R$ 1.000
// ===========================================
exports.notificarPremioVerde = async (usuarioId, rodadaId, valor = 1000) => {
  try {
    const usuario = await User.findById(usuarioId);
    if (!usuario) {
      console.error(`❌ Usuário não encontrado para notificação: ${usuarioId}`);
      return false;
    }

    const rodada = await Rodada.findById(rodadaId);
    if (!rodada) {
      console.error(`❌ Rodada não encontrada para notificação: ${rodadaId}`);
      return false;
    }

    await enviarEmailPremio(usuario, rodada, valor);
    return true;
  } catch (error) {
    console.error("❌ Erro ao notificar verde sobre prêmio:", error);
    return false;
  }
};

// ===========================================
// COBRAR USUÁRIO ESPECÍFICO (AJUSTADO - R$ 150)
// ===========================================
exports.cobrarUsuario = async (req, res) => {
  try {
    const { usuarioId } = req.params;
    const { rodadaId, valor } = req.body;

    if (!rodadaId) {
      return res
        .status(400)
        .json({ success: false, error: "rodadaId é obrigatório" });
    }

    const usuario = await User.findById(usuarioId);
    if (!usuario) {
      return res
        .status(404)
        .json({ success: false, error: "Usuário não encontrado" });
    }

    const rodada = await Rodada.findById(rodadaId);
    if (!rodada) {
      return res
        .status(404)
        .json({ success: false, error: "Rodada não encontrada" });
    }

    if (!podeEnviarEmail(usuarioId, rodadaId)) {
      const ultimoEnvio = emailCooldownCache.get(`${usuarioId}_${rodadaId}`);
      const horasRestantes = 24 - (Date.now() - ultimoEnvio) / (1000 * 60 * 60);

      return res.status(429).json({
        success: false,
        error: `Aguarde ${Math.ceil(horasRestantes)} horas para enviar outro lembrete`,
        podeEnviarNovamente: false,
        horasRestantes: Math.ceil(horasRestantes),
      });
    }

    const transacao = await Transacao.findOne({
      pagador: usuarioId,
      rodada: rodadaId,
      status: "pendente",
    });

    let linkPagamento = null;
    if (transacao && transacao._id) {
      linkPagamento = `${process.env.FRONTEND_URL || "http://localhost:3000"}/pagamento/${transacao._id}`;
    }

    try {
      await enviarEmailCobranca(
        usuario,
        rodada,
        valor || 150,
        linkPagamento,
        "cobranca",
      );
      registrarEnvio(usuarioId, rodadaId);
    } catch (emailError) {
      console.error("Erro ao enviar email:", emailError);
    }

    res.json({
      success: true,
      message: `Lembrete enviado para ${usuario.nome}`,
      modo:
        process.env.NODE_ENV === "development" ? "desenvolvimento" : "producao",
    });
  } catch (error) {
    console.error("Erro ao cobrar usuário:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ===========================================
// ENVIAR LEMBRETE (AJUSTADO - R$ 150)
// ===========================================
exports.enviarLembrete = async (req, res) => {
  try {
    const { usuarioId } = req.params;
    const { rodadaId, valor } = req.body;

    if (!rodadaId) {
      return res
        .status(400)
        .json({ success: false, error: "rodadaId é obrigatório" });
    }

    if (!podeEnviarEmail(usuarioId, rodadaId)) {
      const ultimoEnvio = emailCooldownCache.get(`${usuarioId}_${rodadaId}`);
      const horasRestantes = 24 - (Date.now() - ultimoEnvio) / (1000 * 60 * 60);

      return res.status(429).json({
        success: false,
        error: `Já enviamos um lembrete recentemente. Aguarde ${Math.ceil(horasRestantes)} horas.`,
        podeEnviarNovamente: false,
        horasRestantes: Math.ceil(horasRestantes),
      });
    }

    const usuario = await User.findById(usuarioId);
    if (!usuario) {
      return res
        .status(404)
        .json({ success: false, error: "Usuário não encontrado" });
    }

    const rodada = await Rodada.findById(rodadaId);
    if (!rodada) {
      return res
        .status(404)
        .json({ success: false, error: "Rodada não encontrada" });
    }

    const transacao = await Transacao.findOne({
      pagador: usuarioId,
      rodada: rodadaId,
      status: "pendente",
    });

    const linkPagamento = transacao
      ? `${process.env.FRONTEND_URL || "http://localhost:3000"}/pagamento/${transacao._id}`
      : null;

    try {
      await enviarEmailCobranca(
        usuario,
        rodada,
        valor || 150,
        linkPagamento,
        "lembrete",
      );
      registrarEnvio(usuarioId, rodadaId);
    } catch (emailError) {
      console.error("Erro ao enviar email:", emailError);
    }

    res.json({
      success: true,
      message: `Lembrete enviado para ${usuario.nome}`,
      modo:
        process.env.NODE_ENV === "development" ? "desenvolvimento" : "producao",
    });
  } catch (error) {
    console.error("Erro ao enviar lembrete:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ===========================================
// COBRAR TODOS OS PENDENTES (AJUSTADO - R$ 150)
// ===========================================
exports.cobrarTodosPendentes = async (req, res) => {
  try {
    const { rodadaId } = req.params;

    const rodada = await Rodada.findById(rodadaId);
    if (!rodada) {
      return res
        .status(404)
        .json({ success: false, error: "Rodada não encontrada" });
    }

    const vermelhosPendentes = rodada.participantes.filter(
      (p) => p.cor === "vermelho" && !p.depositoConfirmado,
    );

    const resultados = [];
    const erros = [];

    for (const v of vermelhosPendentes) {
      const usuarioId = v.usuario.toString();

      if (!podeEnviarEmail(usuarioId, rodadaId)) {
        const ultimoEnvio = emailCooldownCache.get(`${usuarioId}_${rodadaId}`);
        const horasRestantes =
          24 - (Date.now() - ultimoEnvio) / (1000 * 60 * 60);
        erros.push({
          usuario: v.nome || v.usuario,
          erro: `Aguardar ${Math.ceil(horasRestantes)}h para novo envio`,
        });
        continue;
      }

      try {
        const usuario = await User.findById(v.usuario);
        const transacao = await Transacao.findOne({
          pagador: v.usuario,
          rodada: rodadaId,
          status: "pendente",
        });

        const linkPagamento = transacao
          ? `${process.env.FRONTEND_URL || "http://localhost:3000"}/pagamento/${transacao._id}`
          : null;

        await enviarEmailCobranca(
          usuario,
          rodada,
          150,
          linkPagamento,
          "lembrete",
        );
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
        totalPendentes: vermelhosPendentes.length,
      },
    });
  } catch (error) {
    console.error("Erro ao cobrar todos:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ===========================================
// VERIFICAR COOLDOWN (existente)
// ===========================================
exports.verificarCooldown = async (req, res) => {
  try {
    const { usuarioId, rodadaId } = req.params;
    const podeEnviar = podeEnviarEmail(usuarioId, rodadaId);

    let horasRestantes = 0;
    if (!podeEnviar) {
      const ultimoEnvio = emailCooldownCache.get(`${usuarioId}_${rodadaId}`);
      if (ultimoEnvio) {
        horasRestantes = 24 - (Date.now() - ultimoEnvio) / (1000 * 60 * 60);
      }
    }

    res.json({
      success: true,
      podeEnviar,
      horasRestantes: Math.ceil(horasRestantes),
      podeEnviarNovamente: new Date(
        Date.now() + horasRestantes * 60 * 60 * 1000,
      ),
    });
  } catch (error) {
    console.error("Erro ao verificar cooldown:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Notificar admin sobre nova solicitação (valor dinâmico)
exports.notificarAdminNovaSolicitacao = async (usuario, rodada, valor) => {
  const adminEmail = process.env.ADMIN_EMAIL || "admin@giropremiados.com.br";

  const mailOptions = {
    from: `"Giro Premiado" <${process.env.SMTP_USER}>`,
    to: adminEmail,
    subject: `💰 NOVA SOLICITAÇÃO DE SAQUE - R$ ${valor}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>💰 Nova Solicitação de Saque</h2>
        <p><strong>Usuário:</strong> ${usuario.nome}</p>
        <p><strong>Email:</strong> ${usuario.email}</p>
        <p><strong>Rodada:</strong> ${rodada.nome}</p>
        <p><strong>Valor:</strong> R$ ${valor}</p>
        <p><strong>Chave PIX:</strong> ${usuario.chavePix} (${usuario.tipoChavePix})</p>
        <hr/>
        <p>Acesse o dashboard do admin para aprovar.</p>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
};

// Notificar usuário que saque foi aprovado
exports.notificarUsuarioSaqueAprovado = async (usuario, solicitacao) => {
  const mailOptions = {
    from: `"Giro Premiado" <${process.env.SMTP_USER}>`,
    to: usuario.email,
    subject: `✅ Seu saque foi aprovado!`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="text-align: center; padding: 20px; background: linear-gradient(135deg, #10B981 0%, #059669 100%); border-radius: 10px 10px 0 0;">
          <h1 style="color: white;">✅ SAQUE APROVADO!</h1>
        </div>
        
        <div style="padding: 30px; background-color: #f9fafb;">
          <p>Olá <strong>${usuario.nome}</strong>,</p>
          <p>Sua solicitação de saque foi <strong style="color: #10B981;">APROVADA</strong>!</p>
          
          <div style="background-color: #ecfdf5; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <p><strong>💰 Valor:</strong> R$ ${solicitacao.valor}</p>
            <p><strong>📅 Data:</strong> ${new Date().toLocaleDateString("pt-BR")}</p>
          </div>
          
          <p>O valor será transferido para sua chave PIX em breve.</p>
          <p><strong>Chave PIX cadastrada:</strong> ${usuario.chavePix} (${usuario.tipoChavePix})</p>
          
          <hr/>
          <p style="font-size: 12px; color: #6b7280;">Giro Premiado</p>
        </div>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
};

// ===========================================
// NOVA FUNÇÃO: Enviar QR Code PIX por e-mail para o vermelho
// ===========================================
async function enviarEmailQrCodePix(
  usuario,
  transacao,
  qrCode,
  qrCodeImage,
  valor,
  rodada,
) {
  const smtpOk = await testarConexaoSMTP();

  if (!smtpOk) {
    console.log(
      `\n📧 [MODO DEV] Email com QR Code seria enviado para: ${usuario.email}`,
    );
    console.log(`   Assunto: 🔴 Pagamento PIX - ${rodada.nome}`);
    console.log(`   Corpo:`);
    console.log(`   Olá ${usuario.nome}!`);
    console.log(
      `   Seu pagamento de R$ ${valor} para a rodada ${rodada.nome} está pendente.`,
    );
    console.log(`   QR Code (texto): ${qrCode}`);
    console.log(
      `   Link para pagamento: ${process.env.FRONTEND_URL}/pagamento/${transacao._id}`,
    );
    console.log(`\n`);
    return;
  }

  const mailOptions = {
    from: `"Giro Premiado" <${process.env.SMTP_USER}>`,
    to: usuario.email,
    subject: `🔴 Pagamento PIX - ${rodada.nome}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="text-align: center; padding: 20px; background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); border-radius: 10px 10px 0 0;">
          <h1 style="color: white; margin: 0;">💳 Giro Premiado</h1>
        </div>
        
        <div style="padding: 30px; background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 0 0 10px 10px;">
          <h2 style="color: #1f2937;">Olá ${usuario.nome}!</h2>
          
          <p style="color: #4b5563; line-height: 1.5;">
            Seu pagamento para a rodada <strong>${rodada.nome}</strong> foi gerado!
          </p>
          
          <div style="background-color: #fef3c7; padding: 20px; border-radius: 12px; margin: 20px 0; text-align: center;">
            <p style="margin: 0; font-size: 14px; color: #92400e;">💰 VALOR A PAGAR</p>
            <p style="margin: 5px 0 0; font-size: 32px; font-weight: bold; color: #d97706;">R$ ${valor.toFixed(2)}</p>
            <p style="margin: 5px 0 0; font-size: 12px; color: #92400e;">(Investimento de R$ ${valor.toFixed(2)})</p>
          </div>
          
          <div style="background-color: white; padding: 20px; border-radius: 12px; margin: 20px 0; text-align: center; border: 2px solid #e5e7eb;">
            <p style="font-weight: bold; color: #1f2937; margin-bottom: 15px;">📱 ESCANEIE O QR CODE ABAIXO:</p>
            ${qrCodeImage ? `<img src="${qrCodeImage}" alt="QR Code PIX" style="max-width: 200px; margin: 0 auto; display: block;"/>` : ""}
            ${!qrCodeImage && qrCode ? `<p style="font-size: 12px; word-break: break-all; background: #f3f4f6; padding: 10px; border-radius: 8px;">${qrCode}</p>` : ""}
          </div>
          
          <div style="text-align: center; margin: 20px 0;">
            <a href="${process.env.FRONTEND_URL}/pagamento/${transacao._id}" 
               style="background-color: #ef4444; color: white; padding: 14px 35px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
               🔴 ACESSAR PÁGINA DE PAGAMENTO
            </a>
          </div>
          
          <div style="background-color: #eff6ff; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0 0 10px 0; font-weight: bold; color: #1e40af;">⏰ INFORMAÇÕES IMPORTANTES:</p>
            <ul style="margin: 0; padding-left: 20px; color: #1e3a8a; font-size: 14px;">
              <li>O QR Code expira em 1 hora</li>
              <li>Após o pagamento, a confirmação é automática</li>
              <li>Você receberá um e-mail de confirmação</li>
            </ul>
          </div>
          
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
          
          <p style="color: #9ca3af; font-size: 12px; text-align: center;">
            Giro Premiado - Sistema colaborativo de ganhos<br/>
            <a href="${process.env.FRONTEND_URL}" style="color: #9ca3af;">Acessar Sistema</a>
          </p>
        </div>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
  console.log(
    `📧 Email com QR Code PIX enviado para ${usuario.email} (Rodada ${rodada.nome})`,
  );
}

// ===========================================
// EXPORTAR A NOVA FUNÇÃO
// ===========================================
exports.enviarEmailQrCodePix = enviarEmailQrCodePix;
